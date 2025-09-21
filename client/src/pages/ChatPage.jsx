// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

/**
 * ВАЖНО по БД:
 * 1) В таблице message_receipts ключ уникальности должен быть (message_id, user_id, status)
 *    и RLS разрешает текущему пользователю upsert своих строк.
 * 2) Создана функция SECURITY DEFINER:
 *      push_chat_notifications(p_chat_id uuid, p_message_id uuid, p_text text)
 *    и выдан grant execute authenticated.
 * 3) NotificationsBell/список уведомлений читают из public.notifications только свои записи.
 */

export default function ChatPage() {
  // ---------------------------- auth / текущий участник ----------------------------
  const [user, setUser] = useState(null);
  const appMemberId =
    typeof window !== 'undefined'
      ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
      : null;
  const selfId = user?.id || appMemberId; // здесь именно auth.user.id или member_id, у вас так используется
  const RECEIPTS_USER_COLUMN = 'user_id'; // имя колонки пользователя в message_receipts
  const canSend = Boolean(selfId);

  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user ?? null);
      unsub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null)).data?.subscription;
    })();
    return () => { try { unsub?.unsubscribe(); } catch {} };
  }, []);

  // ---------------------------- список чатов ----------------------------
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [unreadByChat, setUnreadByChat] = useState({});

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, created_at')
        .order('created_at', { ascending: false });
      if (error) { console.error('chats load', error); setChats([]); return; }
      const mapped = (data || []).map(r => ({ chat_id: r.id, title: r.title, last_at: r.created_at }));
      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };
    load();

    // поднимаем в списке чат, где пришло новое сообщение
    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats(prev => {
            const arr = [...prev];
            const i = arr.findIndex(c => c.chat_id === cid);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: payload.new.created_at };
              arr.sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
            }
            return arr;
          });
          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat(prev => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }));
          }
        })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // суммарный badge для верхнего меню
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  // ---------------------------- участники активного чата ----------------------------
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }
    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);
      if (error) { setMemberNames({}); setMembers([]); return; }
      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      if (!ids.length) { setMemberNames({}); setMembers([]); return; }
      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name, auth_user_id')
        .in('id', ids);
      const names = {};
      (techs || []).forEach(t => { names[t.auth_user_id || t.id] = t.name; });
      setMemberNames(names);
      setMembers(techs || []);
    })();
  }, [activeChatId]);

  // ---------------------------- сообщения и квитанции ----------------------------
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({}); // { [messageId]: { delivered:Set, read:Set } }

  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  const fetchMessages = useCallback(async (chatId) => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) { console.error('chat_messages', error); setMessages([]); return; }
    setMessages(data || []);
  }, []);

  // typing / calls (заглушка)
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const [callState, setCallState] = useState(null);

  // подписки по активному чату
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 }));

    // Сообщения realtime
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages(prev => [...prev, m]);

          // Квитанция delivered на входящие (не наши)
          if (selfId && m.author_id !== selfId) {
            try {
              await supabase.from('message_receipts').upsert([{
                chat_id: m.chat_id, // можно хранить, но НЕ в onConflict
                message_id: m.id,
                [RECEIPTS_USER_COLUMN]: selfId,
                status: 'delivered'
              }], { onConflict: 'message_id,user_id,status' });
            } catch (e) {
              console.warn('delivered upsert failed', e);
            }
          }
        })
      .subscribe();
    messagesSubRef.current = msgCh;

    // Квитанции realtime
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new || payload.old;
          if (!r) return;
          setReceipts(prev => {
            const forMsg = prev[r.message_id] || { delivered: new Set(), read: new Set() };
            const next = { delivered: new Set(forMsg.delivered), read: new Set(forMsg.read) };
            if (payload.eventType === 'DELETE') {
              next[r.status]?.delete(r[RECEIPTS_USER_COLUMN]);
            } else {
              next[r.status]?.add(r[RECEIPTS_USER_COLUMN]);
            }
            return { ...prev, [r.message_id]: next };
          });
        })
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing канал
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { user_id, name } = payload?.payload || {};
        if (!user_id || user_id === selfId) return;
        setTyping(prev => ({ ...prev, [user_id]: { name, at: Date.now() } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    const prune = setInterval(() => {
      const now = Date.now();
      setTyping(prev => {
        const copy = { ...prev };
        Object.keys(copy).forEach(k => { if ((now - (copy[k]?.at || 0)) > 4000) delete copy[k]; });
        return copy;
      });
    }, 1500);

    return () => {
      clearInterval(prune);
      try { supabase.removeChannel(msgCh); } catch {}
      try { supabase.removeChannel(rCh); } catch {}
      try { supabase.removeChannel(tCh); } catch {}
    };
  }, [activeChatId, selfId, fetchMessages]);

  // вычисление строки "печатает…"
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''} печатают…`;
  }, [typing]);

  // пометить видимые сообщения как прочитанные
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;
    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read'
    }));
    try {
      await supabase.from('message_receipts').upsert(rows, {
        onConflict: 'message_id,user_id,status'
      });
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);
    } catch (e) {
      console.warn('mark read failed', e);
    }
  }, [activeChatId, selfId]);

  // быстрый звонок
  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  // ---------------------------- UI ----------------------------
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      {/* левая колонка — список чатов */}
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>

        <ChatList
          chats={chats}
          activeId={activeChatId}
          onPick={setActiveChatId}
          unreadByChat={unreadByChat}
        />
      </div>

      {/* правая колонка — текущий диалог */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typingText={typingNames}
          members={members}
          onCall={startCallTo}
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{ padding: 12, borderTop: '1px solid #eee' }}>
          <MessageInput
            chatId={activeChatId}
            disabled={!canSend}
            onSent={() => {}}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              // 1) создаём сообщение
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select()
                .single();
              if (msgErr || !msg) { console.error('send message error:', msgErr); return; }

              // 2) загрузка первого файла как вложения (опционально)
              if (files && files.length) {
                try {
                  const f = files[0];
                  const cleanName = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${cleanName}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!up.error) {
                    await supabase
                      .from('chat_messages')
                      .update({ file_url: path, file_name: cleanName, file_type: f.type, file_size: f.size })
                      .eq('id', msg.id);
                  }
                } catch (e) {
                  console.warn('file upload failed', e);
                }
              }

              // 3) создаём уведомления участникам (кроме отправителя)
              try {
                await supabase.rpc('push_chat_notifications', {
                  p_chat_id: activeChatId,
                  p_message_id: msg.id,
                  p_text: text?.trim() || null
                });
              } catch (e) {
                console.warn('push_chat_notifications failed', e);
              }
            }}
          />
        </div>
      </div>

      {/* модалка звонка (по желанию можно убрать) */}
      {callState && (
        <CallModal
          open={!!callState}
          chatId={callState.chatId}
          role={callState.role}
          to={callState.to}
          onClose={() => setCallState(null)}
        />
      )}
    </div>
  );
}
