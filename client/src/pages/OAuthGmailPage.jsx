import React, { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

export default function OAuthGmailPage() {
  const { loading, user } = useAuth();
  const { pathname } = useLocation();
  const attempted = useRef(false);
  const [status, setStatus] = useState('Подготовка безопасного подключения…');
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (loading || !user || attempted.current) return;
    attempted.current = true;
    const complete = pathname.endsWith('/complete');
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (complete) window.history.replaceState(null, '', pathname);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data?.session?.access_token) throw new Error('Сессия завершена. Войдите и начните подключение заново.');
      if (complete && (!params.get('code') || !params.get('state'))) throw new Error('Нет кода или state. Начните подключение заново.');
      const response = await fetch(FUNCTIONS_URL + (complete ? '/oauth_google_callback' : '/oauth_google_start'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify(complete ? { code: params.get('code'), state: params.get('state') } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error('Подключение отклонено: ' + (result.error || 'UNKNOWN_ERROR'));
      if (complete) setStatus('Gmail безопасно подключён к вашей организации.');
      else {
        const target = new URL(result.authorization_url);
        if (target.origin !== 'https://accounts.google.com') throw new Error('Недопустимый адрес авторизации.');
        setUrl(target.href);setStatus('Сессия и организация проверены. Следующий шаг — авторизация Google.');
      }
    })().catch(error => setStatus(error.message || 'Подключение не выполнено.'));
  }, [loading, user, pathname]);
  return <main style={{ padding: 20, maxWidth: 720 }}>
    <h1>Подключение Gmail</h1>
    <p role="status">{status}</p>
    {url && <><p>Для подключения почты подтвердите доступ в Google.</p>
      <a href={url} rel="noreferrer">Продолжить в Google</a></>}
    <p><Link to="/email">Вернуться в почту</Link></p>
  </main>;
}
