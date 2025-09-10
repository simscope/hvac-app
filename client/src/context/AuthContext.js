// client/src/context/AuthContext.js
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [tech, setTech] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSessionAndProfile = async (sess) => {
    const s = sess ?? (await supabase.auth.getSession()).data.session;
    setSession(s);

    if (s?.user?.email) {
      // 1) Привязываем технаря по email (без прав суперпользователя)
      try { await supabase.rpc('link_technician_to_auth', { p_email: s.user.email }); } catch {}

      // 2) Подтягиваем профиль техника по auth_user_id
      const { data: t } = await supabase
        .from('technicians')
        .select('id,name,role,email,auth_user_id')
        .eq('auth_user_id', s.user.id)
        .maybeSingle();
      setTech(t || null);
    } else {
      setTech(null);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchSessionAndProfile();
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setLoading(true);
      await fetchSessionAndProfile(newSession);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendMagicLink = async (email, createIfNeeded = true) => {
    const redirectTo = `${window.location.origin}/#/login`;

    // Сначала пробуем отправить уже существующему пользователю
    let { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });

    // Если его нет — создаём и тоже шлём письмо
    if (error && createIfNeeded && /not\s*found/i.test(error.message || '')) {
      const r = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      error = r.error;
    }

    if (error) throw error;
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  const value = useMemo(() => ({
    user: session?.user || null,
    tech, // {id,name,role,email,auth_user_id} | null
    isAdmin: (tech?.role || '').toLowerCase() === 'admin',
    loading,
    sendMagicLink,
    signOut,
  }), [session, tech, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
