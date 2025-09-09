// src/components/RequireRole.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireRole({ allow, children }) {
  const { loading, user, role } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!role) {
    // пользователь есть, но нет профиля в staff — запрещаем
    return <Navigate to="/no-access" replace />;
  }

  if (!allow.includes(role)) {
    // техник в вебе, менеджер на админ-страницу и т.д.
    return <Navigate to="/no-access" replace />;
  }

  return children;
}
