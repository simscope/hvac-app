// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

export default function ChatPage() {
  // auth
  const [user, setUser] = useState(null);
  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user || null);
      unsub = supabase.auth.onAuthStateChange((_e, sess) => {
        setUser(sess?.user || null);
      }).data?.subscription;
    })();
    return () => { try { unsub?.unsubscribe(); } catch {} };
  }, []);
  const selfId = user?.id || (typeof window !== 'undefined' ? window.APP_MEMBER_ID : null);

  // chats
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get('chat') || null;
  });

  // messages / receipts
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({});
  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // typing & calls
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const [callState, setCallState] = useState(null);

  // members
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // unread counters for side list + top badge event
  const [unreadByChat, setUnreadByChat] = useState({});

  // ===== load chats
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('chats')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200);
      const mapped = (data || []).map(r => ({ chat_id: r.id, title: r.title, last_at: r.updated_at }));
      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };
    load();

    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages' }, (p) => {
        const cid = p.new.chat_id;
        setChats(prev => {
          const arr = [...prev];
          const i = arr.findIndex(x => x.chat_id === cid);
          if (i >= 0) {
            arr[i] = { ...arr[i], last_at: p.new.created_at };
            arr.sort((a,b)=> new Date(b.last_at||0) - new Date(a.last_at||0));
          }
          return arr;
        });
        if (cid !== activeChatId && selfId && p.new.author_id !== selfId) {
          setUnreadByChat(prev => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }));
        }
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // ===== members for active chat
  useEffect(() => {
    if (!activeChatId) { setMembers([]); setMemberNames({}); return; }
    (async () => {
      const { data: mems } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);
      const ids = (mems || []).map(m => m.member_id);
      setMembers(ids);
      if (!ids.length) { setMemberNames({}); return; }
      const { data: techs } = await supabase
        .from('technicians')
        .select('auth_user_id, name')
        .in('auth_user_id', ids);
      const names = {};
      (techs || []).forEach(t => { names[t.auth_user_id] = t.name; });
      setMemberNames(names);
    })();
  }, [activeChatId]);

  // ===== messages loader
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    setMessages(error ? [] : (data || []));
  }, []);

  // ===== subscribe per active chat
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 }));

    // subscribe messages
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`chat_id=eq.${activeChatId}` }, async (payload) => {
        const m = payload.new;
        setMessages(prev => [...prev, m]);

        // ставим delivered на входящее
        if (selfId && m.author_id !== selfId) {
          try {
            await supabase.from('message_receipts').upsert([{
              chat_id: m.chat_id,
              message_id: m.id,
              user_id: selfId,
              status: 'delivered'
            }], { onConflict: 'chat_id,message_id,user_id' });
          } catch {}
        }
      })
      .subscribe();
    messagesSubRef.current = msgCh;

    // receipts
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'message_receipts', filter:`chat_id=eq.${activeChatId}` }, (p) => {
        const r = p.new;
        setReceipts(prev => {
          const st = prev[r.message_id] || { delivered:new Set(), read:new Set() };
          const next = {
            delivered: new Set(st.delivered),
            read: new Set(st.read)
          };
          if (r.status === 'delivered') next.delivered.add(r.user_id);
          if (r.status === 'read')      next.read.add(r.user_id);
          return { ...prev, [r.message_id]: next };
        });
      })
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config:{ broadcast:{ ack:false } } })
      .on('broadcast', { event: 'typing' }, (p) => {
        const { from, name } = p.payload || {};
        if (!from || from === selfId) return;
        setTyping(prev => ({ ...prev, [from]: { name, ts: Date.now() } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    // авто-подчищаем typing
    const prune = setInterval(() => {
      const now = Date.now();
      setTyping(prev => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if ((now - (next[k]?.ts || 0)) > 3000) delete next[k];
        return next;
      });
    }, 1000);

    // помечаем уведомления этого чата как прочитанные
    (async () => {
      try {
        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', selfId)
          .eq('type', 'chat:new_message')
          .contains('payload', { chat_id: activeChatId })
          .is('read_at', null);
      } catch {}
    })();

    return () => {
      clearInterval(prune);
      supabase.removeChannel(msgCh);
      supabase.removeChannel(rCh);
      supabase.removeChannel(tCh);
    };
  }, [activeChatId, selfId, fetchMessages]);

  // mark read for visible messages
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;
    try {
      // единственный уникальный индекс у тебя — (chat_id,message_id,user_id) => используем его
      const rows = ids.map(message_id => ({
        chat_id: activeChatId,
        message_id,
        user_id: selfId,
        status: 'read'
      }));
      await supabase.from('message_receipts').upsert(rows, { onConflict: 'chat_id,message_id,user_id' });

      // обновим last_read_at
      await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);

      // и сразу чистим уведомления по этому чату
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', selfId)
        .eq('type', 'chat:new_message')
        .contains('payload', { chat_id: activeChatId })
        .is('read_at', null);
    } catch {}
  }, [activeChatId, selfId]);

  // typing text
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2 ? ` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  // emit top-nav badge event
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s,n)=> s+(n||0), 0);
    localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail:{ total } }));
  }, [unreadByChat]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          setActiveChatId={setActiveChatId}
          unreadByChat={unreadByChat}
        />
      </div>

      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typingText={typingNames}
          members={members}
          memberNames={memberNames}
          onCall={(toId) => setCallState({ chatId: activeChatId, role:'caller', to: toId })}
        />

        <div style={{flex:'1 1 auto', overflow:'auto', padding:12}}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            memberNames={memberNames}
            onMarkVisibleRead={markReadForMessageIds}
          />
        </div>

        <div style={{padding:12, borderTop:'1px solid #eee'}}>
          <MessageInput
            chatId={activeChatId}
            onSent={() => {}}
            onTyping={(payload) => {
              if (!typingChannelRef.current) return;
              typingChannelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload
              });
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              // создаём сообщение
              const { data: msg, error } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select()
                .single();
              if (error || !msg) return;

              // первый файл пишем в поля файла сообщения
              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const clean = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${clean}`;
                  const res = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!res.error && i === 0) {
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
          state={callState}
          onClose={() => setCallState(null)}
          selfId={selfId}
          chatId={activeChatId}
          members={members}
        />
      )}
    </div>
  );
}
