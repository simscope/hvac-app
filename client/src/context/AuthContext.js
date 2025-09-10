// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);   // { id, email, full_name, role, is_active }
  const [loading, setLoading] = useState(true);

  // 1) следим за сессией
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data?.session ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      alive = false;
      sub.subscription?.unsubscribe?.();
    };
  }, []);

  // 2) тянем профиль из technicians по email
  useEffect(() => {
    let alive = true;
    async function loadProfile() {
      setProfile(null);
      const email = session?.user?.email?.toLowerCase();
      if (!email) return;

      const { data, error } = await supabase
        .from('technicians')
        .select('id, email, full_name, role, is_active')
        .ilike('email', email)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        console.error('loadProfile error', error);
        setProfile(null);
        return;
      }

      // Если строки нет — можно дать админ-доступ через переменную окружения (опционально)
      const envAdmin = import.meta?.env?.VITE_ADMIN_EMAIL?.toLowerCase?.();
      if (!data && envAdmin && envAdmin === email) {
        setProfile({ id: null, email, full_name: 'Admin', role: 'admin', is_active: true });
        return;
      }

      setProfile(data || null);
    }
    loadProfile();
  }, [session?.user?.email]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role || null,          // 'admin' | 'manager' | 'tech' | null
      isActive: !!profile?.is_active,
      loading,
      logout: async () => supabase.auth.signOut(),
    }),
    [session, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
