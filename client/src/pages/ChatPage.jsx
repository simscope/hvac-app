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

  // receipts: { [messageId]: { delivered:Set<id>, read:Set<id> } }
  const [receipts, setReceipts] = useState({});

  // typing users: { [id]: { name, untilTs } }
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  const [callState, setCallState] = useState(null); // {chatId, role:'caller'|'callee', to?, offer?, from?}
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);       // [{id,name}] для кнопок звонка

  // ===== уведомления =====
  const canNotify = typeof window !== 'undefined' && 'Notification' in window;
  const [notifPerm, setNotifPerm] = useState(canNotify ? Notification.permission : 'denied');
  const [tabFocused, setTabFocused] = useState(typeof document !== 'undefined' ? document.hasFocus() : true);

  useEffect(() => {
    const onFocus = () => setTabFocused(true);
    const onBlur = () => setTabFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const askNotif = useCallback(async () => {
    if (!canNotify) return;
    try {
      const p = await Notification.requestPermission();
      setNotifPerm(p);
    } catch {}
  }, [canNotify]);

  // короткий «пик» (если уведомления запрещены)
  const beep = useCallback((duration = 120, freq = 880, volume = 0.08) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, duration);
    } catch {}
  }, []);

  const showNotification = useCallback((title, body, onClick) => {
    if (canNotify && notifPerm === 'granted') {
      try {
        const n = new Notification(title, { body });
        n.onclick = () => {
          try { window.focus(); } catch {}
          onClick?.();
          n.close();
        };
      } catch {
        beep();
      }
    } else {
      // нет разрешения — хотя бы звук
      beep();
    }
  }, [canNotify, notifPerm, beep]);

  // в тайтле вкладки показываем суммарное непрочитанное
  const totalUnread = useMemo(
    () => (chats || []).reduce((s, c) => s + (c.unread_count || 0), 0),
    [chats]
  );
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    if (totalUnread > 0) document.title = `(${totalUnread}) ${base}`;
    else document.title = base;
  }, [totalUnread]);

  // === кто мы: auth.uid или technicians.id из localStorage / window ===
  const appMemberId = (typeof window !== 'undefined')
    ? (window.APP_MEMBER_ID || localStorage.getItem('member_id') || null)
    : null;

  const authUid = user?.id || null;        // строгое auth.uid() — для квитанций/прав
  const selfId  = authUid || appMemberId;  // автор сообщений/участник
  const canSend = Boolean(selfId);

  // --- AUTH session
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

  // безопасная вставка квитанции через RPC (сервер проглатывает дубли)
  const addReceipt = useCallback(async ({ chatId, messageId, status }) => {
    if (!authUid) return; // без логина квитанции не пишем
    try {
      await supabase.rpc('add_message_receipt', {
        p_chat_id: chatId,
        p_message_id: messageId,
        p_status: status,
      });
    } catch (e) {
      console.warn('[add_message_receipt RPC]', e);
    }
  }, [authUid]);

  // === Загрузка СПИСКА чатов ===
  useEffect(() => {
    const loadChats = async () => {
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
        .select('id, chat_id, body, created_at')
        .in('chat_id', chatIds)
        .order('created_at', { ascending: false });

      const lastByChat = {};
      (lastMsgs || []).forEach(m => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m; });

      const mapped = (chatsData || [])
        .map(c => ({
          chat_id: c.id,
          title: c.title,
          is_group: c.is_group,
          last_body: lastByChat[c.id]?.body ?? null,
          last_at: lastByChat[c.id]?.created_at ?? c.updated_at ?? c.created_at ?? null,
          unread_count: 0
        }))
        .sort((a,b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };

    loadChats();

    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, loadChats)
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId]);

  // === Имена участников активного чата ===
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
      setMembers(ids.map(id => ({ id, name: map[id] || (id ?? '').slice(0,8) })));
    })();
  }, [activeChatId]);

  // === Сообщения активного чата ===
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) console.error('chat_messages', error);
    setMessages(data || []);
  }, []);

  // Подписки: chat_messages + message_receipts + typing + call
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});

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

          // delivered — только если есть auth.uid(); user_id поставит триггер
          if (authUid && m.author_id !== authUid) {
            await addReceipt({ chatId: m.chat_id, messageId: m.id, status: 'delivered' });
          }

          // уведомление + непрочитанное, если сообщение не от нас
          if (m.author_id !== selfId) {
            const isActiveChat = m.chat_id === activeChatId;
            if (!tabFocused || !isActiveChat) {
              // имя автора (если знаем)
              const authorName =
                memberNames[m.author_id] ||
                Object.values(memberNames)[0] ||
                'Новый mesaj';
              const chatTitle = (chats.find(c => c.chat_id === m.chat_id)?.title) || 'Чат';
              showNotification(`${authorName} • ${chatTitle}`, (m.body || 'Вложение'), () => {
                setActiveChatId(m.chat_id);
              });

              // увеличиваем счётчик непрочитанного
              setChats((prev) => prev.map(c => c.chat_id === m.chat_id
                ? { ...c, unread_count: (isActiveChat && tabFocused) ? 0 : (c.unread_count || 0) + 1 }
                : c
              ));
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
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          setReceipts((prev) => {
            const { message_id, user_id: uid, status } = payload.new;
            const cur = prev[message_id] || { delivered: new Set(), read: new Set() };
            const delivered = new Set(cur.delivered);
            const read = new Set(cur.read);
            if (status === 'delivered') delivered.add(uid);
            if (status === 'read') { delivered.add(uid); read.add(uid); }
            return { ...prev, [message_id]: { delivered, read } };
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing + адресные звонки
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { userId, name, untilTs } = (payload.payload || {});
        if (!userId || (selfId && userId === selfId)) return;
        setTyping((prev) => ({ ...prev, [userId]: { name, untilTs } }));
      })
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

    // автоочистка "печатает…"
    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((uid) => { if (!next[uid] || next[uid].untilTs < now) delete next[uid]; });
        return next;
      });
    }, 1500);

    return () => {
      clearInterval(prune);
      if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
      if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    };
  }, [activeChatId, authUid, selfId, fetchMessages, addReceipt, memberNames, showNotification, chats, tabFocused]);

  // Сброс непрочитанного при открытии чата/фокусе
  useEffect(() => {
    if (!activeChatId) return;
    if (tabFocused) {
      setChats((prev) => prev.map(c => c.chat_id === activeChatId ? { ...c, unread_count: 0 } : c));
    }
  }, [activeChatId, tabFocused]);

  // Отметка read — через RPC
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !authUid || !activeChatId) return;
    for (const messageId of ids) {
      await addReceipt({ chatId: activeChatId, messageId, status: 'read' });
    }
    try {
      const { error } = await supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('chat_id', activeChatId)
        .eq('member_id', selfId);
      if (error) console.warn('[chat_members.update last_read_at]', error);
    } catch (e) {
      console.warn('[chat_members.update last_read_at] thrown', e);
    }
  }, [activeChatId, authUid, selfId, addReceipt]);

  // «кто печатает»
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2 ? ` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  // Быстрый вызов конкретному участнику
  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      {/* Левая колонка — список чатов */}
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px', gap:8}}>
          <h3 style={{margin:0}}>Чаты {totalUnread > 0 && <span style={{fontSize:12, color:'#2563eb'}}>• {totalUnread}</span>}</h3>
          {canNotify && notifPerm !== 'granted' && (
            <button onClick={askNotif} style={{padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff', cursor:'pointer'}}>
              🔔 Уведомления
            </button>
          )}
        </div>
        <ChatList chats={chats} activeChatId={activeChatId} onSelect={(id) => { setActiveChatId(id); }} />
      </div>

      {/* Правая колонка — текущий диалог */}
      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
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
              try {
                const { data: msg, error: msgErr } = await supabase
                  .from('chat_messages')
                  .insert({ chat_id: activeChatId, author_id: selfId, body: (text?.trim() || null) })
                  .select()
                  .single();
                if (msgErr) { console.error('[chat_messages.insert]', msgErr); return; }

                if (files && files.length) {
                  let i = 0;
                  for (const f of files) {
                    try {
                      const cleanName = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                      const path = `${activeChatId}/${msg.id}/${Date.now()}_${cleanName}`;
                      const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                      if (!up.error && i === 0) {
                        const { error: updErr } = await supabase
                          .from('chat_messages')
                          .update({ file_url: path, file_name: cleanName, file_type: f.type, file_size: f.size })
                          .eq('id', msg.id);
                        if (updErr) console.warn('[chat_messages.update attachment]', updErr);
                      }
                      if (up.error) console.warn('[storage.upload]', up.error);
                    } catch (e) {
                      console.warn('[attachment upload thrown]', e);
                    }
                    i++;
                  }
                }
              } catch (e) {
                console.error('[onSend thrown]', e);
              }
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
