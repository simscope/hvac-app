// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

// ВАЖНО: имена компонентов — как у вас в /components/chat
import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

/**
 * Настройки
 */
const RECEIPTS_USER_COLUMN = 'user_id'; // в вашей таблице message_receipts колонка называется user_id
const MSG_PAGE_LIMIT = 500;             // сколько сообщений подгружаем на экран

export default function ChatPage() {
  const [user, setUser] = useState(null);

  // список чатов (для ChatList)
  const [chats, setChats] = useState([]); // [{id,title,is_group,last_body,last_at,unread_count}]
  const [activeChatId, setActiveChatId] = useState(null);

  // сообщения текущего чата
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // map по chat_id -> last_read_at (чтобы быстро считать badge’ы)
  const [lastReadMap, setLastReadMap] = useState({}); // { [chatId]: ISO string | null }

  // служебное
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);
  const typingChannelRef = useRef(null);

  // звонки
  const [callState, setCallState] = useState(null); // {chatId, role:'caller'|'callee', to?, offer?, from?}
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);       // [{id,name}] для кнопок звонка

  // кто мы
  const appMemberId = (typeof window !== 'undefined')
    ? (window.APP_MEMBER_ID || localStorage.getItem('member_id') || null)
    : null;
  const selfId = user?.id || appMemberId;
  const canSend = Boolean(selfId);

  /* ================== AUTH сессия ================== */
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

  /* ================== Загрузка списка чатов ================== */
  const refreshUnreadTotalsEvent = useCallback((total) => {
    // отдаём наверх в TopNav (у вас там слушатель chat-unread-changed)
    try {
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total || 0));
    } catch {}
  }, []);

  const countUnreadForChat = useCallback(async (chatId, lastReadAt) => {
    // считаем непрочитанные как кол-во сообщений новее last_read_at, не от нас
    const { count, error } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .neq('author_id', selfId)
      .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z');

    if (error) {
      console.error('countUnreadForChat', chatId, error);
      return 0;
    }
    return count || 0;
  }, [selfId]);

  const refreshUnreadCounts = useCallback(async (currentSelfId, chatList = null, lastReads = null) => {
    if (!currentSelfId) { refreshUnreadTotalsEvent(0); return; }
    const list = chatList ?? chats;
    const lrMap = lastReads ?? lastReadMap;

    let total = 0;
    const next = await Promise.all(
      list.map(async (c) => {
        const unread = await countUnreadForChat(c.id, lrMap[c.id] || null);
        total += unread;
        return { ...c, unread_count: unread };
      })
    );

    setChats(next);
    refreshUnreadTotalsEvent(total);
  }, [chats, lastReadMap, countUnreadForChat, refreshUnreadTotalsEvent]);

  const loadChats = useCallback(async () => {
    if (!selfId) {
      setChats([]);
      setLastReadMap({});
      setActiveChatId(null);
      refreshUnreadTotalsEvent(0);
      return;
    }

    // (1) Пытаемся загрузить членство пользователя
    const { data: mems, error: memErr } = await supabase
      .from('chat_members')
      .select('chat_id,last_read_at')
      .eq('member_id', selfId);

    if (memErr) {
      console.error('chat_members', memErr);
      setChats([]); setLastReadMap({}); refreshUnreadTotalsEvent(0);
      return;
    }

    const lastRead = {};
    let chatIds = [];

    if (mems?.length) {
      chatIds = [...new Set(mems.map(m => m.chat_id))];
      mems.forEach(m => { lastRead[m.chat_id] = m.last_read_at || null; });
    }

    // (2) Если чат-участий нет — фоллбеком показываем все чаты (например, для админа)
    let rawChats = [];
    if (!chatIds.length) {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, is_group, updated_at, created_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) console.error('chats (fallback)', error);
      rawChats = data || [];
      // last_read_at в таком случае не знаем — считаем null
      rawChats.forEach(c => { lastRead[c.id] = null; });
    } else {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, is_group, updated_at, created_at')
        .in('id', chatIds);
      if (error) console.error('chats', error);
      rawChats = data || [];
    }

    // (3) Подтянуть последние сообщения (одним запросом, возьмём первый по времени на чат)
    const ids = rawChats.map(c => c.id);
    let lastMsgs = [];
    if (ids.length) {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, chat_id, body, created_at')
        .in('chat_id', ids)
        .order('created_at', { ascending: false })
        .limit(ids.length * 10); // с запасом
      lastMsgs = data || [];
    }

    const firstByChat = {};
    for (const m of lastMsgs) {
      if (!firstByChat[m.chat_id]) firstByChat[m.chat_id] = m;
    }

    const mapped = rawChats
      .map(c => ({
        id: c.id,
        title: c.title,
        is_group: c.is_group,
        last_body: firstByChat[c.id]?.body ?? null,
        last_at: firstByChat[c.id]?.created_at ?? c.updated_at ?? c.created_at ?? null,
        unread_count: 0,
      }))
      .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

    setLastReadMap(lastRead);
    setChats(mapped);

    if (!activeChatId && mapped.length) setActiveChatId(mapped[0].id);

    // (4) пересчёт бейджей
    await refreshUnreadCounts(selfId, mapped, lastRead);
  }, [selfId, activeChatId, refreshUnreadCounts, refreshUnreadTotalsEvent]);

  useEffect(() => { loadChats(); }, [loadChats]);

  /* ================== Участники активного чата ================== */
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
      setMembers(ids.map(id => ({ id, name: map[id] || (id ?? '').slice(0, 8) })));
    })();
  }, [activeChatId]);

  /* ================== Загрузка сообщений ================== */
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(MSG_PAGE_LIMIT);
    setLoadingMessages(false);
    if (error) console.error('chat_messages', error);
    setMessages(data || []);
  }, []);

  /* ================== Подписки на INSERT/квитанции/typing ================== */
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);

    // сообщения
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

          // Обновляем last_body/last_at и unread счётчики в списке чатов
          setChats((prev) =>
            prev.map((c) =>
              c.id === m.chat_id
                ? { ...c, last_body: m.body ?? c.last_body, last_at: m.created_at ?? c.last_at }
                : c
            )
          );

          // сразу отмечаем delivered для входящих
          if (selfId && m.author_id !== selfId) {
            await supabase.from('message_receipts')
              .insert({ chat_id: m.chat_id, message_id: m.id, [RECEIPTS_USER_COLUMN]: selfId, status: 'delivered' })
              .catch(() => {});
          }

          // тут же пересчёт бейджей
          await refreshUnreadCounts(selfId);
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // квитанции
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        async (_payload) => {
          // просто пересчитаем бейджи (мог кто-то прочитать)
          await refreshUnreadCounts(selfId);
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing/адресные звонки
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'call' }, (payload) => {
        const msg = payload.payload;
        if (!msg || (selfId && msg.from === selfId)) return;
        if (msg.to && selfId && msg.to !== selfId) return; // адресовано не нам
        if (msg.type === 'offer') {
          setCallState({ chatId: activeChatId, role: 'callee', offer: msg.offer, from: msg.from });
        }
      })
      .subscribe();
    typingChannelRef.current = tCh;

    // при открытии чата — отметить всё как прочитанное
    (async () => {
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);

      setLastReadMap((prev) => ({ ...prev, [activeChatId]: new Date().toISOString() }));
      await refreshUnreadCounts(selfId);
    })();

    return () => {
      if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
      if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    };
  }, [activeChatId, selfId, fetchMessages, refreshUnreadCounts]);

  /* ================== Проставление READ при появлении в зоне видимости ================== */
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    const payload = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read'
    }));

    // вставляем пачкой, игнорируя конфликты уникальности
    await supabase.from('message_receipts').insert(payload, { upsert: false }).catch(() => {});

    // апдейтим last_read_at — «прочитано всё до сейчас»
    await supabase
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId);

    setLastReadMap((prev) => ({ ...prev, [activeChatId]: new Date().toISOString() }));
    await refreshUnreadCounts(selfId);
  }, [activeChatId, selfId, refreshUnreadCounts]);

  /* ================== Быстрый звонок одному участнику ================== */
  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  /* ================== Вёрстка ================== */
  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId) || null, [chats, activeChatId]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      {/* Левая колонка — список чатов */}
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
        />
      </div>

      {/* Правая колонка — текущий диалог */}
      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={activeChat}
          typingText={''}
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
            receipts={{}}                     // галочки будут вычисляться внутри по message_receipts, если нужно — можно расширить
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{borderTop:'1px solid #eee', padding:'8px 12px'}}>
          <MessageInput
            chatId={activeChatId}
            currentUser={{ id: selfId }}
            disabledSend={!canSend}
            onTyping={(_name) => {
              // при желании можно включить отображение "печатает…"
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select()
                .single();
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

              // После отправки — сдвинем last_read_at (мы "видели" свое сообщение)
              await supabase
                .from('chat_members')
                .update({ last_read_at: new Date().toISOString() })
                .eq('chat_id', activeChatId)
                .eq('member_id', selfId);

              setLastReadMap((prev) => ({ ...prev, [activeChatId]: new Date().toISOString() }));
              await refreshUnreadCounts(selfId);
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
