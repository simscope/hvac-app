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

  // ===== helpers =====
  const normalizeRole = (r, is_admin) => {
    const v = String(r || '').toLowerCase();
    if (v === 'admin' || v === 'manager' || v === 'tech') return v;
    if (is_admin) return 'admin';
    return null;
  };

  const refreshProfile = async (uid) => {
    if (!uid) {
      setRow(null);
      return;
    }
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('technicians')
        .select('id, name, phone, role, is_admin, org_id, auth_user_id, email')
        .eq('auth_user_id', uid)
        .maybeSingle();

      if (error) {
        console.error('[AUTH] technicians load error', error);
        setRow(null);
      } else {
        setRow(data || null);
      }
    } finally {
      setProfileLoading(false);
    }
  };

  const tryLinkTechnicianByEmail = async (email) => {
    // Пытаемся вызвать RPC, если её нет/запрещено — молча игнорируем
    if (!email) return;
    try {
      await supabase.rpc('link_technician_to_auth', { p_email: email });
    } catch {
      // no-op
    }
  };

  // 1) начальная сессия и подписка
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive) return;
        if (error) console.error('[AUTH] getSession error', error);
        setSession(data?.session ?? null);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      setSession(s ?? null);

      // после входа — пытаемся привязать технаря по email и обновить профиль
      if (s?.user) {
        await tryLinkTechnicianByEmail(s.user.email);
        await refreshProfile(s.user.id);
      } else {
        setRow(null);
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // 2) когда есть/меняется user.id — грузим профиль
  useEffect(() => {
    const uid = session?.user?.id || null;
    refreshProfile(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // 3) роль
  const normalizedRole = useMemo(
    () => normalizeRole(row?.role, row?.is_admin),
    [row?.role, row?.is_admin]
  );

  // 4) Фолбэк-админ из переменной окружения (CRA)
  const envAdmin = (process.env.REACT_APP_ADMIN_EMAIL || '').toLowerCase();
  const envAdminHit =
    !!envAdmin && !!session?.user?.email && session.user.email.toLowerCase() === envAdmin;

  const loading = authLoading || profileLoading;

  // Экспортируемые значения контекста
  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile: row
        ? { id: row.id, full_name: row.name, phone: row.phone, email: row.email, org_id: row.org_id }
        : null,
      role: normalizedRole || (envAdminHit ? 'admin' : null),
      isAdmin: (normalizedRole || (envAdminHit ? 'admin' : null)) === 'admin',
      isActive: true, // в вашей схеме нет отдельного флага
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
