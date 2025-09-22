// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';

// Колонка пользователя в message_receipts
const RECEIPTS_USER_COLUMN = 'user_id';

export default function ChatPage() {
  // текущий supabase user
  const [user, setUser] = useState(null);

  // чаты и активный чат
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // сообщения
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // квитанции { [messageId]: { delivered:Set, read:Set } }
  const [receipts, setReceipts] = useState({});

  // участники + имена
  const [members, setMembers] = useState([]);
  const [memberNames, setMemberNames] = useState({});

  // локальные счётчики непрочитанного по чатам
  const [unreadByChat, setUnreadByChat] = useState({});

  // подписки
  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // кто я
  const selfId = user?.id ?? (typeof window !== 'undefined'
    ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
    : null);
  const canSend = Boolean(selfId);

  // ====== auth ======
  useEffect(() => {
    let unsub;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      setUser(s?.session?.user ?? null);
      unsub = supabase.auth.onAuthStateChange((_evt, sess) => {
        setUser(sess?.user ?? null);
      }).data?.subscription;
    })();
    return () => { try { unsub?.unsubscribe(); } catch {} };
  }, []);

  // ====== список чатов ======
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, is_group, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('chats error', error);
        setChats([]);
        return;
      }
      const mapped = (data || []).map(r => ({
        chat_id: r.id,
        title: r.title,
        is_group: r.is_group,
        last_at: r.updated_at,
      }));
      setChats(mapped);

      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };

    loadChats();

    // подсортировать чат вверх при новом сообщении
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
              arr.sort((a, b) => new Date(b.last_at||0) - new Date(a.last_at||0));
            }
            return arr;
          });
          // локальный индикатор непрочитанного
          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat(prev => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }));
          }
        })
      .subscribe();

    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [activeChatId, selfId]);

  // ====== участники активного чата ======
  useEffect(() => {
    if (!activeChatId) { setMembers([]); setMemberNames({}); return; }

    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      if (error) { setMembers([]); setMemberNames({}); return; }

      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      setMembers(ids);

      if (!ids.length) { setMemberNames({}); return; }
      const { data: techs } = await supabase
        .from('technicians')
        .select('auth_user_id, name')
        .in('auth_user_id', ids);

      const dict = {};
      (techs || []).forEach(t => { dict[t.auth_user_id] = t.name || '—'; });
      setMemberNames(dict);
    })();
  }, [activeChatId]);

  // ====== загрузка сообщений ======
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, file_url, file_name, file_type, file_size, created_at, attachment_url')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) { console.error('chat_messages', error); setMessages([]); return; }
    setMessages(data || []);
  }, []);

  // ====== подписки по активному чату ======
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 })); // сброс локального бейджа

    // подписка на новые сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages(prev => [...prev, m]);

          // delivered для входящих — ВАЖНО: передаём chat_id, т.к. в БД он NOT NULL
          if (selfId && m.author_id !== selfId) {
            const rows = [{
              chat_id: m.chat_id,
              message_id: m.id,
              [RECEIPTS_USER_COLUMN]: selfId,
              status: 'delivered',
            }];
            const { error: rErr } = await supabase
              .from('message_receipts')
              .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
            if (rErr) console.warn('deliver upsert err', rErr);
          }
        })
      .subscribe();
    messagesSubRef.current = msgCh;

    // подписка на квитанции
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts' },
        (p) => {
          const r = p.new;
          setReceipts(prev => {
            const obj = { ...prev };
            const entry = obj[r.message_id] || { delivered: new Set(), read: new Set() };
            const tgt = (r.status === 'read') ? entry.read : entry.delivered;
            tgt.add(r.user_id);
            obj[r.message_id] = entry;
            return obj;
          });
        })
      .subscribe();
    receiptsSubRef.current = rCh;

    return () => {
      try { supabase.removeChannel(msgCh); } catch {}
      try { supabase.removeChannel(rCh); } catch {}
    };
  }, [activeChatId, selfId, fetchMessages]);

  // ====== пометить сообщения как прочитанные (пачкой) ======
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    // передаём chat_id, т.к. колонка NOT NULL
    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));

    const { error } = await supabase
      .from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
    if (error) console.warn('receipts upsert error', error);

    // обновим last_read_at — без .catch на результате await
    try {
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);
    } catch {}
  }, [activeChatId, selfId]);

  // текст «печатает…»
  const typingText = useMemo(() => '', []);

  // суммарный бейдж наверху (для TopNav)
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      height: 'calc(100vh - 64px)',      // 64px — высота верхнего TopNav
      overflow: 'hidden'
    }}>
      {/* Верхняя полоса заголовка активного чата */}
      <div style={{ borderBottom: '1px solid #eee', background:'#fff', position:'sticky', top:0, zIndex:2 }}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typingText={typingText}
          members={members}
          memberNames={memberNames}
        />
      </div>

      {/* Содержимое: слева список чатов, справа сообщения — правая колонка скроллится */}
      <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', minHeight:0 }}>
        <div style={{ borderRight:'1px solid #eee', overflow:'auto' }}>
          <div style={{ padding:'12px' }}>
            <h3 style={{ margin:0 }}>Чаты</h3>
          </div>
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            onSelect={setActiveChatId}
            unreadByChat={unreadByChat}
          />
        </div>

        <div style={{ display:'grid', gridTemplateRows:'1fr auto', minHeight:0 }}>
          {/* список сообщений со своей прокруткой */}
          <div style={{ overflow:'auto' }}>
            <MessageList
              messages={messages}
              loading={loadingMessages}
              currentUserId={selfId}
              receipts={receipts}
              onMarkVisibleRead={markReadForMessageIds}
              memberNames={memberNames}
            />
          </div>

          {/* поле ввода */}
          <div style={{ borderTop:'1px solid #eee', padding:'10px', background:'#fff' }}>
            <MessageInput
              chatId={activeChatId}
              onSent={() => {}}
              currentUserId={selfId}
              canSend={canSend}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
