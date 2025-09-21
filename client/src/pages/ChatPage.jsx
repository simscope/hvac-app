// client/src/pages/ChatPage.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { listMessages, subscribeToChat } from '../api/chat';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function ChatPage() {
  const { chatId } = useParams();
  const query = useQuery();
  const focusMessageId = query.get('mid');

  const [messages, setMessages] = useState([]);
  const [receipts, setReceipts] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

  // user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id || null));
  }, []);

  // load + realtime
  useEffect(() => {
    if (!chatId) return;
    let unsub = null;
    (async () => {
      setLoading(true);
      const data = await listMessages(chatId, 500);
      setMessages(data || []);
      setLoading(false);

      unsub = subscribeToChat(chatId, (m) => {
        setMessages((prev) => [...prev, m]);
      });
    })();
    return () => unsub?.();
  }, [chatId]);

  // пометка прочитанными видимых сообщений (вызывается из MessageList)
  const onMarkVisibleRead = async (ids) => {
    if (!ids?.length) return;
    // Если у вас уже есть API, который upsert-ит статус read — используйте его.
    // В противном случае можно завести аналогично тому, что мы делали ранее.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // пример upsert-а (как в MessageList раньше), если нужно в этом месте:
      // await supabase.from('message_receipts').upsert(
      //   ids.map(id => ({ chat_id: chatId, message_id: id, user_id: user.id, status: 'read' })),
      //   { onConflict: 'chat_id,message_id,user_id' }
      // );
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: 12, display: 'grid', gap: 12 }}>
      <MessageList
        chatId={chatId}
        messages={messages}
        loading={loading}
        currentUserId={currentUserId}
        receipts={receipts}
        onMarkVisibleRead={onMarkVisibleRead}
        focusMessageId={focusMessageId}
      />
      <MessageInput chatId={chatId} onSent={(msg) => setMessages((prev) => [...prev, msg])} />
    </div>
  );
}
