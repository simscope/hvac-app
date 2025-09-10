// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);

  // строка из public.technicians
  const [row, setRow] = useState(null);

  // раздельные флаги загрузки
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // 1) следим за сессией Supabase
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!alive) return;
      if (error) console.error('getSession error', error);
      setSession(data?.session ?? null);
      setAuthLoading(false);
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
      const uid = session?.user?.id;
      // если пользователя нет — профиля тоже нет
      if (!uid) {
        setRow(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      const { data, error } = await supabase
        .from('technicians')
        .select('id, name, phone, role, is_admin, org_id, auth_user_id, email')
        .eq('auth_user_id', uid)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        console.error('technicians load error', error);
        setRow(null);
      } else {
        setRow(data || null);
      }
      setProfileLoading(false);
    }

    loadTechnician();
  }, [session?.user?.id]);

  // 3) нормализуем роль из вашей схемы
  const normalizedRole = useMemo(() => {
    const r = (row?.role || '').toLowerCase();
    if (r === 'admin' || r === 'manager' || r === 'tech') return r;
    if (row?.is_admin) return 'admin';
    return null;
  }, [row]);

  // 4) Фолбэк: админ по переменной окружения (удобно на переходный период)
  const envAdmin = (import.meta?.env?.VITE_ADMIN_EMAIL || '').toLowerCase();
  const envAdminHit =
    envAdmin && session?.user?.email && session.user.email.toLowerCase() === envAdmin;

  const loading = authLoading || profileLoading;

  // (диагностика — можно убрать после проверки)
  useEffect(() => {
    console.log('[AUTH] uid=', session?.user?.id, 'email=', session?.user?.email);
  }, [session?.user?.id, session?.user?.email]);
  useEffect(() => {
    console.log('[AUTH] technicians row=', row);
  }, [row]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile: row
        ? { id: row.id, full_name: row.name, phone: row.phone, email: row.email, org_id: row.org_id }
        : null,
      role: normalizedRole || (envAdminHit ? 'admin' : null),
      isActive: true, // в вашей таблице нет отдельного флага активности
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
