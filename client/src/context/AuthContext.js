// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [row, setRow] = useState(null);   // строка из public.technicians
  const [loading, setLoading] = useState(true);

  // 1) следим за сессией Supabase
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

  // 2) тянем профиль из technicians по auth_user_id
  useEffect(() => {
    let alive = true;

    async function loadTechnician() {
      setRow(null);
      const uid = session?.user?.id;
      if (!uid) return;

      const { data, error } = await supabase
        .from('technicians')
        .select('id, name, phone, role, is_admin, org_id, auth_user_id, email')
        .eq('auth_user_id', uid)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        console.error('technicians load error', error);
        setRow(null);
        return;
      }

      setRow(data || null);
    }

    loadTechnician();
  }, [session?.user?.id]);

  // 3) нормализуем роль из вашей схемы
  const normalizedRole = useMemo(() => {
    const r = (row?.role || '').toLowerCase();
    if (r === 'admin' || r === 'manager' || r === 'tech') return r;
    if (row?.is_admin) return 'admin';
    return null; // нет роли — нет доступа
  }, [row]);

  // 4) Фолбэк: админ по переменной окружения (удобно на переходный период)
  const envAdmin = (import.meta?.env?.VITE_ADMIN_EMAIL || '').toLowerCase();
  const envAdminHit =
    envAdmin && session?.user?.email && session.user.email.toLowerCase() === envAdmin;

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile: row
        ? { id: row.id, full_name: row.name, phone: row.phone, email: row.email, org_id: row.org_id }
        : null,
      role: normalizedRole || (envAdminHit ? 'admin' : null),
      isActive: true, // в вашей таблице нет флага активности — считаем активным
      loading,
      logout: async () => supabase.auth.signOut(),
    }),
    [session, row, normalizedRole, envAdminHit, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
