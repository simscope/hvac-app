// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

import { markChatRead } from '../api/notifications';

export default function ChatPage() {
  // auth
  const [user, setUser] = useState(null);

  // chats
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // messages
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // receipts
  const [receipts, setReceipts] = useState({});

  // typing/calls
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  // members / names
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // unread counters by chat (локальные бейджи)
  const [unreadByChat, setUnreadByChat] = useState({});

  // self id
  const appMemberId =
    typeof window !== 'undefined'
      ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
      : null;
  const selfId = user?.id || appMemberId;
  const RECEIPTS_USER_COLUMN = 'user_id';
  const canSend = Boolean(selfId);

  // ==== auth
  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user ?? null);
      unsub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null)).data
        ?.subscription;
    })();
    return () => { try { unsub?.unsubscribe?.(); } catch {} };
  }, []);

  // ==== load chats + overview live
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, created_at, updated_at')
        .eq('deleted', false)
        .order('updated_at', { ascending: false });
      if (error) return;
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
      .on('postgres_changes',
        { event:'INSERT', schema:'public', table:'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats((prev) => {
            const arr = [...prev];
            const idx = arr.findIndex(c => c.chat_id === cid);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], last_at: payload.new.created_at };
              arr.sort((a,b)=> new Date(b.last_at||0) - new Date(a.last_at||0));
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

  // ==== members for active chat
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
        .select('id, name, auth_user_id')
        .in('auth_user_id', ids);
      const map = {};
      (techs || []).forEach(t => { map[t.auth_user_id] = t.name || 'Сотрудник'; });
      setMemberNames(map);
      setMembers(ids);
    })();
  }, [activeChatId]);

  // ==== fetch messages
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) { setMessages([]); return; }
    setMessages(data || []);
  }, []);

  // ==== subscriptions for active chat
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 }));
    // Сбросим уведомления по открытому чату
    markChatRead(activeChatId).catch(() => {});

    // messages
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes',
        { event:'INSERT', schema:'public', table:'chat_messages', filter:`chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => [...prev, m]);
          if (selfId && m.author_id !== selfId) {
            await supabase.from('message_receipts').upsert([{
              chat_id: m.chat_id,
              message_id: m.id,
              [RECEIPTS_USER_COLUMN]: selfId,
              status: 'delivered',
            }], { onConflict: 'message_id,user_id,status' }).catch(() => {});
          }
        })
      .subscribe();
    messagesSubRef.current = msgCh;

    // receipts
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes',
        { event:'INSERT', schema:'public', table:'message_receipts', filter:`chat_id=eq.${activeChatId}` },
        (p) => {
          const r = p.new;
          setReceipts((prev) => {
            const prevFor = prev[r.message_id] || { delivered:new Set(), read:new Set() };
            const nextFor = {
              delivered: new Set(prevFor.delivered),
              read: new Set(prevFor.read),
            };
            if (r.status === 'delivered') nextFor.delivered.add(r[RECEIPTS_USER_COLUMN]);
            if (r.status === 'read')      nextFor.read.add(r[RECEIPTS_USER_COLUMN]);
            return { ...prev, [r.message_id]: nextFor };
          });
        })
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing (broadcast)
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { user_id, name } = payload?.payload || {};
        if (!user_id || user_id === selfId) return;
        setTyping((prev) => ({ ...prev, [user_id]: { at: Date.now(), name } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (now - (next[k]?.at || 0) > 3000) delete next[k];
        }
        return next;
      });
    }, 1000);

    return () => {
      try { supabase.removeChannel(msgCh); } catch {}
      try { supabase.removeChannel(rCh); } catch {}
      try { supabase.removeChannel(tCh); } catch {}
      clearInterval(prune);
    };
  }, [activeChatId, selfId, fetchMessages]);

  // ==== mark read for visible
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;
    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));
    await supabase.from('message_receipts').upsert(rows, {
      onConflict: 'message_id,user_id,status',
    }).catch(() => {});
    await supabase.from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId)
      .catch(() => {});
    // и обновим уведомления по открытому чату (на случай фоновых)
    markChatRead(activeChatId).catch(() => {});
  }, [activeChatId, selfId]);

  const typingText = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2 ? ` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  const startCallTo = useCallback((targetId) => {
    // упрощено; логика звонков у тебя уже есть
    console.log('call to', targetId);
  }, []);

  // суммарный бейдж для верхнего меню (локальные непрочитанные)
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  // ====== Лэйаут: фиксируем верх, скроллим только колонки
  return (
    <div
      style={{
        // эта обёртка должна сидеть ПОД твоим TopNav, у которого position:sticky
        // высота: всё окно минус высота топ-навигации (у тебя ~64px)
        height: 'calc(100vh - 64px)',
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        gap: 0,
        overflow: 'hidden', // важно — чтобы скролл был только внутри колонок
      }}
    >
      {/* Левая колонка */}
      <div style={{ borderRight:'1px solid #eee', overflowY:'auto' }}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px', position:'sticky', top:0, background:'#fff', zIndex:5, borderBottom:'1px solid #eee'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={(id) => setActiveChatId(id)}
          unreadByChat={unreadByChat}
        />
      </div>

      {/* Правая колонка (диалог) */}
      <div style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ position:'sticky', top:0, background:'#fff', zIndex:5, borderBottom:'1px solid #eee' }}>
          <ChatHeader
            chat={chats.find(c => c.chat_id === activeChatId) || null}
            typingText={typingText}
            members={members}
            onCall={(id) => startCallTo(id)}
          />
        </div>

        {/* список сообщений — скроллимая область */}
        <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        {/* инпут */}
        <div style={{ padding:'12px', borderTop:'1px solid #eee', background:'#fff' }}>
          <MessageInput
            chatId={activeChatId}
            onSent={() => {}}
          />
        </div>
      </div>

      {/* модал звонков по твоей логике — оставил заглушкой */}
      <CallModal open={false} onClose={() => {}} />
    </div>
  );
}
