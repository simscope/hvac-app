import React, { useState } from 'react';
import { signUp } from './supabaseAuth';

export default function RegisterForm() {
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
    <form onSubmit={handleRegister}>
      <h2>Регистрация</h2>
      <input
        type="email"
        placeholder="Email"
        value={email}
        required
        onChange={e => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Пароль"
        value={password}
        required
        onChange={e => setPassword(e.target.value)}
      />
      <button type="submit">Зарегистрироваться</button>
      <div>{status}</div>
    </form>
  );
}
