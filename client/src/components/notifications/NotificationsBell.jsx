// client/src/components/notifications/NotificationsBell.jsx
import React, { useEffect, useState, useRef } from 'react';
import {
  fetchNotifications,
  subscribeNotifications,
  markNotificationRead,
  markAllRead,
} from '../../api/notifications';
import Toast from './Toast';

function BellIcon({ hasUnread }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {/* иконка-колокол */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zM18 16v-5a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z" fill="#111827" />
      </svg>
      {hasUnread ? (
        <span
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 10,
            height: 10,
            background: '#ef4444',
            borderRadius: '999px',
            boxShadow: '0 0 0 2px #fff',
          }}
        />
      ) : null}
    </span>
  );
}

export default function NotificationsBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    let unsub = null;
    (async () => {
      const { items: firstItems, unread: cnt } = await fetchNotifications();
      setItems(firstItems);
      setUnread(cnt);

      unsub = await subscribeNotifications((n) => {
        setItems((prev) => [n, ...prev].slice(0, 50));
        setUnread((x) => x + 1);

        // показать тост
        setToasts((prev) => [
          ...prev,
          {
            id: n.id,
            title: 'Новое сообщение',
            text: n?.payload?.text || 'Сообщение',
            url: n?.payload?.chat_id ? `/chat/${n.payload.chat_id}` : undefined,
          },
        ]);
      });
    })();

    // закрытие выпадашки при клике вне
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDoc);

    return () => {
      unsub?.();
      document.removeEventListener('click', onDoc);
    };
  }, []);

  const onClickItem = async (n) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      setUnread((x) => Math.max(0, x - 1));
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it)));
    }
    const url = n?.payload?.chat_id ? `/chat/${n.payload.chat_id}` : null;
    if (url) window.location.href = url;
  };

  const onMarkAll = async () => {
    await markAllRead();
    setUnread(0);
    setItems((prev) => prev.map((it) => (it.read_at ? it : { ...it, read_at: new Date().toISOString() })));
  };

  return (
    <>
      {/* Иконка */}
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Уведомления"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          <BellIcon hasUnread={unread > 0} />
          {unread > 0 && <span style={{ fontSize: 12, color: '#111827' }}>{unread}</span>}
        </button>

        {/* Выпадашка */}
        {open && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              marginTop: 8,
              width: 360,
              maxHeight: 420,
              overflowY: 'auto',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              boxShadow: '0 12px 30px rgba(0,0,0,.12)',
              zIndex: 50,
            }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
              <b>Уведомления</b>
              {unread > 0 && (
                <button onClick={onMarkAll} style={{ border: 'none', background: 'transparent', color: '#2563eb', cursor: 'pointer' }}>
                  Прочитать всё
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div style={{ padding: 16, color: '#6b7280' }}>Пока пусто</div>
            ) : (
              items.map((n) => {
                const isUnread = !n.read_at;
                const text = n?.payload?.text || '';
                const date = new Date(n.created_at).toLocaleString();
                return (
                  <div
                    key={n.id}
                    onClick={() => onClickItem(n)}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      background: isUnread ? '#eef2ff' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Новое сообщение</div>
                    <div style={{ color: '#374151' }}>{text}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>{date}</div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Тосты */}
      {toasts.map((t) => (
        <Toast
          key={t.id}
          title={t.title}
          text={t.text}
          url={t.url}
          onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
        />
      ))}
    </>
  );
}
