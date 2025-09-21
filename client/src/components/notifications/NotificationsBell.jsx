// client/src/components/notifications/NotificationsBell.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  listMyNotifications,
  markNotificationRead,
  markChatRead,
  subscribeMyNotifications,
  unreadCount,
} from '../../api/notifications';
import { useNavigate } from 'react-router-dom';

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [counter, setCounter] = useState(0);
  const navigate = useNavigate();

  // начальная загрузка
  useEffect(() => {
    (async () => {
      try {
        const [list, cnt] = await Promise.all([
          listMyNotifications({ onlyUnread: false, limit: 50 }),
          unreadCount(),
        ]);
        setItems(list);
        setCounter(cnt);
        // сразу эмитим бейдж наверх (если у тебя топ-меню слушает это событие)
        window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: cnt } }));
      } catch (e) {
        console.warn('notif init error', e);
      }
    })();
  }, []);

  // подписка на realtime
  useEffect(() => {
    const unsub = subscribeMyNotifications(async (row) => {
      try {
        // вытянем chat_id из payload
        const chatId = row?.payload?.chat_id ?? null;
        const enriched = { ...row, chat_id: chatId };

        setItems((prev) => [enriched, ...prev].slice(0, 50));
        setCounter((n) => {
          const next = n + 1;
          window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: next } }));
          return next;
        });
      } catch {}
    });
    return () => unsub?.();
  }, []);

  // красивый заголовок и текст
  const pretty = (n) => {
    const t = n?.type || '';
    if (t.startsWith('chat:')) {
      return {
        title: 'Новое сообщение',
        text: n?.payload?.text || '',
      };
    }
    return { title: t, text: JSON.stringify(n?.payload ?? {}) };
  };

  // открыть конкретное уведомление
  const openNotification = async (n) => {
    try {
      // помечаем прочитанным конкретное
      await markNotificationRead(n.id);
      setItems((prev) => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      setCounter((c) => {
        const next = Math.max(0, c - 1);
        window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: next } }));
        return next;
      });

      // если это чат — пометить все по чату и перейти в него на конкретное сообщение
      const chatId = n.chat_id || n?.payload?.chat_id;
      const messageId = n?.payload?.message_id;
      if (chatId) {
        await markChatRead(chatId);
        navigate(`/chat/${chatId}${messageId ? `?mid=${messageId}` : ''}`);
        setOpen(false);
      }
    } catch (e) {
      console.warn('openNotification error', e);
    }
  };

  const unread = useMemo(() => items.filter(i => !i.read_at).length, [items]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Уведомления"
        style={{
          border: '1px solid #e5e7eb',
          background: '#fff',
          borderRadius: 10,
          padding: '8px 12px',
          position: 'relative',
          cursor: 'pointer'
        }}
      >
        🔔
        {(counter || unread) > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              background: '#ef4444',
              color: '#fff',
              borderRadius: 9999,
              padding: '2px 6px',
              fontSize: 12,
              fontWeight: 700,
              minWidth: 18,
              textAlign: 'center',
            }}
          >
            {counter || unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 360,
            maxHeight: 420,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
            zIndex: 50,
          }}
        >
          <div style={{ padding: 12, borderBottom: '1px solid #eee', fontWeight: 700 }}>Уведомления</div>
          {items.length === 0 && (
            <div style={{ padding: 16, color: '#6b7280' }}>Пока пусто</div>
          )}
          {items.map((n) => {
            const { title, text } = pretty(n);
            return (
              <button
                key={n.id}
                onClick={() => openNotification(n)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: 12,
                  border: 'none',
                  borderBottom: '1px solid #f0f0f0',
                  background: n.read_at ? '#fff' : '#f8fafc',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
                <div style={{ color: '#374151', marginBottom: 6, whiteSpace: 'pre-wrap' }}>{text}</div>
                <div style={{ color: '#9ca3af', fontSize: 12 }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
