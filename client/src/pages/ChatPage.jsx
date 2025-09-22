// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';

// колонка пользователя в message_receipts
const RECEIPTS_USER_COLUMN = 'user_id';

export default function ChatPage() {
  // ===== auth =====
  const [user, setUser] = useState(null);
  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
      sub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null)).data?.subscription;
    })();
    return () => sub?.unsubscribe?.();
  }, []);
  const selfId = user?.id || null;
  const canSend = Boolean(selfId);

  // ===== чаты / активный чат / бейджи =====
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [unreadByChat, setUnreadByChat] = useState({}); // { [chat_id]: count }

  // ===== сообщения / квитанции / участники =====
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({}); // { [messageId]: { delivered:Set, read:Set } }

  const [members, setMembers] = useState([]);         // массив uid участников
  const [memberNames, setMemberNames] = useState({}); // { uid: 'Имя' }

  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // ===== загрузка списка чатов =====
  useEffect(() => {
    let channel;

    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, is_group, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[CHAT] chats load error:', error);
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

    // при новом сообщении — обновить last_at и инкрементнуть непрочитанные, если чат не активный
    channel = supabase
      .channel('chats-overview')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;
          setChats(prev => {
            const arr = [...prev];
            const i = arr.findIndex(c => c.chat_id === m.chat_id);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: m.created_at };
              arr.sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
            }
            return arr;
          });
          if (selfId && m.author_id !== selfId && m.chat_id !== activeChatId) {
            setUnreadByChat(prev => ({ ...prev, [m.chat_id]: (prev[m.chat_id] || 0) + 1 }));
          }
        })
      .subscribe();

    return () => { try { supabase.removeChannel(channel); } catch {} };
  }, [activeChatId, selfId]);

  // ===== участники активного чата + имена =====
  useEffect(() => {
    if (!activeChatId) { setMembers([]); setMemberNames({}); return; }

    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      if (error) {
        console.error('[CHAT] members error:', error);
        setMembers([]); setMemberNames({});
        return;
      }

      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      setMembers(ids);

      if (!ids.length) { setMemberNames({}); return; }

      const { data: profs, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids);

      if (pErr) {
        console.warn('[CHAT] profiles load error:', pErr);
        setMemberNames({});
        return;
      }

      const dict = {};
      (profs || []).forEach(p => { dict[p.id] = p.full_name || '—'; });
      setMemberNames(dict);
    })();
  }, [activeChatId]);

  // ===== загрузка сообщений =====
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, file_url, file_name, file_type, file_size, attachment_url, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    setLoadingMessages(false);
    if (error) {
      console.error('[CHAT] messages load error:', error);
      setMessages([]);
      return;
    }
    setMessages(data || []);
  }, []);

  // ===== подписки по активному чату =====
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 })); // сброс бейджа

    // сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat:${activeChatId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages(prev => [...prev, m]);

          // входящие -> квитанция delivered
          if (selfId && m.author_id !== selfId) {
            const row = {
              chat_id: m.chat_id,
              message_id: m.id,
              [RECEIPTS_USER_COLUMN]: selfId,
              status: 'delivered',
            };
            const { error } = await supabase
              .from('message_receipts')
              .upsert([row], { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
            if (error) console.warn('[CHAT] deliver upsert error:', error);
          }
        })
      .subscribe();
    messagesSubRef.current = msgCh;

    // квитанции
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts:${activeChatId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (p) => {
          const r = p.new;
          setReceipts(prev => {
            const obj = { ...prev };
            const entry = obj[r.message_id] || { delivered: new Set(), read: new Set() };
            const targetSet = r.status === 'read' ? entry.read : entry.delivered;
            targetSet.add(r.user_id);
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

  // ===== пометить видимые сообщения как прочитанные =====
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));

    const { error } = await supabase
      .from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
    if (error) console.warn('[CHAT] receipts read upsert error:', error);

    try {
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);
    } catch {}
  }, [activeChatId, selfId]);

  // ===== суммарный бейдж наверху (TopNav) =====
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  // typing
  const typingText = useMemo(() => '', []);

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      height: 'calc(100vh - 64px)',
      overflow: 'hidden'
    }}>
      {/* шапка чата */}
      <div style={{ borderBottom: '1px solid #eee', background: '#fff', position: 'sticky', top: 0, zIndex: 2 }}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typingText={typingText}
          members={members}
          memberNames={memberNames}
          // selfId={selfId} // опционально, если хочешь скрывать себя в списке
        />
      </div>

      {/* контент */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}>
        {/* список чатов */}
        <div style={{ borderRight: '1px solid #eee', overflow: 'auto' }}>
          <div style={{ padding: '12px' }}>
            <h3 style={{ margin: 0 }}>Чаты</h3>
          </div>
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            onSelect={setActiveChatId}
            unreadByChat={unreadByChat}
          />
        </div>

        {/* сообщения + инпут */}
        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <div style={{ overflow: 'auto' }}>
            <MessageList
              messages={messages}
              loading={loadingMessages}
              currentUserId={selfId}
              receipts={receipts}
              onMarkVisibleRead={markReadForMessageIds}
              memberNames={memberNames}
            />
          </div>
          <div style={{ borderTop: '1px solid #eee', padding: '10px', background: '#fff' }}>
            <MessageInput
              chatId={activeChatId}
              onSent={() => {}}
              canSend={canSend}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
