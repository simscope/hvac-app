// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';

const log = (...a) => console.log('[CHAT]:', ...a);

export default function ChatPage() {
  // ===== AUTH =====
  const [sessionUser, setSessionUser] = useState(null);
  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSessionUser(session?.user ?? null);
      log('auth session', session?.user?.id);
      const { data } = supabase.auth.onAuthStateChange((_evt, sess) => {
        log('auth state change', sess?.user?.id);
        setSessionUser(sess?.user ?? null);
      });
      unsub = data?.subscription?.unsubscribe || data?.unsubscribe;
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);
  const selfId = sessionUser?.id ?? null;

  // ===== CHATS =====
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  const unreadTotal = useMemo(
    () => chats.reduce((s, c) => s + (c.unread_count || 0), 0),
    [chats]
  );
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: unreadTotal } }));
  }, [unreadTotal]);

  const loadChats = useCallback(async () => {
    log('loadChats: start');
    try {
      const { data: mems, error: memErr } = await supabase
        .from('chat_members')
        .select('chat_id');
      if (memErr) throw memErr;
      const chatIds = [...new Set((mems || []).map(m => m.chat_id))];
      if (!chatIds.length) { setChats([]); log('loadChats: no chat membership'); return; }

      const { data: chatsData, error: chatsErr } = await supabase
        .from('chats')
        .select('id, title, is_group, updated_at, created_at')
        .in('id', chatIds);
      if (chatsErr) throw chatsErr;

      const mapped = (chatsData || []).map(c => ({
        chat_id: c.id,
        title: c.title,
        is_group: c.is_group,
        last_at: c.updated_at || c.created_at || null,
        unread_count: 0,
      }));
      mapped.sort((a,b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
      log('loadChats: done, chats=', mapped.length);
    } catch (e) {
      console.error('[CHAT]: loadChats error', e);
      setChats([]);
    }
  }, [activeChatId]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // ===== MESSAGES =====
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const timeoutRef = useRef(null);

  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    log('fetchMessages: start for chat', chatId);
    setLoadingMessages(true);

    // Предохранитель: чтобы “Загрузка…” не висела вечно даже при скрытой ошибке
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      log('fetchMessages: safety timeout fired, forcing loading=false');
      setLoadingMessages(false);
    }, 8000);

    try {
      const { data, error, status } = await supabase
        .from('chat_messages')
        .select('id, chat_id, author_id, body, created_at, file_url, file_name, file_type, file_size, attachment_url')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      log('fetchMessages: response status', status, 'rows=', data?.length ?? 0);
      if (error) throw error;

      setMessages(data || []);
    } catch (e) {
      console.error('[CHAT]: fetchMessages error', e);
      // если RLS — будет e.code = 'PGRST.../42501' или похожее
      setMessages([]);
    } finally {
      clearTimeout(timeoutRef.current);
      setLoadingMessages(false);
      log('fetchMessages: finally (loading=false)');
    }
  }, []);

  // грузим при выборе чата
  useEffect(() => {
    if (!activeChatId) return;
    fetchMessages(activeChatId);
  }, [activeChatId, fetchMessages]);

  // ===== HEADER / MEMBERS (только для отображения) =====
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);
  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }
    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);
      if (error) { console.error('[CHAT]: members error', error); setMembers([]); return; }
      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      if (!ids.length) { setMembers([]); return; }
      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name')
        .in('id', ids);
      const map = {};
      (techs || []).forEach(t => { map[t.id] = t.name || t.id; });
      setMemberNames(map);
      setMembers(ids.map(id => ({ id, name: map[id] || (id ?? '').slice(0,8) })));
    })();
  }, [activeChatId]);

  // ===== SEND =====
  const canSend = Boolean(selfId);
  const activeChat = useMemo(
    () => chats.find(c => c.chat_id === activeChatId) || null,
    [chats, activeChatId]
  );

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      {/* LEFT */}
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList chats={chats} activeChatId={activeChatId} onSelect={(id)=>{ log('select chat', id); setActiveChatId(id); }} />
      </div>

      {/* RIGHT */}
      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={activeChat}
          typingText={''}
          members={members}
          selfId={selfId}
          onCallTo={()=>{}}
          canCall={false}
        />
        <div style={{flex:'1 1 auto', overflow:'auto', padding:'12px'}}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={{}}
            onMarkVisibleRead={()=>{}}
            memberNames={memberNames}
          />
        </div>
        <div style={{borderTop:'1px solid #eee', padding:'8px 12px'}}>
          <MessageInput
            chatId={activeChatId}
            currentUser={{ id: selfId }}
            disabledSend={!canSend}
            onTyping={()=>{}}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;
              const body = text?.trim() || null;
              log('send message', { chatId: activeChatId, author: selfId, body, files: files?.length || 0 });
              const { data: msg, error } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body })
                .select().single();
              if (error) { console.error('[CHAT]: send error', error); return; }

              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const clean = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${clean}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!up.error && i === 0) {
                    await supabase.from('chat_messages')
                      .update({ file_url: path, file_name: clean, file_type: f.type, file_size: f.size })
                      .eq('id', msg.id);
                  }
                  i++;
                }
              }
              // локально добавим, чтобы UI не ждал realtime
              setMessages(prev => [...prev, msg]);
            }}
          />
          {!canSend && (
            <div style={{fontSize:12, color:'#888', marginTop:6}}>
              Войдите, чтобы отправлять сообщения.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
