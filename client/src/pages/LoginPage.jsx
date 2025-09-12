import React, { useState } from 'react';
import { signIn } from '../supabaseAuth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setStatus('Входим...');
    const { data, error } = await signIn(email, password);
    if (error) {
      setStatus('Ошибка: ' + error.message);
    } else {
      setStatus('Вход выполнен!');
      // Здесь можно сделать переход на главную страницу, если нужно
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: 'auto', padding: 20 }}>
      <h2>Вход</h2>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          required
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          required
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <button type="submit" style={{ width: '100%' }}>Войти</button>
      </form>
      <div style={{ marginTop: 10 }}>{status}</div>
    </div>
  );
}
