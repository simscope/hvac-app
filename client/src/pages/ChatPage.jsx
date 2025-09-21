import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';

import {
  listMyNotifications,
  markChatRead,
  recalcAndDispatchUnreadTotal,
} from '../api/notifications';

// единые константы для receipts
const RECEIPTS_TABLE = 'message_receipts';
const RECEIPTS_ON_CONFLICT = 'message_id,user_id,status';

export default function ChatPage() {
  // ===== auth =====
  const [user, setUser] = useState(null);
  useEffect(() => {
    let sub;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user || null);
      sub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user || null)).data?.subscription;
    })();
    return () => sub?.unsubscribe?.();
  }, []);
  const selfId = user?.id || null;

  // ===== чаты / активный =====
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // ===== сообщения / квитанции =====
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({});

  // подписки
  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // участники активного чата
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // ================== список чатов ==================
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) { console.error(error); return; }

      const mapped = (data || []).map(c => ({
        chat_id: c.id,
        title: c.title,
        last_at: c.updated_at || c.created_at,
      }));
      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };
    loadChats();

    const ch = supabase.channel('overview-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats(prev => {
            const arr = [...prev];
            const i = arr.findIndex(c => c.chat_id === cid);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: payload.new.created_at };
              arr.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
            }
            return arr;
          });
        }
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [activeChatId]);

  // ================== участники активного чата ==================
  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }

    (async () => {
      const { data: mems } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      setMembers(ids);

      if (!ids.length) { setMemberNames({}); return; }

      const { data: techs } = await supabase
        .from('technicians')
        .select('auth_user_id,name')
        .in('auth_user_id', ids);

      const map = {};
      (techs || []).forEach(t => { map[t.auth_user_id] = t.name || '—'; });
      setMemberNames(map);
    })();
  }, [activeChatId]);

  // ================== загрузка сообщений ==================
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

  // ================== подписки по активному чату ==================
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});

    // очистить уведомления по чату и пересчитать бейдж
    (async () => {
      try { await markChatRead(activeChatId); } finally { recalcAndDispatchUnreadTotal(); }
    })();

    // сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages(prev => [...prev, m]);

          if (selfId && m.author_id !== selfId) {
            try {
              await supabase.from(RECEIPTS_TABLE).upsert([{
                chat_id: m.chat_id,           // важно: у вас NOT NULL
                message_id: m.id,
                user_id: selfId,
                status: 'delivered',
              }], {
                onConflict: RECEIPTS_ON_CONFLICT,
                ignoreDuplicates: true,
              });
            } catch (e) {
              console.warn('delivered upsert error', e);
            }
          }
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
        { event: 'INSERT', schema: 'public', table: 'message_receipts' },
        (p) => {
          const r = p.new;
          setReceipts(prev => {
            const cur = prev[r.message_id] || { delivered: new Set(), read: new Set() };
            if (r.status === 'delivered') cur.delivered.add(r.user_id);
            if (r.status === 'read') cur.read.add(r.user_id);
            return { ...prev, [r.message_id]: cur };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    return () => {
      supabase.removeChannel(msgCh);
      supabase.removeChannel(rCh);
    };
  }, [activeChatId, selfId, fetchMessages]);

  // ================== прочитал видимые ==================
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    try {
      const rows = ids.map(message_id => ({
        chat_id: activeChatId,   // важно: NOT NULL
        message_id,
        user_id: selfId,
        status: 'read',
      }));
      await supabase.from(RECEIPTS_TABLE).upsert(rows, {
        onConflict: RECEIPTS_ON_CONFLICT,
        ignoreDuplicates: true,
      });
    } catch (e) {
      console.warn('read upsert error', e);
    }

    try {
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);
    } catch {}
  }, [activeChatId, selfId]);

  // «печатает…» сейчас не показываем
  const typingNames = useMemo(() => '', []);

  // ресчёт бейджа при смене чата/входе
  useEffect(() => { recalcAndDispatchUnreadTotal(); }, [activeChatId]);

  // ================== UI ==================
  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'grid', gridTemplateColumns: '320px 1fr' }}>
      {/* левая колонка */}
      <div style={{ borderRight: '1px solid #eee', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={(id) => setActiveChatId(id)}
        />
      </div>

      {/* правая колонка */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typing={typingNames}
          members={members}
          memberNames={memberNames}
        />

        {/* список сообщений прокручивается, шапка фиксирована самой страницей */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{ borderTop: '1px solid #eee', padding: 12 }}>
          <MessageInput
            chatId={activeChatId}
            onSent={() => {
              (async () => {
                try { await markChatRead(activeChatId); } finally { recalcAndDispatchUnreadTotal(); }
              })();
            }}
          />
        </div>
      </div>
    </div>
  );
}
