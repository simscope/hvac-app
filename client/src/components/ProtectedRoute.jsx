// src/components/ProtectedRoute.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null; // можно поставить спиннер/скелет

  if (!user) {
    // Не авторизован — уводим на /login и помним куда хотел попасть
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
