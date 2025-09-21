// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

// ВАЖНО: в БД уже создаются receipts 'delivered' внутри RPC send_message.
// На клиенте отмечаем только 'read' с onConflict='chat_id,message_id,user_id'.

export default function ChatPage() {
  // auth
  const [user, setUser] = useState(null);

  // чаты
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // сообщения
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // квитанции по сообщению: { [messageId]: { delivered: Set<userId>, read: Set<userId> } }
  const [receipts, setReceipts] = useState({});

  // печатает…
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  // звонки
  const [callState, setCallState] = useState(null);

  // участники активного чата
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // непрочитанные по чату
  const [unreadByChat, setUnreadByChat] = useState({});

  // тек. пользователь id
  const selfId = user?.id ?? null;
  const canSend = Boolean(selfId);

  // ===== auth session =====
  useEffect(() => {
    let unsub = supabase.auth.onAuthStateChange((_e, sess) => setUser(sess?.user ?? null));
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
    return () => { try { unsub?.data?.subscription?.unsubscribe(); } catch {} };
  }, []);

  // ===== список чатов =====
  useEffect(() => {
    const loadChats = async () => {
      // подставь свой SELECT (ниже универсальный, если есть view — можно заменить)
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false });

      if (error) { console.error('loadChats', error); setChats([]); return; }

      const mapped = (data || []).map((c) => ({
        chat_id: c.id,
        title: c.title || 'Чат',
        last_at: c.updated_at,
      }));
      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };

    loadChats();

    // realtime — обновляем "последнюю активность"
    const ch = supabase
      .channel('overview-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats((prev) => {
            const arr = [...prev];
            const idx = arr.findIndex((c) => c.chat_id === cid);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], last_at: payload.new.created_at };
              arr.sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
            }
            return arr;
          });
          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat((prev) => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // ===== участники активного чата =====
  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }

    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      if (error) { console.error('chat_members', error); setMemberNames({}); setMembers([]); return; }

      const ids = (mems || []).map((m) => m.member_id).filter(Boolean);
      if (!ids.length) { setMemberNames({}); setMembers([]); return; }

      // имена через technicians
      const { data: techs, error: terr } = await supabase
        .from('technicians')
        .select('id, name, auth_user_id')
        .in('id', ids);

      if (terr) { console.error('technicians', terr); setMemberNames({}); setMembers([]); return; }

      const map = {};
      (techs || []).forEach((t) => {
        if (t?.auth_user_id) map[t.auth_user_id] = t.name || 'Сотрудник';
      });
      setMemberNames(map);
      setMembers(techs || []);
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
    if (error) { console.error('chat_messages', error); setMessages([]); return; }
    setMessages(data || []);
  }, []);

  // ===== подписки для активного чата =====
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    // сбросить локальный непрочитанный
    setUnreadByChat((prev) => ({ ...prev, [activeChatId]: 0 }));

    // сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          // delivered делается в БД — ничего не шлём тут!
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // квитанции (delivered/read) — строим локальную карту
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new || payload.old;
          if (!r) return;
          setReceipts((prev) => {
            const curr = { ...(prev[r.message_id] || { delivered: new Set(), read: new Set() }) };
            const u = r.user_id || r.member_id;
            if (!u) return prev;

            if (r.status === 'delivered') curr.delivered.add(u);
            if (r.status === 'read') { curr.delivered.add(u); curr.read.add(u); }

            return { ...prev, [r.message_id]: curr };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // печатает…
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase
      .channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { from, name } = payload.payload || {};
        if (!from || from === selfId) return;
        setTyping((prev) => ({ ...prev, [from]: { name, at: Date.now() } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    // авто-подчистка "печатает…"
    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (now - (next[k]?.at || 0) > 3000) delete next[k];
        }
        return next;
      });
    }, 1500);

    return () => {
      try { supabase.removeChannel(msgCh); } catch {}
      try { supabase.removeChannel(rCh); } catch {}
      try { supabase.removeChannel(tCh); } catch {}
      clearInterval(prune);
    };
  }, [activeChatId, selfId, fetchMessages]);

  // ===== пометка прочитанных =====
  const markReadForMessageIds = useCallback(
    async (ids) => {
      if (!ids?.length || !selfId || !activeChatId) return;
      const rows = ids.map((message_id) => ({
        chat_id: activeChatId,
        message_id,
        user_id: selfId,
        status: 'read',
      }));
         try {
              const { error: upErr } = await supabase
              .from('message_receipts')
              .upsert(rows, { onConflict: 'chat_id,message_id,user_id' });
              if (upErr) console.warn('receipts upsert error', upErr);
              } catch (e) {
             console.warn('receipts upsert throw', e);
         }
      // (опционально) отметим last_read_at, если у вас member_id=technician.id — тогда уберите это
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .catch(() => {});
    },
    [activeChatId, selfId]
  );

  // текст "печатает…"
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map((t) => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''} печатают…`;
  }, [typing]);

  // быстрый звонок
  const startCallTo = useCallback(
    (targetId) => {
      if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
      setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
    },
    [activeChatId, selfId]
  );

  // суммарный badge в топ-навигации (событие)
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      {/* левая колонка — список чатов */}
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          setActiveChatId={setActiveChatId}
          unreadByChat={unreadByChat}
          onStartCall={startCallTo}
        />
      </div>

      {/* правая колонка — диалог */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={chats.find((c) => c.chat_id === activeChatId) || null}
          typingText={typingNames}
          members={members}
          onStartCall={startCallTo}
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          <MessageList
            chatId={activeChatId}
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{ borderTop: '1px solid #eee', padding: 8 }}>
          <MessageInput
            chatId={activeChatId}
            onSent={(msg) => setMessages((prev) => [...prev, msg])}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !canSend) return;

              // 1) отправка текста через RPC (создаст delivered в БД)
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;

              // send via RPC we already use in MessageInput normally, но здесь оставим резерв:
              const { error: rpcErr } = { error: null }; // RPC вызывается из MessageInput; резерв на случай прямого вызова здесь

              if (rpcErr) { console.error(rpcErr); return; }

              // Если MessageInput уже вызывает sendMessage — можно убрать этот блок.
              // Ниже — обработка файлов после факта: обновим последнее своё сообщение.
              if (files && files.length) {
                try {
                  // найдём последнее своё сообщение (добавленное только что)
                  const lastMine = [...messages].reverse().find((m) => m.author_id === user.id && m.chat_id === activeChatId);
                  if (!lastMine) return;

                  let i = 0;
                  for (const f of files) {
                    const cleanName = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                    const path = `${activeChatId}/${lastMine.id}/${Date.now()}_${cleanName}`;
                    const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                    if (!up.error && i === 0) {
                      await supabase
                        .from('chat_messages')
                        .update({ file_url: path, file_name: cleanName, file_type: f.type, file_size: f.size })
                        .eq('id', lastMine.id);
                    }
                    i++;
                  }
                } catch (e) {
                  console.error('file attach error', e);
                }
              }
            }}
          />
        </div>
      </div>

      {callState && <CallModal state={callState} onClose={() => setCallState(null)} />}
    </div>
  );
}

