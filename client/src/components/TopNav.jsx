// src/components/TopNav.jsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const item = (to, label, active) => (
  <Link
    key={to}
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

export default function TopNav() {
  const { role, logout, profile } = useAuth();
  const { pathname } = useLocation();

  // общие пункты для менеджера
  const managerItems = [
    ['/jobs', '📋 Заявки'],
    ['/calendar', '📅 Календарь'],
    ['/jobs/all', '📄 Все заявки'],
    ['/materials', '📦 Детали'],
    ['/chat', '💬 Чат'],
  ];

  // для админа: видит всё, добавим админские
  const adminExtras = [
    ['/staff', '👥 Сотрудники'],
    ['/reports', '📊 Отчёты'],
    ['/settings', '⚙️ Настройки'],
  ];

  // техник в вебе — меню не показываем (он всё равно не должен пользоваться вебом)
  if (role === 'tech') return null;

  const items = role === 'admin' ? [...managerItems, ...adminExtras] : managerItems;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      justifyContent: 'space-between',
      padding: 12,
      borderBottom: '1px solid #e5e7eb',
      background: '#fff',
      position: 'sticky',
      top: 0,
      zIndex: 30
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Sim&nbsp;Scope</div>
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        {items.map(([to, label]) => item(to, label, pathname.startsWith(to)))}
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
            fontWeight: 600
          }}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
