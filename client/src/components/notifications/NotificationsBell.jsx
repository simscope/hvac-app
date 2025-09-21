// client/src/components/notifications/NotificationsBell.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  listMyNotifications,
  countMyUnread,
  markAllRead,
  subscribeMyNotifications,
} from '../../api/notifications';

export default function NotificationsBell({ onOpenNotification }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  // загрузка списка + счётчика
  useEffect(() => {
    (async () => {
      try {
        const [list, total] = await Promise.all([
          listMyNotifications(50),
          countMyUnread(),
        ]);
        setItems(list);
        setUnread(total);
        // поднимем глобальное событие, чтобы и меню показало бейдж
        window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
      } catch {}
    })();
  }, []);

  // realtime
  useEffect(() => {
    let unsub = null;
    (async () => {
      unsub = await subscribeMyNotifications(async (n) => {
        setItems((prev) => [n, ...prev].slice(0, 50));
        setUnread((u) => {
          const nu = u + 1;
          window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: nu } }));
          return nu;
        });
      });
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await markAllRead();
        setUnread(0);
        window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total: 0 } }));
      } catch {}
    }
  };

  const rendered = useMemo(() => {
    if (!items.length) {
      return <div style={{ padding: 12, color: '#6b7280' }}>Пока нет уведомлений</div>;
    }
    return items.map((n) => {
      const title = n.type === 'chat:new_message' ? 'Новое сообщение' : n.type;
      const text = n?.payload?.text ?? n?.payload?.body ?? '';
      const ts = new Date(n.created_at).toLocaleString();
      const isUnread = !n.read_at;
      return (
        <div
          key={n.id}
          onClick={() => onOpenNotification?.(n)}
          style={{
            padding:'10px 12px',
            cursor:'pointer',
            borderBottom:'1px solid #eee',
            background: isUnread ? '#eef2ff' : '#fff'
          }}
        >
          <div style={{ fontWeight: 700 }}>{title}</div>
          {text && <div style={{ marginTop: 2 }}>{text}</div>}
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{ts}</div>
        </div>
      );
    });
  }, [items, onOpenNotification]);

  return (
    <div style={{ position:'relative' }}>
      <button
        onClick={toggle}
        title="Уведомления"
        style={{
          position:'relative',
          width:40, height:40, borderRadius:10,
          border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer'
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position:'absolute', top:-5, right:-5,
            background:'#ef4444', color:'#fff', borderRadius:9999,
            padding:'2px 6px', fontSize:12, fontWeight:700, minWidth:18, textAlign:'center'
          }}>{unread}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position:'absolute', right:0, top:'calc(100% + 8px)',
            width:320, maxHeight:420, overflowY:'auto',
            background:'#fff', border:'1px solid #e5e7eb', borderRadius:10,
            boxShadow:'0 8px 24px rgba(0,0,0,.08)', zIndex:50
          }}
        >
          <div style={{ padding:'10px 12px', borderBottom:'1px solid #eee', fontWeight:800 }}>
            Уведомления
          </div>
          {rendered}
        </div>
      )}
    </div>
  );
}
