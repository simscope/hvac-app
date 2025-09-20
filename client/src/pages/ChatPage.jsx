// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

const RECEIPTS_USER_COLUMN = 'user_id';
const isVisible = () =>
  typeof document !== 'undefined' && document.visibilityState === 'visible';

export default function ChatPage() {
  // === auth ===
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

  // === left: chats ===
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  const bumpUnread = useCallback((chatId, delta) => {
    setChats(prev => prev.map(c => c.chat_id === chatId
      ? { ...c, unread_count: Math.max(0, (c.unread_count || 0) + delta) }
      : c));
  }, []);
  const zeroUnread = useCallback((chatId) => {
    setChats(prev => prev.map(c => c.chat_id === chatId ? { ...c, unread_count: 0 } : c));
  }, []);
  const touchLastAt = useCallback((chatId, ts) => {
    setChats(prev => prev.map(c => c.chat_id === chatId ? { ...c, last_at: ts || c.last_at } : c));
  }, []);

  const unreadTotal = useMemo(
    () => chats.reduce((s, c) => s + (c.unread_count || 0), 0),
    [chats]
  );
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: unreadTotal } }));
  }, [unreadTotal]);

  const loadChats = useCallback(async () => {
    const { data: mems, error: memErr } = await supabase
      .from('chat_members')
      .select('chat_id');
    if (memErr) { console.error('chat_members', memErr); setChats([]); return; }

    const chatIds = [...new Set((mems || []).map(m => m.chat_id))];
    if (!chatIds.length) { setChats([]); return; }

    const { data: chatsData, error: chatsErr } = await supabase
      .from('chats')
      .select('id, title, is_group, updated_at, created_at')
      .in('id', chatIds);
    if (chatsErr) { console.error('chats', chatsErr); setChats([]); return; }

    const { data: lastMsgs } = await supabase
      .from('chat_messages')
      .select('chat_id, created_at')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });

    const lastByChat = {};
    (lastMsgs || []).forEach(m => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m.created_at; });

    const mapped = (chatsData || [])
      .map(c => ({
        chat_id: c.id,
        title: c.title,
        is_group: c.is_group,
        last_at: lastByChat[c.id] || c.updated_at || c.created_at || null,
        unread_count: 0,
      }))
      .sort((a,b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

    setChats(mapped);
    if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
  }, [activeChatId]);

  useEffect(() => {
    loadChats();

    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const m = payload.new;
        touchLastAt(m.chat_id, m.created_at);
        if (m.author_id !== selfId) {
          const sameChatOpen = m.chat_id === activeChatId;
          if (!sameChatOpen || !isVisible()) bumpUnread(m.chat_id, 1);
        }
      })
      .subscribe();

    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [loadChats, selfId, activeChatId, bumpUnread, touchLastAt]);

  // === right: messages & receipts ===
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({});
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);
  const [callState, setCallState] = useState(null);

  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);
  const typingChannelRef = useRef(null);

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
      (techs || []).forEach(t => { map[t.id] = t.name || t.id; });
      setMemberNames(map);
      setMembers(ids.map(id => ({ id, name: map[id] || (id ?? '').slice(0,8) })));
    })();
  }, [activeChatId]);

  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return [];
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data || []);
      return data || [];
    } catch (e) {
      console.error('fetchMessages', e);
      setMessages([]);
      return [];
    } finally {
      setLoadingMessages(false);
    }
  }, []);

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

  const markChatOpened = useCallback(async (chatId, msgs) => {
    if (!chatId || !selfId) return;

    const idsToRead = (msgs || messages || [])
      .filter(m => m.author_id !== selfId)
      .map(m => m.id);

    if (idsToRead.length) {
      const rows = idsToRead.map(message_id => ({
        chat_id: chatId,
        message_id,
        [RECEIPTS_USER_COLUMN]: selfId,
        status: 'read',
      }));
      await supabase
        .from('message_receipts')
        .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true })
        .catch(() => {});
      setReceipts(prev => {
        const next = { ...prev };
        for (const mid of idsToRead) {
          const cur = next[mid] || { delivered: new Set(), read: new Set() };
          cur.delivered.add(selfId);
          cur.read.add(selfId);
          next[mid] = cur;
        }
        return next;
      });
    }

    const latest = (msgs || messages || []).length
      ? (msgs || messages)[(msgs || messages).length - 1].created_at
      : new Date().toISOString();

    await supabase
      .from('chat_members')
      .update({ last_read_at: latest })
      .eq('chat_id', chatId)
      .eq('member_id', selfId)
      .catch(() => {});
    zeroUnread(chatId);
  }, [messages, selfId, zeroUnread]);

  useEffect(() => {
    if (!activeChatId) return;

    (async () => {
      const fresh = await fetchMessages(activeChatId); // <= возвращаем массив
      await loadReceipts(activeChatId);
      await markChatOpened(activeChatId, fresh);       // <= передаём свежие сообщения
    })();

    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages(prev => [...prev, m]);
          touchLastAt(m.chat_id, m.created_at);

          if (!selfId) return;

          if (m.author_id !== selfId) {
            await supabase.from('message_receipts').upsert(
              [{ chat_id: m.chat_id, message_id: m.id, [RECEIPTS_USER_COLUMN]: selfId, status: 'delivered' }],
              { onConflict: 'message_id,user_id,status', ignoreDuplicates: true }
            ).catch(() => {});

            if (isVisible()) {
              await supabase.from('message_receipts').upsert(
                [{ chat_id: m.chat_id, message_id: m.id, [RECEIPTS_USER_COLUMN]: selfId, status: 'read' }],
                { onConflict: 'message_id,user_id,status', ignoreDuplicates: true }
              ).catch(() => {});
              await supabase.from('chat_members')
                .update({ last_read_at: m.created_at })
                .eq('chat_id', m.chat_id)
                .eq('member_id', selfId)
                .catch(() => {});
              setReceipts(prev => {
                const cur = prev[m.id] || { delivered: new Set(), read: new Set() };
                const delivered = new Set(cur.delivered); delivered.add(selfId);
                const read = new Set(cur.read); read.add(selfId);
                return { ...prev, [m.id]: { delivered, read } };
              });
              zeroUnread(m.chat_id);
            } else {
              bumpUnread(m.chat_id, 1);
            }
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new;
          setReceipts(prev => {
            const cur = prev[r.message_id] || { delivered: new Set(), read: new Set() };
            const delivered = new Set(cur.delivered);
            const read = new Set(cur.read);
            if (r.status === 'delivered') delivered.add(r[RECEIPTS_USER_COLUMN]);
            if (r.status === 'read') { delivered.add(r[RECEIPTS_USER_COLUMN]); read.add(r[RECEIPTS_USER_COLUMN]); }
            return { ...prev, [r.message_id]: { delivered, read } };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } }).subscribe();
    typingChannelRef.current = tCh;

    const poll = setInterval(() => loadReceipts(activeChatId), 4000);
    return () => {
      clearInterval(poll);
      try { if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current); } catch {}
      try { if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current); } catch {}
      try { if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current); } catch {}
    };
  }, [activeChatId, selfId, fetchMessages, loadReceipts, markChatOpened, bumpUnread, zeroUnread, touchLastAt]);

  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      [RECEIPTS_USER_COLUMN]: selfId,
      status: 'read',
    }));

    await supabase.from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true })
      .catch(() => {});

    const lastMessage = messages.find(m => m.id === ids[ids.length - 1]);
    const ts = lastMessage?.created_at || new Date().toISOString();
    await supabase.from('chat_members')
      .update({ last_read_at: ts })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId)
      .catch(() => {});

    setReceipts(prev => {
      const next = { ...prev };
      for (const mid of ids) {
        const cur = next[mid] || { delivered: new Set(), read: new Set() };
        cur.delivered.add(selfId);
        cur.read.add(selfId);
        next[mid] = cur;
      }
      return next;
    });
    zeroUnread(activeChatId);
  }, [activeChatId, selfId, messages, zeroUnread]);

  const [typing, setTyping] = useState({});
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2 ? ` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  const activeChat = useMemo(
    () => chats.find(c => c.chat_id === activeChatId) || null,
    [chats, activeChatId]
  );

  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />
      </div>

      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={activeChat}
          typingText={typingNames}
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
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>
        <div style={{borderTop:'1px solid #eee', padding:'8px 12px'}}>
          <MessageInput
            chatId={activeChatId}
            currentUser={{ id: selfId }}
            disabledSend={!canSend}
            onTyping={(name) => {
              if (!typingChannelRef.current || !activeChatId || !selfId) return;
              typingChannelRef.current.send({
                type:'broadcast',
                event:'typing',
                payload:{ userId: selfId, name, untilTs: Date.now()+4000 }
              });
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select().single();
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

              await supabase.from('chat_members')
                .update({ last_read_at: msg.created_at })
                .eq('chat_id', activeChatId)
                .eq('member_id', selfId)
                .catch(() => {});
              zeroUnread(activeChatId);
            }}
          />
          {!canSend && (
            <div style={{fontSize:12, color:'#888', marginTop:6}}>
              Войдите, чтобы отправлять сообщения.
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
