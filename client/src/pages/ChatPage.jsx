// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';

const RECEIPTS_USER_COLUMN = 'user_id';
const PROFILE_FIELDS = 'id, full_name, role';
const AUTHOR_FK_ALIAS = 'chat_messages_author_fk';

export default function ChatPage() {
  /** ─────────── AUTH ─────────── */
  const [user, setUser] = useState(null);
  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
      sub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null)).data?.subscription;
    })();
    return () => sub?.unsubscribe?.();
  }, []);
  const selfId = user?.id ?? null;
  const canSend = !!selfId;

  /** ─────────── CHATS ─────────── */
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [unreadByChat, setUnreadByChat] = useState({});

  // Нормализатор
  const mapChats = useCallback((rows) => {
    return (rows || []).map((r) => ({
      chat_id: r.id,
      title: r.title,
      is_group: r.is_group,
      last_at: r.updated_at,
    }));
  }, []);

  // 1) Пробуем через JOIN
  const loadChatsViaJoin = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('chats')
      .select('id, title, is_group, updated_at, deleted, chat_members!inner(member_id)')
      .eq('chat_members.member_id', uid)
      .eq('deleted', false)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[CHAT] load via JOIN error:', error);
      return { rows: [], err: error };
    }
    const rows = mapChats(data);
    console.log('[CHAT] join rows:', rows.length);
    return { rows, err: null };
  }, [mapChats]);

  // 2) Запасной план: два запроса без JOIN
  const loadChatsViaTwoStep = useCallback(async (uid) => {
    // ids из chat_members
    const { data: mems, error: mErr } = await supabase
      .from('chat_members')
      .select('chat_id')
      .eq('member_id', uid);

    if (mErr) {
      console.error('[CHAT] two-step members error:', mErr);
      return { rows: [], err: mErr };
    }
    const ids = Array.from(new Set((mems || []).map((m) => m.chat_id))).filter(Boolean);
    if (!ids.length) return { rows: [], err: null };

    const { data: chatsData, error: cErr } = await supabase
      .from('chats')
      .select('id, title, is_group, updated_at, deleted')
      .in('id', ids)
      .eq('deleted', false)
      .order('updated_at', { ascending: false });

    if (cErr) {
      console.error('[CHAT] two-step chats error:', cErr);
      return { rows: [], err: cErr };
    }
    const rows = mapChats(chatsData);
    console.log('[CHAT] two-step rows:', rows.length);
    return { rows, err: null };
  }, [mapChats]);

  useEffect(() => {
    if (!selfId) {
      setChats([]);
      setActiveChatId(null);
      setUnreadByChat({});
      return;
    }

    let channel;

    const loadAll = async () => {
      // 1) JOIN
      const { rows } = await loadChatsViaJoin(selfId);

      if (rows.length) {
        setChats(rows);
        if (!activeChatId) setActiveChatId(rows[0].chat_id);
      } else {
        // 2) fallback
        const { rows: rows2 } = await loadChatsViaTwoStep(selfId);
        setChats(rows2);
        if (!activeChatId && rows2.length) setActiveChatId(rows2[0].chat_id);
      }

      // counters RPC (если включено RLS — остаётся прежним)
      const { data: counters, error: uErr } = await supabase.rpc('get_unread_by_chat');
      if (uErr) {
        console.warn('[CHAT] unread counters rpc error:', uErr);
      } else {
        const dict = {};
        (counters || []).forEach((row) => (dict[row.chat_id] = Number(row.unread) || 0));
        setUnreadByChat(dict);
      }
    };

    loadAll();

    // realtime для «списка чатов»
    channel = supabase
      .channel('chats-overview')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;

          setChats((prev) => {
            const arr = [...prev];
            const i = arr.findIndex((c) => c.chat_id === m.chat_id);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: m.created_at };
              arr.sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
            }
            return arr;
          });

          if (selfId && m.author_id !== selfId && m.chat_id !== activeChatId) {
            setUnreadByChat((prev) => ({ ...prev, [m.chat_id]: (prev[m.chat_id] || 0) + 1 }));
          }
        },
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [selfId, activeChatId, loadChatsViaJoin, loadChatsViaTwoStep]);

  /** ─────────── MEMBERS / NAMES ─────────── */
  const [members, setMembers] = useState([]);
  const [memberNames, setMemberNames] = useState({});

  useEffect(() => {
    if (!activeChatId) {
      setMembers([]);
      setMemberNames({});
      return;
    }
    (async () => {
      const { data: mems, error } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      if (error) {
        console.error('[CHAT] members error:', error);
        setMembers([]);
        setMemberNames({});
        return;
      }
      const ids = (mems || []).map((m) => m.member_id).filter(Boolean);
      setMembers(ids);

      if (!ids.length) { setMemberNames({}); return; }

      const { data: profs, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids);

      if (pErr) {
        console.warn('[CHAT] profiles load error:', pErr);
        setMemberNames({});
        return;
      }
      const dict = {};
      (profs || []).forEach((p) => (dict[p.id] = p.full_name || '—'));
      setMemberNames(dict);
    })();
  }, [activeChatId]);

  /** ─────────── MESSAGES / RECEIPTS ─────────── */
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({});
  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  const fetchAuthor = useCallback(async (authorId) => {
    if (!authorId) return null;
    const { data } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', authorId).single();
    return data || null;
  }, []);

  const backfillAuthors = useCallback(async (rows) => {
    const missingIds = Array.from(new Set(rows.filter((r) => !r.author && r.author_id).map((r) => r.author_id)));
    if (!missingIds.length) return rows;

    const { data: profs, error } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .in('id', missingIds);

    if (error) {
      console.warn('[CHAT] backfill authors error:', error);
      return rows;
    }
    const map = new Map((profs || []).map((p) => [p.id, p]));
    return rows.map((r) => (r.author ? r : ({ ...r, author: map.get(r.author_id) || null })));
  }, []);

  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);

    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        id, chat_id, author_id, body, file_url, file_name, file_type, file_size, attachment_url, created_at,
        author:profiles!${AUTHOR_FK_ALIAS} ( ${PROFILE_FIELDS} )
      `)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    setLoadingMessages(false);
    if (error) {
      console.error('[CHAT] messages load error:', error);
      setMessages([]);
      return;
    }
    const withAuthors = await backfillAuthors(data || []);
    setMessages(withAuthors);
  }, [backfillAuthors]);

  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});

    (async () => {
      try { await supabase.rpc('mark_chat_read', { p_chat_id: activeChatId }); }
      catch (e) { console.warn('[CHAT] mark_chat_read error:', e); }
    })();
    setUnreadByChat((prev) => ({ ...prev, [activeChatId]: 0 }));

    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat:${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          const author = await fetchAuthor(m.author_id);
          setMessages((prev) => [...prev, { ...m, author }]);

          if (selfId && m.author_id !== selfId) {
            const row = {
              chat_id: m.chat_id,
              message_id: m.id,
              [RECEIPTS_USER_COLUMN]: selfId,
              status: 'delivered',
            };
            const { error } = await supabase
              .from('message_receipts')
              .upsert([row], { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
            if (error) console.warn('[CHAT] deliver upsert error:', error);
          }
        },
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts:${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (p) => {
          const r = p.new;
          setReceipts((prev) => {
            const obj = { ...prev };
            const entry = obj[r.message_id] || { delivered: new Set(), read: new Set() };
            const target = r.status === 'read' ? entry.read : entry.delivered;
            target.add(r.user_id);
            obj[r.message_id] = entry;
            return obj;
          });
        },
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    return () => {
      try { supabase.removeChannel(msgCh); } catch {}
      try { supabase.removeChannel(rCh); } catch {}
    };
  }, [activeChatId, selfId, fetchMessages, fetchAuthor]);

  /** ─────────── READ receipts ─────────── */
  const markReadForMessageIds = useCallback(
    async (ids) => {
      if (!ids?.length || !selfId || !activeChatId) return;

      const rows = ids.map((message_id) => ({
        chat_id: activeChatId,
        message_id,
        [RECEIPTS_USER_COLUMN]: selfId,
        status: 'read',
      }));

      const { error } = await supabase
        .from('message_receipts')
        .upsert(rows, { onConflict: 'message_id,user_id,status', ignoreDuplicates: true });
      if (error) console.warn('[CHAT] receipts read upsert error:', error);

      try {
        await supabase
          .from('chat_members')
          .update({ last_read_at: new Date().toISOString() })
          .eq('chat_id', activeChatId)
          .eq('member_id', selfId);
      } catch {}
    },
    [activeChatId, selfId],
  );

  /** ─────────── SEND ─────────── */
  const handleSend = useCallback(
    async ({ text, files }) => {
      if (!activeChatId || !selfId) return;

      const f = files?.[0] || null;
      const row = {
        chat_id: activeChatId,
        author_id: selfId,
        body: (text || '').trim() || null,
        file_url: null,
        file_name: f ? f.name : null,
        file_type: f ? f.type : null,
        file_size: f ? f.size : null,
        attachment_url: null,
      };

      const { error } = await supabase.from('chat_messages').insert(row);
      if (error) {
        console.error('[CHAT] send error:', error);
        alert(error.message || 'Не удалось отправить сообщение');
      }
    },
    [activeChatId, selfId],
  );

  /** ─────────── NAV badge ─────────── */
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    }
  }, [unreadByChat]);

  const typingText = useMemo(() => '', []);

  /** ─────────── RENDER ─────────── */
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <div style={{ borderBottom: '1px solid #eee', background: '#fff', position: 'sticky', top: 0, zIndex: 2 }}>
        <ChatHeader
          chat={chats.find((c) => c.chat_id === activeChatId) || null}
          typingText={typingText}
          members={members}
          memberNames={memberNames}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}>
        <div style={{ borderRight: '1px solid #eee', overflow: 'auto' }}>
          <div style={{ padding: '12px' }}><h3 style={{ margin: 0 }}>Чаты</h3></div>
          <ChatList chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} unreadByChat={unreadByChat} />
        </div>

        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <div style={{ overflow: 'auto' }}>
            <MessageList
              messages={messages}
              loading={loadingMessages}
              currentUserId={selfId}
              receipts={receipts}
              onMarkVisibleRead={markReadForMessageIds}
              memberNames={memberNames}
            />
          </div>
          <div style={{ borderTop: '1px solid #eee', padding: '10px', background: '#fff' }}>
            <MessageInput chatId={activeChatId} onSend={handleSend} onSent={() => {}} canSend={canSend} />
          </div>
        </div>
      </div>
    </div>
  );
}
