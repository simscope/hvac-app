// client/src/pages/LoginPage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const inputStyle = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  boxSizing: 'border-box',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  marginTop: 6,
  background: '#fff',
};

const btnStyle = {
  width: '100%',
  padding: 12,
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
};

export default function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // куда вести после входа
  const fromState = location.state && location.state.from;
  const safeFrom =
    fromState && typeof fromState.pathname === 'string' && fromState.pathname !== '/login'
      ? fromState.pathname
      : '/jobs';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  // Редирект только в эффекте
  useEffect(() => {
    if (user) {
      navigate(safeFrom, { replace: true });
    }
  }, [user, safeFrom, navigate]);

  const onLogin = async (e) => {
    e.preventDefault();
    setErr('');
    setInfo('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      // навигация произойдёт в useEffect, когда появится user
    } catch (error) {
      setErr(error.message || 'Login error');
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    setErr('');
    setInfo('');
    if (!email.trim()) {
      setErr('Укажи email для сброса пароля.');
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + '/reset',
      });
      if (error) throw error;
      setInfo('Мы отправили письмо со ссылкой для сброса пароля.');
    } catch (error) {
      setErr(error.message || 'Ошибка при отправке письма.');
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: '#f8fafc',
        fontFamily:
          "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'Noto Sans',sans-serif",
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '94vw', // чтобы на узких экранах не выходило за край
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 16,
          padding: 22,
          boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
        }}
      >
        <h2 style={{ margin: 0 }}>Вход в систему</h2>
        <p style={{ color: '#64748b', marginTop: 6 }}>Sim Scope — HVAC & Appliances</p>

        <form onSubmit={onLogin} style={{ marginTop: 14 }}>
          <label style={{ fontWeight: 600 }}>Email</label>
          <input
            style={inputStyle}
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
          />

          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 600 }}>Пароль</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 92 }} // место под кнопку
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                aria-label="Показать/скрыть пароль"
                onClick={() => setShowPass((s) => !s)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)', // центрируем по высоте
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {showPass ? 'Скрыть' : 'Показать'}
              </button>
            </div>
          </div>

          {err && <div style={{ marginTop: 12, color: '#ef4444' }}>{err}</div>}
          {info && <div style={{ marginTop: 12, color: '#16a34a' }}>{info}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{ ...btnStyle, background: '#111827', color: '#fff', marginTop: 16 }}
          >
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <button
          type="button"
          onClick={onResetPassword}
          style={{ ...btnStyle, background: '#e5e7eb', color: '#111827', marginTop: 10 }}
        >
          Сбросить пароль
        </button>

        <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
          Доступ выдаёт администратор. Если нет аккаунта — обратись к менеджеру.
        </div>
      </div>
    </div>
  );
}
