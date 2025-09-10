// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

/**
 * Минимальный и стабильный контекст авторизации:
 * - следит за сессией
 * - при наличии user.id подтягивает запись из public.technicians по auth_user_id
 * - вычисляет роль (admin/manager/tech) с fallback на is_admin
 * - отдаёт user, profile, role, isAdmin, loading, logout
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [techRow, setTechRow] = useState(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // 1) Инициализация сессии + подписка на изменения
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive) return;
        if (error) console.error('[AUTH] getSession error:', error);
        setSession(data?.session ?? null);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // 2) Подгружаем строку техника по auth_user_id
  useEffect(() => {
    let alive = true;

    const loadTech = async (uid) => {
      if (!uid) {
        setTechRow(null);
        return;
      }
      setProfileLoading(true);
      try {
        const { data, error } = await supabase
          .from('technicians')
          .select('id, name, phone, email, role, is_admin, org_id, auth_user_id')
          .eq('auth_user_id', uid)
          .maybeSingle();

        if (!alive) return;
        if (error) {
          console.error('[AUTH] technicians query error:', error);
          setTechRow(null);
        } else {
          setTechRow(data || null);
        }
      } catch (e) {
        console.error('[AUTH] technicians query exception:', e);
        setTechRow(null);
      } finally {
        if (alive) setProfileLoading(false);
      }
    };

    loadTech(session?.user?.id || null);
    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  // 3) Нормализуем роль
  const role = useMemo(() => {
    const r = String(techRow?.role || '').toLowerCase();
    if (r === 'admin' || r === 'manager' || r === 'tech') return r;
    if (techRow?.is_admin) return 'admin';
    return null;
  }, [techRow?.role, techRow?.is_admin]);

  const loading = authLoading || profileLoading;

  // 4) Экспортируемые значения
  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile: techRow
        ? { id: techRow.id, full_name: techRow.name, phone: techRow.phone, email: techRow.email, org_id: techRow.org_id }
        : null,
      role,
      isAdmin: role === 'admin',
      isActive: true, // отдельного флага в схеме нет
      loading,
      logout: async () => supabase.auth.signOut(),
    }),
    [session, techRow, role, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
