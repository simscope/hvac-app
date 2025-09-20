import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';

const pageStyles = {
  root: {display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'},
  left: {borderRight:'1px solid #eee', padding:12, overflow:'auto'},
  right: {display:'flex', flexDirection:'column'},
};

function emitUnreadTotal(total) {
  localStorage.setItem('CHAT_UNREAD_TOTAL', String(total || 0));
  window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: total || 0 } }));
}

export default function ChatPage() {
  const [user, setUser] = useState(null);
  // selfId — auth.uid() (лучше всего). Если у вас используется "fake id" — замените.
  const selfId = user?.id || null;

  const [chats, setChats] = useState([]);             // [{id,title,is_group}]
  const [activeChatId, setActiveChatId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [receiptsMap, setReceiptsMap] = useState({}); // { [mid]: { delivered:Set, read:Set } }
  const [memberNames, setMemberNames] = useState({}); // { user_id: name }

  const [unreadByChat, setUnreadByChat] = useState({}); // { chat_id: count }

  const subsRef = useRef({}); // { messages, receipts, overview }

  /* ===== auth ===== */
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

  /* ===== загрузка чатов текущего пользователя ===== */
  const loadChats = useCallback(async () => {
    if (!selfId) { setChats([]); return; }
    const { data: mems, error: memErr } = await supabase
      .from('chat_members')
      .select('chat_id')
      .eq('member_id', selfId);
    if (memErr) { console.error(memErr); setChats([]); return; }

    const ids = [...new Set((mems || []).map(m => m.chat_id))];
    if (!ids.length) { setChats([]); return; }

    const { data: chs } = await supabase
      .from('chats')
      .select('id, title, is_group')
      .in('id', ids)
      .order('updated_at', { ascending: false });

    setChats(chs || []);
    if (!activeChatId && chs?.length) setActiveChatId(chs[0].id);

    // непрочитанные
    await refreshUnreadCounts(selfId);
  }, [selfId, activeChatId]);

  useEffect(() => { loadChats(); }, [loadChats]);

  /* ===== непрочитанные по чатам ===== */
  const refreshUnreadCounts = useCallback(async (uid) => {
    if (!uid) return;
    try {
      const { data, error } = await supabase.rpc('chat_unread_counts', { p_user: uid });
      if (error) throw error;
      const map = {};
      (data || []).forEach(r => { map[r.chat_id] = Number(r.unread || 0); });
      setUnreadByChat(map);
      const total = Object.values(map).reduce((a, b) => a + (b || 0), 0);
      emitUnreadTotal(total);
    } catch (e) {
      console.error('unread rpc', e);
    }
  }, []);

  /* ===== участники (имена для тултипов) ===== */
  const loadMemberNames = useCallback(async (chatId) => {
    const { data: mems } = await supabase
      .from('chat_members')
      .select('member_id')
      .eq('chat_id', chatId);
    const ids = (mems || []).map(m => m.member_id);
    if (!ids.length) { setMemberNames({}); return; }
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    const map = {};
    (profs || []).forEach(p => { map[p.id] = p.full_name || p.id; });
    setMemberNames(map);
  }, []);

  /* ===== загрузка сообщений + квитанций ===== */
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);

    const { data: msgs, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    if (error) console.error(error);
    setMessages(msgs || []);

    // квитанции по этим сообщениям
    const ids = (msgs || []).map(m => m.id);
    let recMap = {};
    if (ids.length) {
      const { data: recs } = await supabase
        .from('message_receipts')
        .select('message_id, user_id, status')
        .in('message_id', ids);
      recMap = groupReceipts(recs || []);
    }
    setReceiptsMap(recMap);

    setLoadingMessages(false);
  }, []);

  /* ===== подписки (активный чат) ===== */
  useEffect(() => {
    // чистим старые
    Object.values(subsRef.current || {}).forEach(ch => { try { supabase.removeChannel(ch); } catch {} });
    subsRef.current = {};

    if (!activeChatId) { setMessages([]); setReceiptsMap({}); return; }

    fetchMessages(activeChatId);
    loadMemberNames(activeChatId);

    // новые сообщения этого чата
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
          async payload => {
            const m = payload.new;
            setMessages(prev => [...prev, m]);

            // для чужого сообщения — помечаем «delivered»
            if (selfId && m.author_id !== selfId) {
              await safeUpsertReceipt({
                chat_id: m.chat_id,
                message_id: m.id,
                user_id: selfId,
                status: 'delivered'
              });
              // и пересчёт непрочитанных
              await refreshUnreadCounts(selfId);
            }
          }
      ).subscribe();

    // квитанции этого чата
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
          payload => {
            const r = payload.new;
            setReceiptsMap(prev => {
              const cur = prev[r.message_id] || { delivered:new Set(), read:new Set() };
              const delivered = new Set(cur.delivered);
              const read = new Set(cur.read);
              if (r.status === 'delivered') delivered.add(r.user_id);
              if (r.status === 'read') { delivered.add(r.user_id); read.add(r.user_id); }
              return { ...prev, [r.message_id]: { delivered, read } };
            });
          }
      ).subscribe();

    subsRef.current.messages = msgCh;
    subsRef.current.receipts = rCh;

    return () => {
      Object.values(subsRef.current || {}).forEach(ch => { try { supabase.removeChannel(ch); } catch {} });
      subsRef.current = {};
    };
  }, [activeChatId, selfId, fetchMessages, loadMemberNames, refreshUnreadCounts]);

  /* ===== подписка обзорная: любые новые сообщения в моих чатах → бэйджи ===== */
  useEffect(() => {
    if (!selfId) return;
    // все вставки в chat_messages → просто обновляем счётчики rpc
    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages' },
          () => refreshUnreadCounts(selfId)
      ).subscribe();
    subsRef.current.overview = ch;
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [selfId, refreshUnreadCounts]);

  /* ===== помечаем видимые сообщения как READ ===== */
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;
    const rows = ids.map(message_id => ({ chat_id: activeChatId, message_id, user_id: selfId, status:'read' }));
    await safeUpsertReceipt(rows);           // upsert со сдерживанием дублей
    await refreshUnreadCounts(selfId);       // обновляем бэйджи
  }, [selfId, activeChatId, refreshUnreadCounts]);

  /* ===== утилиты ===== */
  function groupReceipts(recs) {
    const map = {};
    for (const r of recs) {
      const cur = map[r.message_id] || { delivered:new Set(), read:new Set() };
      if (r.status === 'delivered') cur.delivered.add(r.user_id);
      if (r.status === 'read') { cur.delivered.add(r.user_id); cur.read.add(r.user_id); }
      map[r.message_id] = cur;
    }
    return map;
  }

  async function safeUpsertReceipt(payload) {
    // payload может быть одним объектом или массивом
    const rows = Array.isArray(payload) ? payload : [payload];
    try {
      const { error } = await supabase
        .from('message_receipts')
        .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
      if (error) throw error;
    } catch (e) {
      // при гонке может прилететь 409 — нас устраивает
      if (e?.code !== '23505') console.warn('upsert receipt', e);
    }
  }

  const canSend = Boolean(selfId);

  /* ===== рендер ===== */
  const currentChat = useMemo(() => chats.find(c => c.id === activeChatId) || null, [chats, activeChatId]);

  return (
    <div style={pageStyles.root}>
      {/* Левая колонка */}
      <div style={pageStyles.left}>
        <h3 style={{margin:'8px 0 12px'}}>Чаты</h3>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          unreadByChat={unreadByChat}
          onSelect={setActiveChatId}
        />
      </div>

      {/* Правая колонка */}
      <div style={pageStyles.right}>
        <div style={{padding:'12px 12px 0', borderBottom:'1px solid #eee', minHeight:54, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontWeight:800}}>{currentChat?.title || '—'}</div>
        </div>

        <div style={{flex:'1 1 auto', overflow:'auto', padding:'12px'}}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receiptsMap={receiptsMap}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{borderTop:'1px solid #eee', padding:'8px 12px'}}>
          <MessageInput chatId={activeChatId} currentUserId={selfId} disabledSend={!canSend} />
          {!canSend && (
            <div style={{fontSize:12, color:'#888', marginTop:6}}>
              Нужна auth-сессия для отправки.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
