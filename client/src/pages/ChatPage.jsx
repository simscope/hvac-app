// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({});
  const [typing, setTyping] = useState({});
  const [callState, setCallState] = useState(null);
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);
  const [unreadByChat, setUnreadByChat] = useState({});

  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  const appMemberId =
    typeof window !== 'undefined'
      ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
      : null;
  const selfId = user?.id || appMemberId;

  const RECEIPTS_USER_COLUMN = 'user_id';
  const canSend = Boolean(selfId);

  // ================= AUTH =================
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user || null);
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => sub?.subscription.unsubscribe();
  }, []);

  // ================= CHATS =================
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('chat_id, title, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('loadChats', error);
        return;
      }

      setChats(data || []);
      if (!activeChatId && data?.length) {
        setActiveChatId(data[0].chat_id);
      }
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
            const idx = arr.findIndex(c => c.chat_id === cid);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], updated_at: payload.new.created_at };
              arr.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            }
            return arr;
          });

          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat(prev => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // ================= MEMBERS =================
  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }

    (async () => {
      const { data: mems } = await supabase
        .from('chat_members')
        .select('member_id, profiles(full_name)')
        .eq('chat_id', activeChatId);

      if (!mems) return;
      const names = {};
      mems.forEach(m => { names[m.member_id] = m.profiles?.full_name || m.member_id; });

      setMembers(mems.map(m => m.member_id));
      setMemberNames(names);
    })();
  }, [activeChatId]);

  // ================= MESSAGES =================
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    setLoadingMessages(false);
    if (error) { console.error('fetchMessages', error); setMessages([]); return; }
    setMessages(data || []);
  }, []);

  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 }));

    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => [...prev, m]);

          if (selfId && m.author_id !== selfId) {
            try {
              await supabase.from('message_receipts').upsert([{
                chat_id: m.chat_id,
                message_id: m.id,
                [RECEIPTS_USER_COLUMN]: selfId,
                status: 'delivered'
              }], { onConflict: 'chat_id,message_id,user_id' });
            } catch (err) {
              console.error('receipt insert error', err);
            }
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    return () => supabase.removeChannel(msgCh);
  }, [activeChatId, selfId, fetchMessages]);

  // ================= MARK READ =================
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;
    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));
    try {
      await supabase.from('message_receipts').upsert(rows, {
        onConflict: 'chat_id,message_id,user_id',
      });
      await supabase.from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);
    } catch (err) {
      console.error('markRead error', err);
    }
  }, [activeChatId, selfId]);

  // ================= TYPING =================
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''} печатают…`;
  }, [typing]);

  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  // ================= UNREAD COUNTER =================
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
      localStorage.setItem('CHAT_UNREAD_TOTAL', total);
    }
  }, [unreadByChat]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
          unreadByChat={unreadByChat}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          members={members}
          memberNames={memberNames}
          typingNames={typingNames}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            memberNames={memberNames}
            onMarkVisibleRead={markReadForMessageIds}
          />
        </div>

        <MessageInput
          canSend={canSend}
          onSend={async ({ text, files }) => {
            if (!activeChatId || !selfId) return;
            const { data: msg, error: msgErr } = await supabase
              .from('chat_messages')
              .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
              .select()
              .single();
            if (msgErr || !msg) {
              console.error('send error', msgErr);
              return;
            }

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
          }}
        />
      </div>

      {callState && <CallModal callState={callState} onClose={() => setCallState(null)} />}
    </div>
  );
}
