// src/pages/NoAccessPage.jsx
import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function NoAccessPage() {
  const { role } = useAuth();
  return (
    <div style={{ minHeight: '60dvh', display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 6 }}>Нет доступа</h2>
        {role === 'tech' ? (
          <p>Для техников веб-версия недоступна. Пожалуйста, используйте мобильное приложение.</p>
        ) : (
          <p>У тебя нет прав для просмотра этой страницы. Обратись к администратору.</p>
        )}
      </div>
    </div>
  );
}
