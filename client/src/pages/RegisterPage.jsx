import React, { useState } from 'react';
import { signUp } from '../supabaseAuth';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    setStatus('Регистрируем...');
    const { data, error } = await signUp(email, password, { role: 'manager' });
    if (error) {
      setStatus('Ошибка: ' + error.message);
    } else {
      setStatus('Пользователь создан! Проверьте почту для подтверждения.');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: 'auto', padding: 20 }}>
      <h2>Регистрация</h2>
      <form onSubmit={handleRegister}>
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
        <button type="submit" style={{ width: '100%' }}>Зарегистрироваться</button>
      </form>
      <div style={{ marginTop: 10 }}>{status}</div>
    </div>
  );
}
