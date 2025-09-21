// client/src/pages/ChatPage.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

/**
 * Допущения по БД:
 *  - chat_messages(id, chat_id, author_id, body, file_..., created_at)
 *  - message_receipts(chat_id, message_id, user_id, status) – UNIQUE(message_id,user_id,status)
 *  - chat_members(chat_id, member_id, last_read_at)
 *  - technicians(id, auth_user_id, name, is_active)
 *
 * ВАЖНО: onConflict для message_receipts используй 'message_id,user_id,status' (без chat_id)
 */

export default function ChatPage() {
  // Текущий пользователь
  const [user, setUser] = useState(null);
  const [profileName, setProfileName] = useState(null);

  // Список чатов и активный
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // Сообщения активного чата
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Квитанции: { [messageId]: { delivered:Set, read:Set } }
  const [receipts, setReceipts] = useState({});

  // "Печатает…"
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);

  // Подписки
  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // Звонки (заглушка, чтобы не терять функционал)
  const [callState, setCallState] = useState(null);

  // Имена участников
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // Непрочитанные
  const [unreadByChat, setUnreadByChat] = useState({});

  // Текущий participant id
  const appMemberId =
    typeof window !== 'undefined'
      ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
      : null;
  const selfId = user?.id || appMemberId;

  // Роль "user_id" в message_receipts
  const RECEIPTS_USER_COLUMN = 'user_id';
  const canSend = Boolean(selfId);

  // ------------------- auth session -------------------
  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user || null);

      // Имя из profiles/technicians — опционально
      try {
        const { data: t } = await supabase
          .from('technicians')
          .select('name')
          .eq('auth_user_id', data?.user?.id ?? '')
          .maybeSingle();
        if (t?.name) setProfileName(t.name);
      } catch {
        /* noop */
      }

      unsub = supabase.auth.onAuthStateChange((_e, s) => {
        setUser(s?.user || null);
      }).data?.subscription;
    })();

    return () => {
      try { unsub?.unsubscribe(); } catch {}
    };
  }, []);

  // ------------------- список чатов -------------------
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('chats list error', error);
        setChats([]);
        return;
      }
      const mapped = (data || []).map((c) => ({
        chat_id: c.id,
        title: c.title,
        last_at: c.updated_at,
      }));
      setChats(mapped);

      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };

    loadChats();

    // Подпишемся на новые сообщения — чтобы поднимать чат вверх
    const ch = supabase
      .channel('overview-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats((prev) => {
            const arr = [...prev];
            const idx = arr.findIndex((c) => c.chat_id === cid);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], last_at: payload.new.created_at };
              arr.sort(
                (a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0)
              );
            }
            return arr;
          });

          // Для бейджа в левой колонке
          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat((prev) => ({
              ...prev,
              [cid]: (prev[cid] || 0) + 1,
            }));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // ------------------- участники активного чата -------------------
  useEffect(() => {
    if (!activeChatId) {
      setMemberNames({});
      setMembers([]);
      return;
    }

    (async () => {
      const { data: mems } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);

      const ids = (mems || []).map((m) => m.member_id).filter(Boolean);
      if (!ids.length) {
        setMemberNames({});
        setMembers([]);
        return;
      }

      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name')
        .in('id', ids);

      const map = {};
      for (const t of techs || []) map[t.id] = t.name || t.id;
      setMemberNames(map);
      setMembers(ids);
    })();
  }, [activeChatId]);

  // ------------------- загрузка сообщений -------------------
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select(
        'id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size'
      )
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    setLoadingMessages(false);
    if (error) {
      console.error('chat_messages', error);
      setMessages([]);
      return;
    }
    setMessages(data || []);
  }, []);

  // ------------------- подписки по активному чату -------------------
  useEffect(() => {
    if (!activeChatId) return;

    // Загрузка и сброс состояния
    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat((prev) => ({ ...prev, [activeChatId]: 0 }));

    // --- Сообщения ---
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => [...prev, m]);

          // Ставим delivered для входящих (не своих)
          if (selfId && m.author_id !== selfId) {
            try {
              await supabase.from('message_receipts').upsert(
                [
                  {
                    chat_id: m.chat_id, // можно хранить, но в onConflict он не участвует
                    message_id: m.id,
                    [RECEIPTS_USER_COLUMN]: selfId,
                    status: 'delivered',
                  },
                ],
                { onConflict: 'message_id,user_id,status' }
              );
            } catch (e) {
              console.warn('delivered upsert error', e);
            }
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // --- Квитанции (✓/✓✓) ---
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new; // { chat_id, message_id, user_id, status }
          setReceipts((prev) => {
            const next = { ...prev };
            if (!next[r.message_id])
              next[r.message_id] = { delivered: new Set(), read: new Set() };
            if (r.status === 'delivered') next[r.message_id].delivered.add(r.user_id);
            if (r.status === 'read') {
              next[r.message_id].read.add(r.user_id);
              next[r.message_id].delivered.add(r.user_id);
            }
            return next;
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // --- "Печатает…" (broadcast) ---
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase
      .channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { user_id, name, ts } = payload.payload || {};
        if (!user_id || user_id === selfId) return;
        setTyping((prev) => ({ ...prev, [user_id]: { name, ts } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    // авто-подчистка "печатает…"
    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const copy = { ...prev };
        for (const [uid, val] of Object.entries(copy)) {
          if (!val?.ts || now - val.ts > 5000) delete copy[uid];
        }
        return copy;
      });
    }, 5000);

    // cleanup
    return () => {
      try { supabase.removeChannel(messagesSubRef.current); } catch {}
      try { supabase.removeChannel(receiptsSubRef.current); } catch {}
      try { supabase.removeChannel(typingChannelRef.current); } catch {}
      try { clearInterval(prune); } catch {}
    };
  }, [activeChatId, selfId, fetchMessages]);

  // ------------------- mark read для видимых сообщений -------------------
  const markReadForMessageIds = useCallback(
    async (ids) => {
      if (!ids?.length || !selfId || !activeChatId) return;
      const rows = ids.map((message_id) => ({
        chat_id: activeChatId,
        message_id,
        [RECEIPTS_USER_COLUMN]: selfId,
        status: 'read',
      }));
      try {
        await supabase.from('message_receipts').upsert(rows, {
          onConflict: 'message_id,user_id,status',
        });
      } catch (e) {
        console.warn('receipts upsert error', e);
      }
      try {
        await supabase
          .from('chat_members')
          .update({ last_read_at: new Date().toISOString() })
          .eq('chat_id', activeChatId)
          .eq('member_id', selfId);
      } catch {
        // noop
      }
    },
    [activeChatId, selfId]
  );

  // ------------------- строка "печатает…" -------------------
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map((t) => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${
      arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''
    } печатают…`;
  }, [typing]);

  // ------------------- быстрый звонок -------------------
  const startCallTo = useCallback(
    (targetId) => {
      if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
      setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
    },
    [activeChatId, selfId]
  );

  // ------------------- суммарный badge -------------------
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(
        new CustomEvent('chat-unread-changed', { detail: { total } })
      );
    }
  }, [unreadByChat]);

  // ------------------- render -------------------
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      {/* Левая колонка — список чатов */}
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onPick={(id) => setActiveChatId(id)}
          unreadByChat={unreadByChat}
        />
      </div>

      {/* Правая колонка — текущий диалог */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={chats.find((c) => c.chat_id === activeChatId) || null}
          typingText={typingNames}
          members={members}
          memberNames={memberNames}
          onCall={(id) => startCallTo(id)}
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{ padding: '12px', borderTop: '1px solid #eee' }}>
          <MessageInput
            chatId={activeChatId}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              // Сообщение
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({
                  chat_id: activeChatId,
                  author_id: selfId,
                  body: (text || '').trim() || null,
                })
                .select()
                .single();

              if (msgErr || !msg) {
                console.error('send error', msgErr);
                return;
              }

              // Файл(ы) — первый в превью
              if (files && files.length) {
                let i = 0;
                for (const f of files) {
                  const cleanName = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${msg.id}/${Date.now()}_${cleanName}`;
                  const up = await supabase.storage
                    .from('chat-attachments')
                    .upload(path, f, { contentType: f.type });
                  if (!up.error && i === 0) {
                    await supabase
                      .from('chat_messages')
                      .update({
                        file_url: path,
                        file_name: cleanName,
                        file_type: f.type,
                        file_size: f.size,
                      })
                      .eq('id', msg.id);
                  }
                  i++;
                }
              }
            }}
            onTypingPulse={async () => {
              // Лёгкий пульс о наборе текста
              try {
                await supabase
                  .channel(`typing:${activeChatId}`)
                  .send({
                    type: 'broadcast',
                    event: 'typing',
                    payload: {
                      user_id: selfId,
                      name: profileName || 'Пользователь',
                      ts: Date.now(),
                    },
                  });
              } catch {
                /* noop */
              }
            }}
            disabled={!canSend}
          />
        </div>
      </div>

      {callState && (
        <CallModal
          state={callState}
          onClose={() => setCallState(null)}
        />
      )}
    </div>
  );
}
