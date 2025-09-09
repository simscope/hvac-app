import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const input = { width: '100%', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 };

export default function LoginPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [pass, setPass]   = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const signIn = async (e) => {
    e.preventDefault();
    setLoading(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    setLoading(false);
    if (error) setMsg(error.message);
    else nav('/');
  };

  const sendMagic = async () => {
    setLoading(true); setMsg('');
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    setMsg(error ? error.message : 'Письмо с магической ссылкой отправлено.');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    nav('/login');
  };

  if (user) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-2">Вы вошли как {user.email}</h2>
        <button onClick={signOut} className="px-3 py-2 bg-gray-200 rounded">Выйти</button>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-sm mx-auto">
      <h1 className="text-2xl font-bold mb-3">Вход</h1>
      <form onSubmit={signIn}>
        <input style={input} type="email" placeholder="Email"
               value={email} onChange={e => setEmail(e.target.value)} />
        <input style={input} type="password" placeholder="Пароль"
               value={pass} onChange={e => setPass(e.target.value)} />
        <button disabled={loading} className="px-3 py-2 bg-blue-600 text-white rounded w-full">
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </form>

      <div className="mt-3">
        <button disabled={loading} onClick={sendMagic} className="px-3 py-2 bg-gray-100 rounded w-full">
          Прислать магическую ссылку
        </button>
      </div>

      {msg && <div className="mt-3 text-sm text-rose-600">{msg}</div>}
    </div>
  );
}
