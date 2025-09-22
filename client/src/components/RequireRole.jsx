// src/components/RequireRole.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Пропсы:
 * - allow: string | string[]  — список допустимых ролей ('admin' | 'manager' | 'tech')
 * - children: ReactNode       — что рендерить при доступе
 * - loadingFallback?: ReactNode — что показывать пока идёт загрузка роли (по умолчанию null)
 */
export default function RequireRole({ allow, children, loadingFallback = null }) {
  const { loading, user, role } = useAuth();
  const location = useLocation();

  // Нормализуем allow: допускаем строку и массив
  const allowed = Array.isArray(allow) ? allow : (allow ? [allow] : ['admin','manager','tech']);

  // Пока тянем сессию/профиль — ничего не решаем (иначе будут ложные "нет доступа")
  if (loading) return loadingFallback;

  // Не залогинен — на логин с возвратом куда шёл
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Роль ещё не определилась (null) — показываем заглушку, НЕ режем доступ преждевременно
  // Если хочешь явно запрещать при неизвестной роли — замени на редирект на /no-access
  if (!role) {
    return loadingFallback ?? <div style={{ padding: 16 }}>Загрузка прав…</div>;
  }

  // Нет права — на /no-access
  if (!allowed.includes(role)) {
    return <Navigate to="/no-access" replace />;
  }

  // Доступ есть
  return children;
}
