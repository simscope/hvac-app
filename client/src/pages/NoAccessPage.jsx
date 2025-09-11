// client/src/pages/NoAccess.jsx
import React from 'react';
import { supabase } from '../supabaseClient';

export default function NoAccess() {
  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // проглатываем — главное очистить клиентскую сессию
      console.warn('signOut error:', e?.message || e);
    }
    // На всякий случай чистим локальное хранилище
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    // И уводим на форму входа
    window.location.replace('/#/login');
  };

  const toLogin = () => window.location.replace('/#/login');

  return (
    <div style={{ minHeight: '70vh' }} className="p-8 flex flex-col items-center justify-center text-center">
      <h1 className="text-3xl font-semibold mb-3">Нет доступа</h1>
      <p className="mb-6">
        У тебя нет прав для просмотра этой страницы. Обратись к администратору.
      </p>

      <div className="flex gap-3">
        <button
          onClick={toLogin}
          className="px-4 py-2 border rounded"
          title="На страницу входа"
        >
          На страницу входа
        </button>
        <button
          onClick={logout}
          className="px-4 py-2 rounded text-white"
          style={{ background: '#111' }}
          title="Выйти из аккаунта"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
