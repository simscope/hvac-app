// client/src/components/TopNav.jsx
import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const norm = (r) => {
  if (!r) return null;
  const x = String(r).toLowerCase();
  return x === 'technician' ? 'tech' : x;
};

// Простые SVG-иконки (встроенные, чтобы не ловить 404 на ассеты)
const Icon = {
  Jobs: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M9 3h6a2 2 0 0 1 2 2v1h2.5A1.5 1.5 0 0 1 21 7.5v10A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10A1.5 1.5 0 0 1 4.5 6H7V5a2 2 0 0 1 2-2Zm0 3h6V5H9v1Z"/>
    </svg>
  ),
  All: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/>
    </svg>
  ),
  Calendar: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h2V2Zm-3 8v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9H4Z"/>
    </svg>
  ),
  Materials: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 2 3 6.5V18l9 4 9-4V6.5L12 2Zm0 2.2 6.8 3.2L12 10.6 5.2 7.4 12 4.2ZM5 9.6l7 3.3v6.9l-7-3.1V9.6Zm9 10.2v-6.9l7-3.3v7.1l-7 3.1Z"/>
    </svg>
  ),
  Chat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v15l4-3h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM6 9h8v2H6V9Zm0-4h12v2H6V5Z"/>
    </svg>
  ),
  Techs: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2-8 4.5V21h16v-2.5C20 16 16.33 14 12 14Z"/>
    </svg>
  ),
  Money: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M3 6h18a2 2 0 0 1 2 2v8H1V8a2 2 0 0 1 2-2Zm0 12h18v2H3v-2Zm9-8a3 3 0 1 0 3 3 3 3 0 0 0-3-3Z"/>
    </svg>
  ),
  AdminChat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M2 4a2 2 0 0 1 2-2h10l4 4v6a2 2 0 0 1-2 2H9l-5 4V4Zm18 6h2v8l-5-3h-7v-2h8a2 2 0 0 0 2-2V10Z"/>
    </svg>
  ),
};

export default function TopNav() {
  const { user, role, logout } = useAuth();
  const r = useMemo(() => norm(role), [role]);

  if (!user) return null;

  // пункты меню в зависимости от роли
  const links = useMemo(() => {
    const arr = [];
    // Общие для всех — только «Заявки» (но у tech список может быть закрыт роут-гвардом)
    arr.push({ to: '/jobs', label: 'Заявки', icon: <Icon.Jobs /> });

    if (r === 'admin' || r === 'manager') {
      arr.push(
        { to: '/jobs/all', label: 'Все заявки', icon: <Icon.All /> },
        { to: '/calendar', label: 'Календарь', icon: <Icon.Calendar /> },
        { to: '/materials', label: 'Материалы', icon: <Icon.Materials /> },
        { to: '/chat', label: 'Чат', icon: <Icon.Chat /> },
      );
    }
    if (r === 'admin') {
      arr.push(
        { to: '/technicians', label: 'Техники', icon: <Icon.Techs /> },
        { to: '/finance', label: 'Финансы', icon: <Icon.Money /> },
        { to: '/chat-admin', label: 'Чат (админ)', icon: <Icon.AdminChat /> },
      );
    }
    return arr;
  }, [r]);

  // аватарка (инициалы)
  const initials = useMemo(() => {
    const name = (user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      '').trim();
    if (!name) return 'U';
    const parts = String(name).split(/\s+/);
    const a = parts[0]?.[0] || '';
    const b = parts[1]?.[0] || '';
    return (a + b).toUpperCase();
  }, [user]);

  return (
    <header className="tn">
      <div className="tn__left">
        <img
          src={require('client/public/logo192.png')}
          alt="Sim Scope"
          className="tn__logo"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <span className="tn__brand">Sim&nbsp;Scope</span>
        <nav className="tn__nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => 'tn__link' + (isActive ? ' is-active' : '')}>
              <span className="tn__icon">{l.icon}</span>
              <span className="tn__text">{l.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="tn__right">
        <span className={`tn__role tn__role--${r || 'none'}`}>{r || '...'}</span>
        <div className="tn__avatar" title={user?.email || ''}>{initials}</div>
        <button className="tn__btn" onClick={logout}>Выйти</button>
      </div>

      {/* Стили внутри компонента, чтобы ничего не ломать */}
      <style>{`
        :root {
          --tn-bg: linear-gradient(90deg, #0f172a 0%, #111827 50%, #1f2937 100%);
          --tn-fg: #e5e7eb;
          --tn-muted: #9ca3af;
          --tn-pill: rgba(255,255,255,0.08);
          --tn-pill-active: rgba(59,130,246,0.22);
          --tn-border: rgba(255,255,255,0.08);
          --tn-accent: #60a5fa;
          --tn-danger: #ef4444;
        }
        .tn {
          position: sticky; top: 0; z-index: 100;
          display:flex; align-items:center; justify-content:space-between;
          padding: 10px 14px;
          background: var(--tn-bg);
          color: var(--tn-fg);
          border-bottom: 1px solid var(--tn-border);
          box-shadow: 0 6px 24px rgba(0,0,0,.25);
        }
        .tn__left { display:flex; align-items:center; gap: 12px; min-width: 0; }
        .tn__logo { width: 28px; height: 28px; object-fit: contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
        .tn__brand { font-weight: 800; letter-spacing: .2px; margin-right: 6px; white-space: nowrap; }
        .tn__nav { display:flex; align-items:center; gap: 6px; flex-wrap: wrap; }
        .tn__link {
          display:flex; align-items:center; gap: 8px;
          color: var(--tn-fg); text-decoration: none;
          padding: 8px 10px; border-radius: 999px;
          background: var(--tn-pill);
          border: 1px solid transparent;
          transition: all .15s ease;
        }
        .tn__link:hover { transform: translateY(-1px); border-color: var(--tn-border); }
        .tn__link.is-active { background: var(--tn-pill-active); border-color: rgba(96,165,250,.35); }
        .tn__icon { display:grid; place-items:center; color: var(--tn-accent); }
        .tn__text { font-size: 14px; }

        .tn__right { display:flex; align-items:center; gap: 10px; }
        .tn__role {
          text-transform: uppercase; font-size: 11px; letter-spacing: .5px;
          padding: 4px 8px; border-radius: 8px; background: var(--tn-pill);
          border:1px solid var(--tn-border);
        }
        .tn__role--admin { background: rgba(220,38,38,.18); border-color: rgba(220,38,38,.28); }
        .tn__role--manager { background: rgba(234,179,8,.18); border-color: rgba(234,179,8,.28); }
        .tn__role--tech { background: rgba(34,197,94,.18); border-color: rgba(34,197,94,.28); }

        .tn__avatar {
          width: 32px; height: 32px; border-radius: 50%;
          display:grid; place-items:center; font-weight: 700;
          background: #0ea5e9; color: white; box-shadow: inset 0 0 0 2px rgba(255,255,255,.35);
        }
        .tn__btn {
          border: 1px solid var(--tn-border); color: var(--tn-fg);
          background: rgba(255,255,255,0.04);
          border-radius: 10px; padding: 6px 10px; cursor: pointer;
        }
        .tn__btn:hover { background: rgba(255,255,255,0.08); }
        @media (max-width: 980px) {
          .tn__text { display:none; }
          .tn__brand { display:none; }
        }
      `}</style>
    </header>
  );
}
