// client/src/pages/RegisterPage.jsx
import React, { useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const box = { maxWidth: 380, margin: '40px auto', padding: 16, border: '1px solid #e5e7eb', borderRadius: 12 };

export default function RegisterPage() {
  const urlEmail = useMemo(() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('email') || '';
    } catch {
      return '';
    }
  }, []);

  const [email, setEmail] = useState(urlEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return alert('Введите email');
    if (password.length < 6) return alert('Пароль минимум 6 символов');

    setBusy(true);
    const redirectTo = `${window.location.origin}/#/login`; // куда вернётся после подтверждения
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirectTo },
    });
    setBusy(false);

    if (error) {
      console.error('signUp error:', error);
      alert('Не удалось зарегистрировать: ' + (error.message || 'ошибка'));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div style={box}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Почти готово!</h2>
        <p>Мы отправили письмо на <b>{email}</b>. Перейдите по ссылке в письме, чтобы подтвердить почту и войти.</p>
        <p style={{ marginTop: 12 }}>
          После подтверждения используйте ваш email и пароль на странице входа.
        </p>
      </div>
    );
  }

  return (
    <div style={box}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Регистрация сотрудника</h1>
      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginBottom: 8 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12 }}
          placeholder="employee@company.com"
        />

        <label style={{ display: 'block', marginBottom: 8 }}>Пароль</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16 }}
          placeholder="Минимум 6 символов"
        />

        <button
          type="submit"
          disabled={busy}
          style={{ width: '100%', padding: 12, borderRadius: 8, background: '#111827', color: 'white' }}
        >
          {busy ? 'Отправка…' : 'Зарегистрироваться'}
        </button>
      </form>
    </div>
  );
}
