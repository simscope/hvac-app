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

  const [chats, setChats] = useState([]);           // [{chat_id,title,is_group,last_body,last_at,unread_count}]
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
  const [members, setMembers] = useState([]);       // [{id,name}]

  const [tabFocused, setTabFocused] = useState(typeof document !== 'undefined' ? document.hasFocus() : true);
  useEffect(() => {
    const onFocus = () => setTabFocused(true);
    const onBlur  = () => setTabFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); };
  }, []);

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
      // eslint-disable-next-line no-console
      console.warn('[add_message_receipt RPC]', e);
    }
  }, [authUid]);

  /* ================= UNREAD helpers ================= */

  // отправляем суммарный счётчик наружу (для бейджа «Чат» в основном меню)
  const pushUnreadTotal = useCallback((total) => {
    try { localStorage.setItem('CHAT_UNREAD_TOTAL', String(total)); } catch {}
    try { window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } })); } catch {}
  }, []);

  // пересчёт суммарного при любом изменении списка чатов
  useEffect(() => {
    const total = (chats || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    pushUnreadTotal(total);
  }, [chats, pushUnreadTotal]);

  // начальная инициализация unread по last_read_at
  const initUnreadCounts = useCallback(async (chatIds) => {
    if (!selfId || !chatIds?.length) return;

    // мои отметки прочитанного по чатам
    const { data: myMarks } = await supabase
      .from('chat_members')
      .select('chat_id,last_read_at')
      .in('chat_id', chatIds)
      .eq('member_id', selfId);

    const lastByChat = {};
    (myMarks || []).forEach(r => { lastByChat[r.chat_id] = r.last_read_at; });

    // для каждого чата считаем количество сообщений после last_read_at (автор != selfId)
    const results = {};
    for (const cid of chatIds) {
      const last = lastByChat[cid] || '1970-01-01';
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', cid)
        .neq('author_id', selfId)
        .gt('created_at', last);
      results[cid] = count || 0;
    }

    setChats((prev) => prev.map(c => ({ ...c, unread_count: results[c.chat_id] ?? 0 })));
  }, [selfId]);

  // удобный setter: инкремент/сброс счётчика у конкретного чата
  const incUnread = useCallback((chatId, delta = 1) => {
    setChats((prev) => prev.map(c => c.chat_id === chatId ? { ...c, unread_count: (c.unread_count || 0) + delta } : c));
  }, []);
  const resetUnread = useCallback((chatId) => {
    setChats((prev) => prev.map(c => c.chat_id === chatId ? { ...c, unread_count: 0 } : c));
  }, []);

  /* =============== Загрузка списка чатов =============== */
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

      // посчитали стартовые непрочитанные
      await initUnreadCounts(chatIds);
    };

    loadChats();

    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, loadChats)
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, initUnreadCounts]);

  /* =============== Имена участников текущего чата =============== */
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

  /* =============== Сообщения активного чата =============== */
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
    // при входе в чат сразу сбрасываем его локальный счётчик
    resetUnread(activeChatId);

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

          // если это НЕ наш чат/нет фокуса — инкрементируем счётчик у соответствующего чата
          const isThisChat = (m.chat_id === activeChatId);
          const focused = tabFocused;
          if (!(isThisChat && focused) && m.author_id !== selfId) {
            incUnread(m.chat_id, 1);
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
  }, [activeChatId, authUid, selfId, tabFocused, fetchMessages, addReceipt, incUnread, resetUnread]);

  // Сброс непрочитанного при фокусе окна на уже открытом чате
  useEffect(() => {
    if (tabFocused && activeChatId) resetUnread(activeChatId);
  }, [tabFocused, activeChatId, resetUnread]);

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

  // Отрисовка маленьких бейджей в списке чатов (если ваш ChatList их не показывает)
  const renderChatList = () => {
    // Если ваш компонент ChatList уже отображает unread_count — просто верните его как раньше:
    // return <ChatList chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />;
    // Минимальная собственная реализация с бейджами:
    return (
      <div style={{display:'grid'}}>
        {chats.map(c => (
          <button
            key={c.chat_id}
            onClick={() => setActiveChatId(c.chat_id)}
            style={{
              textAlign:'left',
              padding:'10px 12px',
              border:'none',
              borderBottom:'1px solid #f1f5f9',
              background: c.chat_id === activeChatId ? '#f8fafc' : '#fff',
              cursor:'pointer',
              display:'flex',
              justifyContent:'space-between',
              alignItems:'center'
            }}
          >
            <span style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.title || 'Чат'}</span>
            {!!c.unread_count && (
              <span style={{
                background:'#ef4444', color:'#fff', borderRadius: 9999, padding:'2px 8px',
                fontSize:12, fontWeight:700, marginLeft:8, minWidth:20, textAlign:'center'
              }}>
                {c.unread_count}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      {/* Левая колонка — список чатов + бейджи */}
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        {renderChatList()}
        {/* Если хотите использовать ваш компонент: 
          <ChatList chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />
        */}
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

                // прикрепления
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

                // (опционально) дернуть вашу функцию пуш-рассылки, если она нужна
                // try {
                //   await supabase.functions.invoke('push-broadcast', { body: { chat_id: activeChatId, message_id: msg.id } });
                // } catch {}

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
