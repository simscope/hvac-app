// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';
import CallModal from '../components/chat/CallModal.jsx';

// В message_receipts у нас user_id (НЕ member_id)
const RECEIPTS_USER_COLUMN = 'user_id';

/**
 * Страница чата:
 * - Загружает список чатов и сообщения активного чата
 * - Подписывается на новые сообщения / квитанции / "печатает…"
 * - Отмечает delivered / read
 * - Поддерживает отправку текста и файлов
 */
export default function ChatPage() {
  // ---------------------------- auth ----------------------------
  const [user, setUser] = useState(null);

  useEffect(() => {
    let unsub = null;

    (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);

      unsub = supabase.auth.onAuthStateChange((_evt, sess) => {
        setUser(sess?.user ?? null);
      }).data?.subscription ?? null;
    })();

    return () => {
      try { unsub?.unsubscribe?.(); } catch (_) {}
    };
  }, []);

  // Для SSR/гостей поддержим member_id из window/localStorage (как в проекте раньше)
  const appMemberId =
    typeof window !== 'undefined'
      ? (window.APP_MEMBER_ID || localStorage.getItem('member_id') || null)
      : null;
  const selfId = user?.id || appMemberId;
  const canSend = Boolean(selfId);

  // ---------------------------- state ----------------------------
  const [chats, setChats] = useState([]);                  // список чатов
  const [activeChatId, setActiveChatId] = useState(null);  // выбранный чат

  const [messages, setMessages] = useState([]);            // сообщения активного чата
  const [loadingMessages, setLoadingMessages] = useState(false);

  // receipts: { [messageId]: { delivered:Set, read:Set } }
  const [receipts, setReceipts] = useState({});

  // участники активного чата и отображаемые имена
  const [members, setMembers] = useState([]);
  const [memberNames, setMemberNames] = useState({});

  // кто печатает сейчас
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);

  // подписки
  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // звонки (опционально)
  const [callState, setCallState] = useState(null);

  // непрочитанные в списке чатов + суммарный бейдж
  const [unreadByChat, setUnreadByChat] = useState({});

  // ---------------------------- helpers ----------------------------
  const publishUnreadBadge = useCallback((map) => {
    const total = Object.values(map).reduce((s, n) => s + (n || 0), 0);
    try {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      const ev = new CustomEvent('chat-unread-changed', { detail: { total } });
      window.dispatchEvent(ev);
    } catch (_) {}
  }, []);

  const upsertReceiptsLocal = useCallback((rows) => {
    // rows: [{message_id, status, user_id}]
    setReceipts((prev) => {
      const copy = { ...prev };
      for (const r of rows) {
        const mid = r.message_id;
        const status = r.status;
        const uid = r[RECEIPTS_USER_COLUMN];
        if (!copy[mid]) copy[mid] = { delivered: new Set(), read: new Set() };
        if (status === 'delivered') copy[mid].delivered.add(uid);
        if (status === 'read') {
          copy[mid].delivered.add(uid);
          copy[mid].read.add(uid);
        }
      }
      return copy;
    });
  }, []);

  // ---------------------------- загрузка чатов ----------------------------
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, updated_at, created_at')
        .eq('deleted', false)
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('load chats error', error);
        setChats([]);
        return;
      }

      const mapped = (data || []).map((c) => ({
        chat_id: c.id,
        title: c.title || 'Без названия',
        last_at: c.updated_at || c.created_at
      }));

      setChats(mapped);
      if (!activeChatId && mapped.length) {
        setActiveChatId(mapped[0].chat_id);
      }
    };

    loadChats();

    // при новом сообщении просто поднимаем чат
    const ch = supabase
      .channel('overview-messages')
      .on(
        'postgres_changes',
        { schema: 'public', table: 'chat_messages', event: 'INSERT' },
        (payload) => {
          const cid = payload.new.chat_id;
          setChats((prev) => {
            const arr = [...prev];
            const i = arr.findIndex((x) => x.chat_id === cid);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: payload.new.created_at };
              arr.sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
            }
            return arr;
          });

          // если сообщение не в активном чате и не наше — увеличиваем счётчик
          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat((prev) => {
              const map = { ...prev, [cid]: (prev[cid] || 0) + 1 };
              publishUnreadBadge(map);
              return map;
            });
          }
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [activeChatId, selfId, publishUnreadBadge]);

  // ---------------------------- участники активного чата ----------------------------
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
        console.warn('members load error', error);
        setMembers([]);
        setMemberNames({});
        return;
      }

      const ids = (mems || []).map((m) => m.member_id).filter(Boolean);
      setMembers(ids);

      if (!ids.length) {
        setMemberNames({});
        return;
      }

      // подгрузим имена из technicians (или вашей таблицы профилей)
      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name')
        .in('id', ids);

      const map = {};
      for (const t of techs || []) map[t.id] = t.name || t.id;
      setMemberNames(map);
    })();
  }, [activeChatId]);

  // ---------------------------- загрузка сообщений ----------------------------
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);

    if (error) {
      console.error('chat_messages load error', error);
      setMessages([]);
      return;
    }
    setMessages(data || []);
  }, []);

  // ---------------------------- подписки для активного чата ----------------------------
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    // при заходе в чат — обнуляем локальный счётчик
    setUnreadByChat((prev) => {
      const map = { ...prev, [activeChatId]: 0 };
      publishUnreadBadge(map);
      return map;
    });

    // ----- сообщения -----
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on(
        'postgres_changes',
        { schema: 'public', table: 'chat_messages', event: 'INSERT', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages((prev) => [...prev, m]);

          // delivered для входящих
          if (selfId && m.author_id !== selfId) {
            try {
              const { error: upErr } = await supabase
                .from('message_receipts')
                .upsert(
                  [{ chat_id: m.chat_id, message_id: m.id, [RECEIPTS_USER_COLUMN]: selfId, status: 'delivered' }],
                  { onConflict: 'message_id,user_id,status' }
                );
              if (upErr) console.warn('delivered upsert error', upErr);
            } catch (e) {
              console.warn('delivered upsert throw', e);
            }
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // ----- квитанции -----
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on(
        'postgres_changes',
        { schema: 'public', table: 'message_receipts', event: 'INSERT', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new;
          upsertReceiptsLocal([r]);
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // ----- typing -----
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase
      .channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { uid, name } = payload.payload || {};
        setTyping((prev) => ({ ...prev, [uid]: { name, ts: Date.now() } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    // авто-подчищаем "печатает"
    const prune = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (now - (next[k]?.ts || 0) > 3000) delete next[k];
        }
        return next;
      });
    }, 1500);

    return () => {
      try { supabase.removeChannel(msgCh); } catch (_) {}
      try { supabase.removeChannel(rCh); } catch (_) {}
      try { supabase.removeChannel(tCh); } catch (_) {}
      clearInterval(prune);
    };
  }, [activeChatId, selfId, fetchMessages, upsertReceiptsLocal, publishUnreadBadge]);

  // ---------------------------- пометка прочитанного ----------------------------
  const markReadForMessageIds = useCallback(
    async (ids) => {
      if (!ids?.length || !selfId || !activeChatId) return;

      const rows = ids.map((message_id) => ({
        chat_id: activeChatId,
        message_id,
        [RECEIPTS_USER_COLUMN]: selfId,
        status: 'read'
      }));

      try {
        const { error: upErr } = await supabase
          .from('message_receipts')
          .upsert(rows, { onConflict: 'message_id,user_id,status' });
        if (upErr) console.warn('receipts upsert error', upErr);
      } catch (e) {
        console.warn('receipts upsert throw', e);
      }

      try {
        const { error: updErr } = await supabase
          .from('chat_members')
          .update({ last_read_at: new Date().toISOString() })
          .eq('chat_id', activeChatId)
          .eq('member_id', selfId);
        if (updErr) console.warn('chat_members update error', updErr);
      } catch (e) {
        console.warn('chat_members update throw', e);
      }
    },
    [activeChatId, selfId]
  );

  // ---------------------------- typing subtitle ----------------------------
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map((t) => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0, 2).join(', ')}${arr.length > 2 ? ` и ещё ${arr.length - 2}` : ''} печатают…`;
  }, [typing]);

  // ---------------------------- звонок конкретному участнику ----------------------------
  const startCallTo = useCallback(
    (targetId) => {
      if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
      setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
    },
    [activeChatId, selfId]
  );

  // ---------------------------- render ----------------------------
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 64px)' }}>
      {/* Левая колонка: список чатов */}
      <div style={{ borderRight: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
          <h3 style={{ margin: 0 }}>Чаты</h3>
        </div>

        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={(id) => setActiveChatId(id)}
          unreadByChat={unreadByChat}
        />
      </div>

      {/* Правая колонка: текущий диалог */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ChatHeader
          chat={chats.find((c) => c.chat_id === activeChatId) || null}
          subtitle={typingNames}
          onStartCall={startCallTo}
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{ padding: 12, borderTop: '1px solid #eee' }}>
          <MessageInput
            chatId={activeChatId}
            onTyping={() => {
              try {
                typingChannelRef.current?.send({
                  type: 'broadcast',
                  event: 'typing',
                  payload: { uid: selfId, name: memberNames[selfId] || 'Кто-то' }
                });
              } catch (_) {}
            }}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              // 1) создаём сообщение
              const body = (text || '').trim() || null;
              let created = null;

              try {
                const { data, error } = await supabase
                  .from('chat_messages')
                  .insert({ chat_id: activeChatId, author_id: selfId, body })
                  .select()
                  .single();
                if (error) {
                  console.error('insert message error', error);
                  return;
                }
                created = data;
              } catch (e) {
                console.error('insert message throw', e);
                return;
              }

              // 2) при наличии файла — загрузим первый и обновим запись
              if (files && files.length) {
                try {
                  const f = files[0];
                  const clean = f.name.replace(/[^0-9A-Za-z._-]+/g, '_');
                  const path = `${activeChatId}/${created.id}/${Date.now()}_${clean}`;
                  const up = await supabase.storage.from('chat-attachments').upload(path, f, { contentType: f.type });
                  if (!up.error) {
                    const { error: updErr } = await supabase
                      .from('chat_messages')
                      .update({
                        file_url: path,
                        file_name: clean,
                        file_type: f.type,
                        file_size: f.size
                      })
                      .eq('id', created.id);
                    if (updErr) console.warn('update message with file error', updErr);
                  }
                } catch (e) {
                  console.warn('file upload throw', e);
                }
              }
            }}
            disabled={!canSend || !activeChatId}
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
