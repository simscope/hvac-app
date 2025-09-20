// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

/**
 * Колонка пользователя в таблице message_receipts.
 * Важно: под это заточены RLS-политики (user_id = auth.uid()).
 */
const RECEIPTS_USER_COLUMN = 'user_id';

export default function ChatPage() {
  // === Кто мы ===
  const [sessionUser, setSessionUser] = useState(null);
  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSessionUser(session?.user ?? null);
      const { data } = supabase.auth.onAuthStateChange((_evt, sess) => {
        setSessionUser(sess?.user ?? null);
      });
      unsub = data?.subscription?.unsubscribe || data?.unsubscribe;
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);
  const selfId = sessionUser?.id ?? null;
  const canSend = Boolean(selfId);

  // === Список чатов, текущий чат ===
  const [chats, setChats] = useState([]);            // [{ chat_id, title, is_group, last_at, unread_count }]
  const [activeChatId, setActiveChatId] = useState(null);
  const unreadTotal = useMemo(
    () => chats.reduce((s, c) => s + (c.unread_count || 0), 0),
    [chats]
  );

  // === Сообщения активного чата ===
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // === Квитанции (delivered/read) по message_id ===
  // { [mid]: { delivered:Set<uid>, read:Set<uid> } }
  const [receipts, setReceipts] = useState({});

  // === Подписки/каналы ===
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);
  const typingChannelRef = useRef(null);

  // === Участники активного чата (для отображения имён и адресного звонка) ===
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]); // [{ id, name }]

  // === Состояние звонка ===
  const [callState, setCallState] = useState(null); // {chatId, role:'caller'|'callee', to?, offer?, from?}

  // --- Широковещательный икон-бейдж в TopNav (слушает customEvent)
  useEffect(() => {
    const ev = new CustomEvent('chat-unread-changed', { detail: { total: unreadTotal } });
    window.dispatchEvent(ev);
  }, [unreadTotal]);

  // ------------------------------------------------------------
  // 1) Загрузка списка чатов + первичная оценка unread_count
  // ------------------------------------------------------------
  const computeUnreadForChat = useCallback(async (chatId, myId) => {
    if (!chatId || !myId) return 0;
    // находим last_read_at из chat_members
    const { data: cm } = await supabase
      .from('chat_members')
      .select('last_read_at')
      .eq('chat_id', chatId)
      .eq('member_id', myId)
      .maybeSingle();

    const lastRead = cm?.last_read_at ?? null;

    // считаем входящие после last_read_at
    const q = supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId);

    if (lastRead) q.gt('created_at', lastRead);
    // не считаем собственные сообщения непрочитанными
    if (myId) q.neq('author_id', myId);

    const { count } = await q;
    return count || 0;
  }, []);

  const loadChats = useCallback(async () => {
    // все чаты, где мы участник
    const { data: memberships, error: memErr } = await supabase
      .from('chat_members')
      .select('chat_id')
      .order('chat_id');
    if (memErr) { console.error('chat_members', memErr); setChats([]); return; }

    const chatIds = [...new Set((memberships || []).map(m => m.chat_id))];
    if (!chatIds.length) { setChats([]); return; }

    const { data: chatsData, error: chatsErr } = await supabase
      .from('chats')
      .select('id, title, is_group, updated_at, created_at')
      .in('id', chatIds);
    if (chatsErr) { console.error('chats', chatsErr); setChats([]); return; }

    // найдём последние сообщения для сортировки
    const { data: lastMsgs } = await supabase
      .from('chat_messages')
      .select('id, chat_id, created_at')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });

    const lastByChat = {};
    (lastMsgs || []).forEach((m) => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m.created_at; });

    // посчитаем непрочитанные параллельно
    const unread = await Promise.all(
      chatIds.map((cid) => computeUnreadForChat(cid, selfId))
    );
    const unreadByChat = {};
    chatIds.forEach((cid, i) => { unreadByChat[cid] = unread[i] || 0; });

    const mapped = (chatsData || [])
      .map(c => ({
        chat_id: c.id,
        title: c.title,
        is_group: c.is_group,
        last_at: lastByChat[c.id] || c.updated_at || c.created_at || null,
        unread_count: unreadByChat[c.id] || 0,
      }))
      .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

    setChats(mapped);
    if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
  }, [activeChatId, computeUnreadForChat, selfId]);

  useEffect(() => {
    loadChats();

    // Подписка для пересчёта левой колонки при новых сообщениях
    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload) => {
        const m = payload.new;
        // если сообщение не в активном чате — поднимем unread на 1, если это не наше
        if (m.chat_id !== activeChatId && m.author_id !== selfId) {
          setChats((prev) => prev.map((c) =>
            c.chat_id === m.chat_id ? { ...c, unread_count: (c.unread_count || 0) + 1, last_at: m.created_at } : c
          ));
        } else {
          // просто двигаем сортировку по времени
          setChats((prev) => prev.map((c) =>
            c.chat_id === m.chat_id ? { ...c, last_at: m.created_at } : c
          ));
        }
      })
      .subscribe();

    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [activeChatId, loadChats, selfId]);

  // ------------------------------------------------------------
  // 2) Загрузка участников активного чата (для имён)
  // ------------------------------------------------------------
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
      (techs || []).forEach((t) => { map[t.id] = t.name || t.id; });
      setMemberNames(map);
      setMembers(ids.map((id) => ({ id, name: map[id] || (id ?? '').slice(0, 8) })));
    })();
  }, [activeChatId]);

  // ------------------------------------------------------------
  // 3) Сообщения активного чата
  // ------------------------------------------------------------
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
  }, []);

  // ------------------------------------------------------------
  // 4) Квитанции: начальная загрузка + realtime + резервный поллинг
  // ------------------------------------------------------------
  const loadReceipts = useCallback(async (chatId) => {
    if (!chatId) { setReceipts({}); return; }
    const { data } = await supabase
      .from('message_receipts')
      .select('message_id, status, user_id')
      .eq('chat_id', chatId);

    const map = {};
    (data || []).forEach((r) => {
      const cur = map[r.message_id] || { delivered: new Set(), read: new Set() };
      if (r.status === 'delivered') cur.delivered.add(r.user_id);
      if (r.status === 'read') { cur.delivered.add(r.user_id); cur.read.add(r.user_id); }
      map[r.message_id] = cur;
    });
    setReceipts(map);
  }, []);

  // Подписки + поллинг
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    loadReceipts(activeChatId);

    // сообщения в активном чате
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => [...prev, m]);

          // Если это не наше сообщение — сразу поставим delivered
          if (selfId && m.author_id !== selfId) {
            await supabase
              .from('message_receipts')
              .upsert(
                [{ chat_id: m.chat_id, message_id: m.id, [RECEIPTS_USER_COLUMN]: selfId, status: 'delivered' }],
                { onConflict: 'message_id,user_id,status', ignoreDuplicates: true }
              );
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // квитанции в активном чате
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new;
          setReceipts((prev) => {
            const cur = prev[r.message_id] || { delivered: new Set(), read: new Set() };
            const delivered = new Set(cur.delivered);
            const read = new Set(cur.read);
            if (r.status === 'delivered') delivered.add(r.user_id);
            if (r.status === 'read') { delivered.add(r.user_id); read.add(r.user_id); }
            return { ...prev, [r.message_id]: { delivered, read } };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // простой канал для typing/вызовов (как и раньше, если используешь)
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } });
    typingChannelRef.current = tCh.subscribe();

    // резервный поллинг квитанций (если Realtime отключат)
    const poll = setInterval(() => loadReceipts(activeChatId), 4000);

    return () => {
      clearInterval(poll);
      try { if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current); } catch {}
      try { if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current); } catch {}
      try { if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current); } catch {}
    };
  }, [activeChatId, fetchMessages, loadReceipts, selfId]);

  // ------------------------------------------------------------
  // 5) Пометить как ПРОЧИТАНО (вызывается из MessageList при видимости)
  // ------------------------------------------------------------
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    // upsert read
    const rows = ids.map((message_id) => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));

    await supabase
      .from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });

    // поднимем свой last_read_at, чтобы корректно считался unread_count
    await supabase
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId);

    // обнулим счётчик именно у активного чата, общее — пересчитается
    setChats((prev) => prev.map((c) => (c.chat_id === activeChatId ? { ...c, unread_count: 0 } : c)));
  }, [activeChatId, selfId]);

  // ------------------------------------------------------------
  // 6) Текст «печатает…»
  // ------------------------------------------------------------
  const [typing, setTyping] = useState({});
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map((t) => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''} печатают…`;
  }, [typing]);

  // живой приём typing
  useEffect(() => {
    if (!typingChannelRef.current) return;
    const ch = typingChannelRef.current;
    const handler = (payload) => {
      const msg = payload.payload || {};
      const { userId, name, untilTs } = msg;
      if (!userId || userId === selfId) return;
      setTyping((prev) => ({ ...prev, [userId]: { name, untilTs } }));
    };
    ch.on('broadcast', { event: 'typing' }, handler);

    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((uid) => { if (!next[uid] || next[uid].untilTs < now) delete next[uid]; });
        return next;
      });
    }, 1500);

    return () => { try { ch.off('broadcast', { event: 'typing' }, handler); } catch {}; clearInterval(prune); };
  }, [selfId, typingChannelRef.current]);

  // ------------------------------------------------------------
  // 7) Старт адресного звонка (если используешь CallModal)
  // ------------------------------------------------------------
  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  // ------------------------------------------------------------
  // 8) Рендер
  // ------------------------------------------------------------
  const activeChat = useMemo(() => chats.find((c) => c.chat_id === activeChatId) || null, [chats, activeChatId]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      {/* Левая колонка — список чатов */}
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={(cid) => setActiveChatId(cid)}
        />
      </div>

      {/* Правая колонка — текущий диалог */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={activeChat}
          typingText={typingNames}
          members={members}
          selfId={selfId}
          onCallTo={startCallTo}
          canCall={Boolean(selfId)}
        />

        <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '12px' }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{ borderTop: '1px solid #eee', padding: '8px 12px' }}>
          <MessageInput
            chatId={activeChatId}
            currentUser={{ id: selfId }}
            disabledSend={!canSend}
            onTyping={(name) => {
              if (!typingChannelRef.current || !activeChatId || !selfId) return;
              typingChannelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload: { userId: selfId, name, untilTs: Date.now() + 4000 },
              });
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select()
                .single();
              if (msgErr) return;

              // первый файл подвязываем к сообщению; остальные просто грузим в стор (по желанию)
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

              // после отправки — чат точно «прочитан»
              await markReadForMessageIds([msg.id]);
            }}
          />
          {!canSend && (
            <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
              Для отправки задайте текущего участника (auth): войдите в систему.
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
