import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

/** COLUMN in message_receipts with user id (см. твою таблицу) */
const RECEIPTS_USER_COLUMN = 'user_id';

export default function ChatPage() {
  const [user, setUser] = useState(null);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // receipts: { [messageId]: { delivered:Set<id>, read:Set<id> } } — используем только read
  const [receipts, setReceipts] = useState({});

  // typing users: { [id]: { name, untilTs } }
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  const [callState, setCallState] = useState(null); // {chatId, role:'caller'|'callee', to?, offer?, from?}
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);       // [{id,name}] для кнопок звонка

  const appMemberId = (typeof window !== 'undefined')
    ? (window.APP_MEMBER_ID || localStorage.getItem('member_id') || null)
    : null;
  const selfId = user?.id || appMemberId; // для receipts/last_read_at используем auth.uid

  const canSend = Boolean(selfId);

  // ===== AUTH session =====
  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      const { data } = supabase.auth.onAuthStateChange((_evt, sess) => {
        setUser(sess?.user ?? null);
      });
      unsub = data?.subscription?.unsubscribe || data?.unsubscribe;
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // ===== подсчёт непрочитанных как в ТГ (по last_read_at текущего пользователя) =====
  const applyUnreadToChats = useCallback((unreadByChat, total) => {
    setChats(prev => prev.map(c => ({ ...c, unread_count: unreadByChat[c.chat_id] ?? 0 })));
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
  }, []);

  async function computeUnreadForAllChats(selfUid, setUnread) {
    if (!selfUid) { setUnread({}, 0); return; }

    // мои membership'ы
    const { data: mems } = await supabase
      .from('chat_members')
      .select('chat_id, last_read_at')
      .eq('member_id', selfUid);

    const byChat = {};
    (mems || []).forEach(m => { byChat[m.chat_id] = m.last_read_at ? new Date(m.last_read_at) : null; });
    const chatIds = Object.keys(byChat);
    if (!chatIds.length) { setUnread({}, 0); return; }

    // забираем последние сообщения по этим чатам
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, created_at, body')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });

    const unreadByChat = {};
    chatIds.forEach(id => unreadByChat[id] = 0);

    (msgs || []).forEach(m => {
      const lr = byChat[m.chat_id];
      const newer = !lr || new Date(m.created_at) > lr;
      const notMine = m.author_id !== selfUid;
      if (newer && notMine) unreadByChat[m.chat_id] += 1;
    });

    let total = 0;
    chatIds.forEach(id => { total += unreadByChat[id]; });
    setUnread(unreadByChat, total);
  }

  // ===== Загрузка СПИСКА чатов =====
  useEffect(() => {
    const loadChats = async () => {
      const { data: mems, error: memErr } = await supabase
        .from('chat_members')
        .select('chat_id');
      if (memErr) { console.error('chat_members', memErr); setChats([]); return; }

      const chatIds = [...new Set((mems || []).map(m => m.chat_id))];
      if (!chatIds.length) { setChats([]); return; }

      const { data: chatsData, error: chatsErr } = await supabase
        .from('chats')
        .select('id, title, is_group, updated_at, created_at')
        .in('id', chatIds);
      if (chatsErr) { console.error('chats', chatsErr); setChats([]); return; }

      const { data: lastMsgs } = await supabase
        .from('chat_messages')
        .select('id, chat_id, body, created_at')
        .in('chat_id', chatIds)
        .order('created_at', { ascending: false });

      const lastByChat = {};
      (lastMsgs || []).forEach(m => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m; });

      const mapped = (chatsData || [])
        .map(c => ({
          chat_id: c.id,
          title: c.title,
          is_group: c.is_group,
          last_body: lastByChat[c.id]?.body ?? null,
          last_at: lastByChat[c.id]?.created_at ?? c.updated_at ?? c.created_at ?? null,
          unread_count: 0
        }))
        .sort((a,b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);

      // сразу считаем непрочитанные
      await computeUnreadForAllChats(selfId, (map,total) => applyUnreadToChats(map,total));
    };

    loadChats();

    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async () => {
        // после любого нового сообщения — пересчёт бейджей
        await computeUnreadForAllChats(selfId, (map,total) => applyUnreadToChats(map,total));
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, selfId, applyUnreadToChats]);

  // ===== Имена участников активного чата =====
  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }
    (async () => {
      const { data: mems } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);
      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      if (!ids.length) { setMemberNames({}); setMembers([]); return; }

      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name')
        .in('id', ids);

      const map = {};
      for (const t of (techs || [])) map[t.id] = t.name || t.id;
      setMemberNames(map);
      setMembers(ids.map(id => ({ id, name: map[id] || (id ?? '').slice(0,8) })));
    })();
  }, [activeChatId]);

  // ===== Сообщения активного чата =====
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) console.error('chat_messages', error);
    setMessages(data || []);

    // загрузим текущие receipts, чтобы галочки обновились
    await loadReceipts(chatId);
  }, []);

  const loadReceipts = useCallback(async (chatId) => {
    const { data } = await supabase
      .from('message_receipts')
      .select('message_id, status, user_id')
      .eq('chat_id', chatId);

    const map = {};
    (data || []).forEach(r => {
      const cur = map[r.message_id] || { delivered: new Set(), read: new Set() };
      if (r.status === 'read') cur.read.add(r.user_id);
      map[r.message_id] = cur;
    });
    setReceipts(map);
  }, []);

  // Подписки: chat_messages + message_receipts + typing
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setTyping({});

    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const { data: full } = await supabase
            .from('chat_messages')
            .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
            .eq('id', payload.new.id)
            .single();
          const m = full || payload.new;
          setMessages((prev) => [...prev, m]);

          // пересчитать бейджи глобально
          await computeUnreadForAllChats(selfId, (map,total) => applyUnreadToChats(map,total));
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          setReceipts((prev) => {
            const { message_id, user_id, status } = payload.new;
            const cur = prev[message_id] || { delivered: new Set(), read: new Set() };
            const delivered = new Set(cur.delivered);
            const read = new Set(cur.read);
            if (status === 'read') { delivered.add(user_id); read.add(user_id); }
            return { ...prev, [message_id]: { delivered, read } };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { userId, name, untilTs } = (payload.payload || {});
        if (!userId || (selfId && userId === selfId)) return;
        setTyping((prev) => ({ ...prev, [userId]: { name, untilTs } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((uid) => { if (!next[uid] || next[uid].untilTs < now) delete next[uid]; });
        return next;
      });
    }, 1500);

    return () => {
      clearInterval(prune);
      if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
      if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    };
  }, [activeChatId, selfId, fetchMessages, applyUnreadToChats]);

  // Отметка read (пачкой)
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    const rows = ids.map((message_id) => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));

    // не ругаемся на дубли
    await supabase.from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });

    // обновим last_read_at для текущего чата
    await supabase.from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId);

    // локально проставим галочки
    setReceipts((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        const cur = next[id] || { delivered: new Set(), read: new Set() };
        cur.delivered.add(selfId);
        cur.read.add(selfId);
        next[id] = cur;
      });
      return next;
    });

    // пересчёт бейджей
    await computeUnreadForAllChats(selfId, (map,total) => applyUnreadToChats(map,total));
  }, [activeChatId, selfId, applyUnreadToChats]);

  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2 ? ` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      {/* Левая колонка — список чатов */}
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />
      </div>

      {/* Правая колонка — текущий диалог */}
      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typingText={typingNames}
          members={members}
          selfId={selfId}
          onCallTo={startCallTo}
          canCall={Boolean(selfId)}
        />
        <div style={{flex:'1 1 auto', overflow:'auto', padding:'12px'}}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>
        <div style={{borderTop:'1px solid #eee', padding:'8px 12px'}}>
          <MessageInput
            chatId={activeChatId}
            currentUser={{ id: selfId }}
            disabledSend={!canSend}
            onTyping={(name) => {
              if (!typingChannelRef.current || !activeChatId || !selfId) return;
              typingChannelRef.current.send({
                type:'broadcast',
                event:'typing',
                payload:{ userId: selfId, name, untilTs: Date.now()+4000 }
              });
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select().single();
              if (msgErr) return;

              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const cleanName = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${cleanName}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!up.error && i === 0) {
                    await supabase
                      .from('chat_messages')
                      .update({ file_url: path, file_name: cleanName, file_type: f.type, file_size: f.size })
                      .eq('id', msg.id);
                  }
                  i++;
                }
              }

              // после отправки — перерасчёт бейджей (для других чатов не изменится, но держим логику общей)
              await computeUnreadForAllChats(selfId, (map,total) => applyUnreadToChats(map,total));
            }}
          />
          {!canSend && (
            <div style={{fontSize:12, color:'#888', marginTop:6}}>
              Для отправки задайте текущего участника: <code>localStorage.setItem('member_id','UUID_техника')</code> и обновите страницу.
            </div>
          )}
        </div>
      </div>

      {callState && (
        <CallModal
          state={callState}
          user={{ id: selfId }}
          onClose={() => setCallState(null)}
          channelName={`typing:${activeChatId}`}
        />
      )}
    </div>
  );
}
