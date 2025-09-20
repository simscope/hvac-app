// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

/**
 * ВАЖНО:
 * В таблице public.message_receipts колонка пользователя должна называться member_id.
 * Если у тебя в БД колонка называется user_id — замени строку ниже на 'user_id'.
 */
const RECEIPTS_USER_COLUMN = 'member_id';

export default function ChatPage() {
  const [authUser, setAuthUser] = useState(null);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // receipts: { [messageId]: { delivered:Set<memberId>, read:Set<memberId> } }
  const [receipts, setReceipts] = useState({});

  // typing users: { [id]: { name, untilTs } }
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  const [callState, setCallState] = useState(null); // {chatId, role:'caller'|'callee', to?, offer?, from?}
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);       // [{id,name}] для кнопок звонка

  // === Кто мы? Для квитанций НУЖЕН именно technicians.id (member_id), а не auth.uid
  const appMemberId = (typeof window !== 'undefined')
    ? (window.APP_MEMBER_ID || localStorage.getItem('member_id') || null)
    : null;

  // отдаём приоритет member_id из локалки; если его нет — используем auth.uid (хватает для чтения)
  const selfId = appMemberId || authUser?.id || null;

  const canSend = Boolean(selfId);

  // --- AUTH session
  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setAuthUser(session?.user ?? null);
      const { data } = supabase.auth.onAuthStateChange((_evt, sess) => {
        setAuthUser(sess?.user ?? null);
      });
      unsub = data?.subscription?.unsubscribe || data?.unsubscribe;
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // === Загрузка СПИСКА чатов (chat_members -> chats -> last chat_messages)
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

  // === Имена участников активного чата (и массив для кнопок вызова)
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

  // ====================== КВИТАНЦИИ (галочки) =======================

  // применить одну квитанцию к локальному state
  const applyReceipt = useCallback((row) => {
    if (!row) return;
    const uid = row[RECEIPTS_USER_COLUMN];
    const mid = row.message_id;
    const st  = row.status;

    setReceipts(prev => {
      const cur = prev[mid] || { delivered: new Set(), read: new Set() };
      const delivered = new Set(cur.delivered);
      const read      = new Set(cur.read);

      if (st === 'delivered') delivered.add(uid);
      if (st === 'read') { delivered.add(uid); read.add(uid); }

      return { ...prev, [mid]: { delivered, read } };
    });
  }, []);

  // загрузка сообщений активного чата + начальные квитанции
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) { console.error('chat_messages', error); setMessages([]); setReceipts({}); return; }

    setMessages(data || []);

    // подтянуть начальные квитанции для всех сообщений этого чата
    const ids = (data || []).map(m => m.id);
    if (ids.length) {
      const { data: recs } = await supabase
        .from('message_receipts')
        .select(`message_id,status,${RECEIPTS_USER_COLUMN}`)
        .in('message_id', ids);

      const map = {};
      (recs || []).forEach(r => {
        const uid = r[RECEIPTS_USER_COLUMN];
        const mid = r.message_id;
        const st  = r.status;
        if (!map[mid]) map[mid] = { delivered: new Set(), read: new Set() };
        if (st === 'delivered') map[mid].delivered.add(uid);
        if (st === 'read') { map[mid].delivered.add(uid); map[mid].read.add(uid); }
      });
      setReceipts(map);
    } else {
      setReceipts({});
    }
  }, []);

  // Подписки: chat_messages + message_receipts + typing + адресный call
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setTyping({});

    // --- сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          // подхватим полную строку
          const { data: full } = await supabase
            .from('chat_messages')
            .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
            .eq('id', payload.new.id)
            .single();
          const m = full || payload.new;
          setMessages((prev) => [...prev, m]);

          // входящее -> квитанция "доставлено" (idempotent)
          if (selfId && m.author_id !== selfId) {
            const base = { chat_id: m.chat_id, message_id: m.id, status: 'delivered', [RECEIPTS_USER_COLUMN]: selfId };
            const { error } = await supabase
              .from('message_receipts')
              .upsert(base, { onConflict: 'message_id,member_id,status' }); // если у тебя уникальный индекс на 2 колонки — поменяй на 'message_id,member_id'
            if (!error) applyReceipt(base);
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // --- квитанции (слушаем INSERT и UPDATE)
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => applyReceipt(payload.new)
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // --- typing + адресные звонки
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
  }, [activeChatId, selfId, fetchMessages, applyReceipt]);

  // Отметка read для видимых сообщений (idempotent upsert)
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    for (const message_id of ids) {
      const row = { chat_id: activeChatId, message_id, status: 'read', [RECEIPTS_USER_COLUMN]: selfId };
      const { error } = await supabase
        .from('message_receipts')
        .upsert(row, { onConflict: 'message_id,member_id,status' }); // см. комментарий выше
      if (!error) applyReceipt(row);
    }

    await supabase.from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('member_id', selfId);
  }, [activeChatId, selfId, applyReceipt]);

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
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
        />
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
            disabledSend={!canSend}   // печатать можно, отправка — только если есть selfId
            onTyping={(name) => {
              if (!typingChannelRef.current || !activeChatId || !selfId) return;
              typingChannelRef.current.send({
                type:'broadcast',
                event:'typing',
                payload:{ userId: selfId, name, untilTs: Date.now()+4000 }
              });
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) {
                alert('Нет прав или не определён участник чата');
                return;
              }
              // 1) создаём запись сообщения
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select().single();
              if (msgErr) {
                console.error('chat_messages.insert', msgErr);
                alert(`Ошибка отправки: ${msgErr.message || 'insert chat_messages'}`);
                return;
              }

              // 2) если есть файлы — грузим и патчим первую запись
              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const cleanName = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${cleanName}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type || undefined });
                  if (up.error) {
                    console.error('upload error', up.error);
                    alert(`Не удалось загрузить файл: ${cleanName}`);
                    continue;
                  }
                  if (i === 0) {
                    const { error: updErr } = await supabase
                      .from('chat_messages')
                      .update({ file_url: path, file_name: cleanName, file_type: f.type || null, file_size: f.size || null })
                      .eq('id', msg.id);
                    if (updErr) console.error('update msg file_*', updErr);
                  }
                  i++;
                }
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
          state={callState}              // { role, to?, offer? }
          user={{ id: selfId }}
          onClose={() => setCallState(null)}
          channelName={`typing:${activeChatId}`} // тот же канал broadcast, что и typing
        />
      )}
    </div>
  );
}
