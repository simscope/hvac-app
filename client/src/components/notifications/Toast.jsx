// client/src/components/notifications/Toast.jsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Toast({ title = 'Уведомление', text = '', onClose, timeout = 3500, url }) {
  const [node] = useState(() => {
    let el = document.getElementById('toasts-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toasts-root';
      el.style.position = 'fixed';
      el.style.right = '16px';
      el.style.bottom = '16px';
      el.style.zIndex = 9999;
      document.body.appendChild(el);
    }
    return el;
  });

  useEffect(() => {
    const t = setTimeout(() => onClose?.(), timeout);
    return () => clearTimeout(t);
  }, [timeout, onClose]);

  const box = (
    <div
      onClick={() => url && (window.location.href = url)}
      style={{
        background: '#111827',
        color: '#fff',
        padding: '10px 12px',
        borderRadius: 10,
        marginTop: 8,
        minWidth: 280,
        boxShadow: '0 8px 30px rgba(0,0,0,.3)',
        cursor: url ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ opacity: 0.9 }}>{text}</div>
    </div>
  );

  return createPortal(box, node);
}
