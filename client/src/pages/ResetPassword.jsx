import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const INVALID_LINK = 'Ссылка для восстановления недействительна или истекла.';
const hasSession = (session) => Boolean(session?.user?.id && session?.access_token);

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState('checking');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let sessionEventSeen = false;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const callbackFailed = ['error', 'error_code', 'error_description']
      .some((key) => url.searchParams.has(key) || fragment.has(key));
    if (callbackFailed) {
      setPhase('invalid'); setError(INVALID_LINK);
      return undefined;
    }

    const applySession = (session) => {
      if (!active) return;
      const valid = hasSession(session);
      setPhase(valid ? 'ready' : 'invalid');
      setError(valid ? '' : INVALID_LINK);
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (['PASSWORD_RECOVERY', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED'].includes(event)) {
        sessionEventSeen = true;
        applySession(session);
      } else if (event === 'INITIAL_SESSION' && !sessionEventSeen) {
        applySession(session);
      }
    });
    // The SDK waits for URL/session initialization and consumes implicit #tokens.
    // Do not require a query token or exchange a callback code a second time here.
    supabase.auth.getSession()
      .then(({ data: current, error: sessionError }) => {
        if (!sessionEventSeen) applySession(sessionError ? null : current?.session);
      })
      .catch(() => { if (!sessionEventSeen) applySession(null); });
    return () => { active = false; data?.subscription?.unsubscribe(); };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (phase !== 'ready' || saving) return;
    setSaving(true); setError('');
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !hasSession(data?.session)) {
        setPhase('invalid'); setError(INVALID_LINK); return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword(''); setDone(true);
    } catch (updateError) {
      setError(updateError.message || 'Не удалось сохранить пароль. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  if (done) return <main style={{ padding: 30 }}>
    <h2>Пароль изменён</h2>
    <p>Новый пароль сохранён.</p>
    <a href="/login">Перейти ко входу</a>
  </main>;

  return <main style={{ padding: 30, maxWidth: 400 }}>
    <h2>Новый пароль</h2>
    {phase === 'checking' && <p role="status">Проверяем ссылку восстановления…</p>}
    {error && <p role="alert" style={{ color: 'red', marginBottom: 10 }}>{error}</p>}
    <form onSubmit={handleSubmit}>
      <label htmlFor="recovery-password">Новый пароль</label>
      <input id="recovery-password" type="password" autoComplete="new-password"
        style={{ width: '100%', padding: 8, marginTop: 5, marginBottom: 15, borderRadius: 6, border: '1px solid #ccc' }}
        value={password} onChange={(event) => setPassword(event.target.value)}
        disabled={phase !== 'ready' || saving} required />
      <button type="submit" disabled={phase !== 'ready' || saving}
        style={{ width: '100%', padding: 10, borderRadius: 6, border: 'none', background: '#2563eb', color: 'white' }}>
        {saving ? 'Сохраняем…' : 'Сохранить пароль'}
      </button>
    </form>
  </main>;
}
