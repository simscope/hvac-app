import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NavItem = ({ to, label, active }) => (
  <Link
    to={to}
    style={{
      padding: '10px 14px',
      borderRadius: 10,
      textDecoration: 'none',
      color: active ? '#111827' : '#374151',
      background: active ? '#e5e7eb' : 'transparent',
      fontWeight: 600,
    }}
  >
    {label}
  </Link>
);

function isActive(pathname, to) {
  return pathname === to || pathname.startsWith(to + '/');
}

export default function TopNav() {
  const { role, logout, profile } = useAuth();
  const { pathname } = useLocation();

  // глобальный бейдж «Чат»
  const [unread, setUnread] = useState(Number(localStorage.getItem('CHAT_UNREAD_TOTAL') || 0));
  useEffect(() => {
    const h = (e) => {
      const total = Number(e.detail?.total || 0);
      setUnread(total);
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
    };
    window.addEventListener('chat-unread-changed', h);
    return () => window.removeEventListener('chat-unread-changed', h);
  }, []);

  if (role === 'tech') return null;

  const baseItems = [
    ['/jobs', '📋 Заявки'],
    ['/calendar', '📅 Календарь'],
    ['/jobs/all', '📄 Все заявки'],
    ['/materials', '📦 Детали'],
    ['/chat', '💬 Чат'],
  ];
  const adminOnly = [
    ['/chat-admin', '🛡️ Чат-админка'],
    ['/technicians', '👥 Сотрудники'],
    ['/finance', '💵 Финансы'],
  ];
  const items = role === 'admin' ? [...baseItems, ...adminOnly] : baseItems;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        justifyContent: 'space-between',
        padding: 12,
        borderBottom: '1px solid #e5e7eb',
        background: '#fff',
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Sim&nbsp;Scope</div>
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        {items.map(([to, label]) => (
          <span key={to} style={{ position: 'relative' }}>
            <NavItem to={to} label={label} active={isActive(pathname, to)} />
            {to === '/chat' && unread > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -12,
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
                {unread}
              </span>
            )}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {profile?.full_name ? `${profile.full_name} • ${role}` : role}
        </div>
        <button
          onClick={logout}
          style={{
            padding: '8px 12px',
            border: '1px solid #e5e7eb',
            background: '#fff',
            borderRadius: 10,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
