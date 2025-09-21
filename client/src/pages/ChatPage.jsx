import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

export default function ChatPage() {
  // ===== auth =====
  const [user, setUser] = useState(null);
  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user ?? null);
      sub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    })();
    return () => { try { sub?.data?.subscription?.unsubscribe(); } catch {} };
  }, []);

  // fallback id (как и раньше)
  const appMemberId =
    typeof window !== 'undefined'
      ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
      : null;
  const selfId = user?.id || appMemberId;

  // ===== state =====
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // { [messageId]: { delivered:Set, read:Set } }
  const [receipts, setReceipts] = useState({});

  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  const [typing, setTyping] = useState({});
  const [unreadByChat, setUnreadByChat] = useState({});

  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  const [callState, setCallState] = useState(null);

  // ===== загрузка списка чатов =====
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, created_at, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('chats:', error);
        setChats([]);
        return;
      }

      const mapped = (data || []).map((c) => ({
        chat_id: c.id,
        title: c.title,
        last_at: c.updated_at || c.created_at,
      }));
      setChats(mapped);

      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };

    loadChats();

    const ch = supabase
      .channel('overview-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats((prev) => {
            const arr = [...prev];
            const i = arr.findIndex((x) => x.chat_id === cid);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: payload.new.created_at };
              arr.sort(
                (a, b) =>
                  new Date(b.last_at || 0) - new Date(a.last_at || 0)
              );
            }
            return arr;
          });

          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat((p) => ({ ...p, [cid]: (p[cid] || 0) + 1 }));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // ===== участники активного чата =====
  useEffect(() => {
    if (!activeChatId) {
      setMemberNames({});
      setMembers([]);
      return;
    }

    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      if (error) {
        console.error('chat_members:', error);
        setMemberNames({});
        setMembers([]);
        return;
      }

      const ids = (mems || []).map((m) => m.member_id).filter(Boolean);
      setMembers(ids);

      if (!ids.length) {
        setMemberNames({});
        return;
      }

      // техников читаем батчем
      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name, auth_user_id')
        .in('id', ids);

      const map = {};
      (techs || []).forEach((t) => {
        map[t.id] = t.name || (t.auth_user_id ?? '').slice(0, 8);
      });
      setMemberNames(map);
    })();
  }, [activeChatId]);

  // ===== загрузка сообщений =====
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) {
      console.error('chat_messages:', error);
      setMessages([]);
      return;
    }
    setMessages(data || []);
  }, []);

  // ===== подписки по активному чату =====
  useEffect(() => {
    if (!activeChatId) return;

    // загрузка
    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat((p) => ({ ...p, [activeChatId]: 0 }));

    // сразу «чистим» уведомления по чату (read_at)
    (async () => {
      if (selfId) {
        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', selfId)
          .is('read_at', null)
          .filter('payload->>chat_id', 'eq', String(activeChatId));
      }
    })();

    // сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `chat_id=eq.${activeChatId}`,
        },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => [...prev, m]);

          // ставим delivered на входящее — КЛЮЧ ВАШ: chat_id,message_id,user_id
          if (selfId && m.author_id !== selfId) {
            await supabase.from('message_receipts').upsert(
              [{
                chat_id: m.chat_id,
                message_id: m.id,
                user_id: selfId,
                status: 'delivered',
              }],
              { onConflict: 'chat_id,message_id,user_id' }
            );
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // квитанции -> в state
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_receipts',
          filter: `chat_id=eq.${activeChatId}`,
        },
        (payload) => {
          const r = payload.new || payload.old;
          if (!r) return;
          setReceipts((prev) => {
            const byMsg = { ...(prev[r.message_id] || { delivered: new Set(), read: new Set() }) };
            if (payload.eventType === 'DELETE') {
              // на всякий случай
              byMsg.delivered.delete(r.user_id);
              byMsg.read.delete(r.user_id);
            } else {
              if (r.status === 'delivered') byMsg.delivered.add(r.user_id);
              if (r.status === 'read') {
                byMsg.delivered.add(r.user_id);
                byMsg.read.add(r.user_id);
              }
            }
            return { ...prev, [r.message_id]: byMsg };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing канал (опционально, если у вас есть)
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase
      .channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (p) => {
        if (!p?.payload) return;
        setTyping((prev) => ({ ...prev, [p.payload.from]: { at: Date.now(), name: p.payload.name || '' } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => { if (now - (next[k]?.at || 0) > 4000) delete next[k]; });
        return next;
      });
    }, 2000);

    return () => {
      supabase.removeChannel(msgCh);
      supabase.removeChannel(rCh);
      supabase.removeChannel(tCh);
      clearInterval(prune);
    };
  }, [activeChatId, selfId, fetchMessages]);

  // ===== пометка «прочитано» для набора сообщений =====
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;
    const rows = ids.map((message_id) => ({
      chat_id: activeChatId,
      message_id,
      user_id: selfId,
      status: 'read',
    }));
    await supabase.from('message_receipts').upsert(rows, {
      onConflict: 'chat_id,message_id,user_id',
    });

    // (опционально) отметим last_read_at
    await supabase
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId);
  }, [activeChatId, selfId]);

  // ===== typing текст =====
  const typingText = useMemo(() => {
    const arr = Object.values(typing).map((t) => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''} печатают…`;
  }, [typing]);

  // ===== звонок =====
  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  // ===== badge в верхнем меню =====
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      {/* левая колонка */}
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={(cid) => setActiveChatId(cid)}
          unreadByChat={unreadByChat}
        />
      </div>

      {/* правая колонка */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={chats.find((c) => c.chat_id === activeChatId) || null}
          typingText={typingText}
          members={members}
          memberNames={memberNames}
          onStartCall={startCallTo}
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
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
            onSent={() => {}}
            onTyping={(name) => {
              if (!typingChannelRef.current || !selfId) return;
              typingChannelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload: { from: selfId, name: name || 'сотрудник' },
              });
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              // 1) создаём сообщение
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: (text || '').trim() || null })
                .select()
                .single();
              if (msgErr || !msg) return;

              // 2) если есть файл — грузим в storage и обновляем сообщение
              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const clean = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${clean}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!up.error && i === 0) {
                    await supabase
                      .from('chat_messages')
                      .update({ file_url: path, file_name: clean, file_type: f.type, file_size: f.size })
                      .eq('id', msg.id);
                  }
                  i++;
                }
              }
            }}
          />
        </div>
      </div>

      {callState && (
        <CallModal
          {...callState}
          onClose={() => setCallState(null)}
        />
      )}
    </div>
  );
}
