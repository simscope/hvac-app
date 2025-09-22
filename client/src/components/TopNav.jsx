// client/src/components/TopNav.jsx
import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const norm = (r) => {
  if (!r) return null;
  const x = String(r).toLowerCase();
  return x === 'technician' ? 'tech' : x;
};

const linkCls = ({ isActive }) =>
  'topnav-link' + (isActive ? ' topnav-link--active' : '');

export default function TopNav() {
  const { user, role, loading, logout } = useAuth();
  const r = useMemo(() => norm(role), [role]);

  // Пока роль грузится — не прячем меню совсем, но показываем минимум
  if (!user) return null;

  return (
    <header className="topnav">
      <div className="topnav-left">
        <span className="brand">Sim Scope</span>

        {/* Общие для всех (как минимум Заявки) */}
        <NavLink to="/jobs" className={linkCls}>Заявки</NavLink>

        {/* Менеджер + Админ */}
        {(r === 'admin' || r === 'manager') && (
          <>
            <NavLink to="/jobs/all" className={linkCls}>Все заявки</NavLink>
            <NavLink to="/calendar" className={linkCls}>Календарь</NavLink>
            <NavLink to="/materials" className={linkCls}>Материалы</NavLink>
            <NavLink to="/chat" className={linkCls}>Чат</NavLink>
          </>
        )}

        {/* Только Админ */}
        {r === 'admin' && (
          <>
            <NavLink to="/technicians" className={linkCls}>Техники</NavLink>
            <NavLink to="/finance" className={linkCls}>Финансы</NavLink>
            <NavLink to="/chat-admin" className={linkCls}>Чат (админ)</NavLink>
          </>
        )}
      </div>

      <div className="topnav-right">
        <span className="role-badge">{r || '...'}</span>
        <button className="topnav-btn" onClick={logout}>Выйти</button>
      </div>

      {/* простые стили, чтобы было видно активные пункты */}
      <style>{`
        .topnav { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid #eee; background:#fff; position:sticky; top:0; z-index:50; }
        .topnav-left { display:flex; gap:12px; align-items:center; }
        .topnav-right { display:flex; gap:12px; align-items:center; }
        .brand { font-weight:700; margin-right:6px; }
        .topnav-link { text-decoration:none; color:#333; padding:6px 10px; border-radius:8px; }
        .topnav-link--active { background:#f0f4ff; }
        .role-badge { font-size:12px; padding:4px 8px; background:#f5f5f5; border-radius:999px; text-transform:uppercase; letter-spacing:.5px; }
        .topnav-btn { border:1px solid #ddd; background:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; }
        .topnav-btn:hover { background:#f7f7f7; }
      `}</style>
    </header>
  );
}
