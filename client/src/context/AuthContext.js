import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Состояние аутентификации и профиля
 */
const AuthCtx = createContext({
  loading: true,
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
});

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    session: null,
    user: null,
    profile: null,
    isAdmin: false,
  });

  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      await handleSession(session);

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          await handleSession(session);
        }
      );
      unsub = () => subscription?.unsubscribe();
    })();

    return () => { try { unsub?.(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSession = async (session) => {
    if (!session?.user) {
      setState(s => ({ ...s, loading: false, session: null, user: null, profile: null, isAdmin: false }));
      return;
    }
    const user = session.user;

    // Ищем профиль по двум возможным схемам:
    // 1) profiles.auth_user_id = auth.user.id
    // 2) profiles.id = auth.user.id
    let profile = null;

    const { data: p1 } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (p1) profile = p1;
    else {
      const { data: p2 } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (p2) profile = p2;
    }

    const isAdmin = !!profile?.is_admin || profile?.role === 'admin';

    setState({
      loading: false,
      session,
      user,
      profile,
      isAdmin,
    });
  };

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

/** Хук доступа к контексту */
export const useAuth = () => useContext(AuthCtx);

/** Доступ только для авторизованных */
export function RequireAuth({ children }) {
  const { loading, session } = useAuth();
  if (loading) return <div className="p-4">Загрузка…</div>;
  if (!session) return <div className="p-4">Нужно войти</div>;
  return children;
}

/** Доступ только для роли admin */
export function RequireAdmin({ children }) {
  const { loading, isAdmin } = useAuth();
  if (loading) return <div className="p-4">Загрузка…</div>;
  if (!isAdmin) return <div className="p-4">Недостаточно прав</div>;
  return children;
}

/**
 * Доступ по ролям (универсальный гейт)
 * Пример: <RequireRole allow="manager">...</RequireRole>
 * или:   <RequireRole allow={['manager','tech']}>...</RequireRole>
 */
export function RequireRole({ allow, children }) {
  const { loading, profile } = useAuth();
  if (loading) return <div className="p-4">Загрузка…</div>;

  const need = Array.isArray(allow) ? allow : [allow];
  const role = profile?.role ?? null;

  if (!role || !need.includes(role)) return <div className="p-4">Недостаточно прав</div>;
  return children;
}

export default AuthProvider;
