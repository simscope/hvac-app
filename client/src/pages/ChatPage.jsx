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

  // чаты/активный чат
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // сообщения
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // квитанции: { [messageId]: { delivered:Set, read:Set } }
  const [receipts, setReceipts] = useState({});

  // печатает/вещания
  const [typing, setTyping] = useState({});
  const typingChannelRef = useRef(null);
  const receiptsSubRef = useRef(null);
  const messagesSubRef = useRef(null);

  // звонки
  const [callState, setCallState] = useState(null);

  // участники активного чата (имена для тиков)
  const [memberNames, setMemberNames] = useState({});
  const [members, setMembers] = useState([]);

  // локальные счётчики непрочитанных по чатам
  const [unreadByChat, setUnreadByChat] = useState({});

  // текущий участник
  const appMemberId =
    typeof window !== 'undefined'
      ? window.APP_MEMBER_ID || localStorage.getItem('member_id') || null
      : null;
  const selfId = user?.id || appMemberId;
  const canSend = Boolean(selfId);

  // auth session
  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user || null);
      unsub = supabase.auth.onAuthStateChange((_event, sess) => {
        setUser(sess?.user || null);
      }).data?.subscription;
    })();
    return () => { try { unsub?.unsubscribe?.(); } catch {} };
  }, []);

  // список чатов
  useEffect(() => {
    const loadChats = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) { console.error(error); return; }

      const mapped = (data || []).map(row => ({
        chat_id: row.id,
        title: row.title,
        last_at: row.updated_at || row.created_at,
      }));
      setChats(mapped);
      if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
    };

    loadChats();

    // поднимаем чат при новых сообщениях
    const ch = supabase
      .channel('overview-messages')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const cid = payload.new.chat_id;

          setChats(prev => {
            const arr = [...prev];
            const idx = arr.findIndex(c => c.chat_id === cid);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], last_at: payload.new.created_at };
              arr.sort((a,b)=> new Date(b.last_at||0) - new Date(a.last_at||0));
            }
            return arr;
          });

          // увеличиваем badge если чат не активен и сообщение не наше
          if (cid !== activeChatId && selfId && payload.new.author_id !== selfId) {
            setUnreadByChat(prev => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [activeChatId, selfId]);

  // участники активного чата (для имён в тиках)
  useEffect(() => {
    if (!activeChatId) { setMemberNames({}); setMembers([]); return; }

    (async () => {
      const { data: mems } = await supabase
        .from('chat_members')
        .select('member_id')
        .eq('chat_id', activeChatId);
      const ids = (mems || []).map(m => m.member_id).filter(Boolean);
      setMembers(ids);
      if (!ids.length) { setMemberNames({}); return; }

      const { data: techs } = await supabase
        .from('technicians')
        .select('id, name')
        .in('id', ids);

      const map = {};
      (techs || []).forEach(t => { map[t.id] = t.name; });
      setMemberNames(map);
    })();
  }, [activeChatId]);

  // загрузка сообщений
  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) { console.error('chat_messages', error); setMessages([]); return; }
    setMessages(data || []);
  }, []);

  // подписки по активному чату
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});
    setTyping({});
    setUnreadByChat(prev => ({ ...prev, [activeChatId]: 0 }));

    // === сообщения ===
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat-${activeChatId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          setMessages(prev => [...prev, m]);

          // ставим delivered для входящих, БЕЗ конфликтов
          if (selfId && m.author_id !== selfId) {
            const row = {
              chat_id: m.chat_id,
              message_id: m.id,
              user_id: selfId,        // важная колонка в вашей схеме
              status: 'delivered',
            };
            // у вас есть 2 UNIQUE индекса, поэтому:
            await supabase
              .from('message_receipts')
              .upsert([row], {
                onConflict: 'chat_id,message_id,user_id', // совпадает с ux_receipts_chat_msg_user
                ignoreDuplicates: true                    // не затираем возможный 'read'
              });
          }
        }
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // === квитанции ===
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts-${activeChatId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (payload) => {
          const r = payload.new;
          setReceipts(prev => {
            const obj = { ...prev };
            if (!obj[r.message_id]) obj[r.message_id] = { delivered:new Set(), read:new Set() };
            if (r.status === 'delivered') obj[r.message_id].delivered.add(r.user_id);
            if (r.status === 'read')      obj[r.message_id].read.add(r.user_id);
            return obj;
          });
        }
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    // typing
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    const tCh = supabase.channel(`typing:${activeChatId}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (!payload?.payload) return;
        const { user_id, name } = payload.payload;
        if (user_id === selfId) return;
        setTyping(prev => ({ ...prev, [user_id]: { ts: Date.now(), name } }));
      })
      .subscribe();
    typingChannelRef.current = tCh;

    const prune = setInterval(() => {
      const now = Date.now();
      setTyping(prev => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if ((now - next[k].ts) > 3000) delete next[k];
        }
        return next;
      });
    }, 1500);

    return () => {
      supabase.removeChannel(msgCh);
      supabase.removeChannel(rCh);
      supabase.removeChannel(tCh);
      clearInterval(prune);
    };
  }, [activeChatId, selfId, fetchMessages]);

  // помечаем сообщения прочитанными
  const markReadForMessageIds = useCallback(async (ids) => {
    if (!ids?.length || !selfId || !activeChatId) return;

    // 1) простое UPDATE — так мы избегаем уникальных конфликтов
    await supabase
      .from('message_receipts')
      .update({ status: 'read', updated_at: new Date().toISOString() })
      .eq('chat_id', activeChatId)
      .eq('user_id', selfId)
      .in('message_id', ids);

    // 2) на случай отсутствующих строк — добиваем INSERT, игнорируя дубликаты
    const rows = ids.map(message_id => ({
      chat_id: activeChatId,
      message_id,
      user_id: selfId,
      status: 'read',
    }));
    await supabase
      .from('message_receipts')
      .upsert(rows, {
        onConflict: 'chat_id,message_id,user_id',
        ignoreDuplicates: true,
      });

    // 3) синхронно гасим уведомления (если используете таблицу notifications)
    await supabase
      .from('notifications')
      .update({ seen: true, seen_at: new Date().toISOString() })
      .eq('user_id', selfId)
      .eq('chat_id', activeChatId)
      .in('message_id', ids)
      .catch(() => {});

    // пушим событие — колокол и бейджи обновятся мгновенно
    window.dispatchEvent(new CustomEvent('notifications-changed'));

  // строка "печатает…"
  const typingNames = useMemo(() => {
    const arr = Object.values(typing).map(t => t?.name).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return `${arr[0]} печатает…`;
    return `${arr.slice(0,2).join(', ')}${arr.length>2 ? ` и ещё ${arr.length-2}`:''} печатают…`;
  }, [typing]);

  const startCallTo = useCallback((targetId) => {
    if (!activeChatId || !selfId || !targetId || targetId === selfId) return;
    setCallState({ chatId: activeChatId, role: 'caller', to: targetId });
  }, [activeChatId, selfId]);

  // суммарный badge на верхнем меню
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce((s, n) => s + (n || 0), 0);
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
    localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
  }, [unreadByChat]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'calc(100vh - 64px)'}}>
      {/* левая колонка */}
      <div style={{borderRight:'1px solid #eee'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px'}}>
          <h3 style={{margin:0}}>Чаты</h3>
        </div>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
          unreadByChat={unreadByChat}
        />
      </div>

      {/* правая колонка */}
      <div style={{display:'flex', flexDirection:'column'}}>
        <ChatHeader
          chat={chats.find(c => c.chat_id === activeChatId) || null}
          typingText={typingNames}
          members={members}
          onCall={startCallTo}
        />

        <div style={{flex:1, overflow:'auto', padding:'12px'}}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            currentUserId={selfId}
            receipts={receipts}
            onMarkVisibleRead={markReadForMessageIds}
            memberNames={memberNames}
          />
        </div>

        <div style={{padding:'8px 12px', borderTop:'1px solid #eee'}}>
          <MessageInput
            chatId={activeChatId}
            onSend={async ({ text, files }) => {
              if (!activeChatId || !selfId) return;

              // создаём сам текст
              const { data: msg, error: msgErr } = await supabase
                .from('chat_messages')
                .insert({ chat_id: activeChatId, author_id: selfId, body: text?.trim() || null })
                .select()
                .single();
              if (msgErr || !msg) return;

              // файл (если есть) — кладём в storage и проставляем путь в сообщение
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
            }}
          />
        </div>
      </div>

      {callState && (
        <CallModal state={callState} onClose={() => setCallState(null)} />
      )}
    </div>
  );
}

