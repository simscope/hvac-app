// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';
import MessageInput from '../components/chat/MessageInput';

export default function ChatPage() {
  const [user, setUser] = useState(null);

  const [chats, setChats] = useState([]);   // [{chat_id,title,last_body,last_at,unread_count}]
  const [activeChatId, setActiveChatId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [receipts, setReceipts] = useState({}); // { [messageId]: { delivered:Set, read:Set } }

  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  const [callState, setCallState] = useState(null);
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // фокус вкладки — чтоб не считать прочитанным без пользователя
  const [tabFocused, setTabFocused] = useState(document.hasFocus());
  useEffect(() => {
    const onFocus = () => setTabFocused(true);
    const onBlur  = () => setTabFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); };
  }, []);

  // кто мы
  const appMemberId = window.APP_MEMBER_ID || localStorage.getItem('member_id') || null;
  const authUid = user?.id || null;        // auth.uid() — для receipts
  const selfId  = authUid || appMemberId;  // автор сообщений
  const canSend = Boolean(selfId);

  /* -------- auth -------- */
  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      const { data } = supabase.auth.onAuthStateChange((_evt, sess) => setUser(sess?.user ?? null));
      unsub = data?.subscription?.unsubscribe || data?.unsubscribe;
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);

  /* -------- receipts RPC (без дублей) -------- */
  const addReceipt = useCallback(async ({ chatId, messageId, status }) => {
    if (!authUid) return; // квитанции — только для вошедших
    try {
      await supabase.rpc('add_message_receipt', {
        p_chat_id: chatId, p_message_id: messageId, p_status: status,
      });
    } catch (e) { console.warn('[add_message_receipt]', e); }
  }, [authUid]);

  /* -------- UNREAD helpers -------- */
  const pushUnreadTotal = useCallback((total) => {
    try { localStorage.setItem('CHAT_UNREAD_TOTAL', String(total)); } catch {}
    try { window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } })); } catch {}
  }, []);
  useEffect(() => {
    const total = (chats || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    pushUnreadTotal(total);
  }, [chats, pushUnreadTotal]);

  const resetUnread = useCallback((chatId) => {
    setChats((prev) => prev.map(c => c.chat_id === chatId ? { ...c, unread_count: 0 } : c));
  }, []);
  const incUnread = useCallback((chatId, d = 1) => {
    setChats((prev) => prev.map(c => c.chat_id === chatId ? { ...c, unread_count: (c.unread_count || 0) + d } : c));
  }, []);

  // начальный подсчёт непрочитанного из last_read_at
  const initUnreadCounts = useCallback(async (chatIds) => {
    if (!selfId || !chatIds?.length) return;
    const { data: marks } = await supabase
      .from('chat_members')
      .select('chat_id,last_read_at')
      .in('chat_id', chatIds)
      .eq('member_id', selfId);

    const byChat = {}; (marks||[]).forEach(r => byChat[r.chat_id] = r.last_read_at || '1970-01-01');

    const results = {};
    for (const cid of chatIds) {
      const last = byChat[cid] || '1970-01-01';
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count:'exact', head:true })
        .eq('chat_id', cid).neq('author_id', selfId).gt('created_at', last);
      results[cid] = count || 0;
    }
    setChats((prev) => prev.map(c => ({ ...c, unread_count: results[c.chat_id] ?? 0 })));
  }, [selfId]);

  /* -------- список чатов -------- */
  useEffect(() => {
    const loadChats = async () => {
      const { data: mems, error: memErr } = await supabase.from('chat_members').select('chat_id');
      if (memErr) { console.error(memErr); setChats([]); return; }
      const chatIds = [...new Set((mems||[]).map(m => m.chat_id))];
      if (!chatIds.length) { setChats([]); return; }

      const { data: cdata } = await supabase
        .from('chats').select('id,title,is_group,updated_at,created_at').in('id', chatIds);
      const { data: lastMsgs } = await supabase
        .from('chat_messages')
        .select('id,chat_id,body,created_at').in('chat_id', chatIds)
        .order('created_at', { ascending:false });

      const lastBy = {}; (lastMsgs||[]).forEach(m => { if (!lastBy[m.chat_id]) lastBy[m.chat_id] = m; });

      const mapped = (cdata||[])
        .map(c => ({
          chat_id: c.id,
          title: c.title,
          is_group: c.is_group,
          last_body: lastBy[c.id]?.body ?? null,
          last_at:  lastBy[c.id]?.created_at ?? c.updated_at ?? c.created_at ?? null,
          unread_count: 0,
        }))
        .sort((a,b) => new Date(b.last_at||0) - new Date(a.last_at||0));

      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
      await initUnreadCounts(chatIds);
    };

    loadChats();

    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages' }, loadChats)
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, initUnreadCounts]);

  /* -------- участники активного чата -------- */
  useEffect(() => {
    if (!activeChatId) { setMembers([]); setMemberNames({}); return; }
    (async () => {
      const { data: mems } = await supabase.from('chat_members').select('member_id').eq('chat_id', activeChatId);
      const ids = (mems||[]).map(m => m.member_id).filter(Boolean);
      if (!ids.length) { setMembers([]); setMemberNames({}); return; }
      const { data: techs } = await supabase.from('technicians').select('id,name').in('id', ids);
      const map = {}; (techs||[]).forEach(t => map[t.id] = t.name || t.id);
      setMemberNames(map);
      setMembers(ids.map(id => ({ id, name: map[id] || (id||'').slice(0,8) })));
    })();
  }, [activeChatId]);

  /* -------- загрузка сообщений активного чата -------- */
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id,chat_id,author_id,body,attachment_url,created_at,file_url,file_name,file_type,file_size')
      .eq('chat_id', chatId).order('created_at', { ascending:true });
    setLoadingMessages(false);
    if (error) console.error(error);
    setMessages(data||[]);
  }, []);

  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    resetUnread(activeChatId);

    // новые сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes',
        { event:'INSERT', schema:'public', table:'chat_messages', filter:`chat_id=eq.${activeChatId}` },
        async (payload) => {
          const { data: full } = await supabase.from('chat_messages')
            .select('id,chat_id,author_id,body,attachment_url,created_at,file_url,file_name,file_type,file_size')
            .eq('id', payload.new.id).single();
          const m = full || payload.new;
          setMessages(prev => [...prev, m]);

          // доставлено
          if (authUid && m.author_id !== authUid) await addReceipt({ chatId: m.chat_id, messageId: m.id, status: 'delivered' });

          // не активный чат/нет фокуса — увеличиваем счётчик
          const here = (m.chat_id === activeChatId);
          if (!(here && tabFocused) && m.author_id !== selfId) incUnread(m.chat_id, 1);
        })
      .subscribe();
    messagesSubRef.current = msgCh;

    // подписка на квитанции (для «галочек»)
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes',
        { event:'INSERT', schema:'public', table:'message_receipts', filter:`chat_id=eq.${activeChatId}` },
        (payload) => {
          setReceipts(prev => {
            const { message_id, user_id: uid, status } = payload.new;
            const cur = prev[message_id] || { delivered:new Set(), read:new Set() };
            const delivered = new Set(cur.delivered);
            const read = new Set(cur.read);
            if (status === 'delivered') delivered.add(uid);
            if (status === 'read') { delivered.add(uid); read.add(uid); }
            return { ...prev, [message_id]: { delivered, read } };
          });
        })
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config:{ broadcast:{ ack:false } } })
      .on('broadcast', { event:'typing' }, (payload) => {
        const { userId, name, untilTs } = payload.payload || {};
        if (!userId || (selfId && userId === selfId)) return;
        setTyping(prev => ({ ...prev, [userId]: { name, untilTs } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    // автоочистка «печатает…»
    const prune = setInterval(() => {
      const now = Date.now();
      setTyping(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(uid => { if (!next[uid] || next[uid].untilTs < now) delete next[uid]; });
        return next;
      });
    }, 1500);

    return () => {
      clearInterval(prune);
      if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
      if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    };
  }, [activeChatId, authUid, selfId, tabFocused, fetchMessages, addReceipt, incUnread, resetUnread]);

  // если вкладка вернулась в фокус — обнуляем активный чат
  useEffect(() => { if (tabFocused && activeChatId) resetUnread(activeChatId); }, [tabFocused, activeChatId, resetUnread]);

  // пометка «прочитано» для видимых сообщений (вызывает MessageList)
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !authUid || !activeChatId) return;
    for (const messageId of ids) await addReceipt({ chatId: activeChatId, messageId, status: 'read' });
    await supabase.from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId).eq('member_id', selfId);
  }, [activeChatId, authUid, selfId, addReceipt]);

  const typingText = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2?` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />
      </div>

      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader chat={chats.find(c => c.chat_id === activeChatId) || null} typingText={typingText} />
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
            disabledSend={!canSend}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;
              const { data: msg, error } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select().single();
              if (error) { console.error(error); return; }

              // вложения (первое — превью)
              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const clean = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${clean}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!up.error && i === 0) {
                    await supabase.from('chat_messages').update({
                      file_url: path, file_name: clean, file_type: f.type, file_size: f.size
                    }).eq('id', msg.id);
                  }
                  i++;
                }
              }
            }}
            onTyping={(name) => {
              if (!typingChannelRef.current || !activeChatId || !selfId) return;
              typingChannelRef.current.send({ type:'broadcast', event:'typing',
                payload:{ userId:selfId, name, untilTs: Date.now()+4000 } });
            }}
          />
        </div>
      </div>

      {callState && <CallModal state={callState} onClose={() => setCallState(null)} channelName={`typing:${activeChatId}`} />}
    </div>
  );
}


