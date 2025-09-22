// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

/**
 * Контекст авторизации:
 * 1) ждёт сессию;
 * 2) грузит строку техника из public.technicians по auth_user_id;
 * 3) надёжно определяет роль: technicians.role -> rpc('my_role') -> user.app_metadata.role;
 * 4) отдаёт user, profile, role, isAdmin, loading, logout.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [techRow, setTechRow] = useState(null);
  const [role, setRole] = useState(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // ===== 1) Инициализация сессии + подписка =====
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive) return;
        if (error) console.error('[AUTH] getSession error:', error?.message || error);
        setSession(data?.session ?? null);
      } catch (e) {
        console.error('[AUTH] getSession exception:', e?.message || e);
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

  // ===== 2) Подгружаем строку техника по auth_user_id =====
  useEffect(() => {
    let alive = true;

    async function loadTech(uid) {
      if (!uid) {
        setTechRow(null);
        return;
      }
      setProfileLoading(true);
      try {
        // Берём все возможные поля, чтобы не упасть на различиях схем
        const { data, error } = await supabase
          .from('technicians')
          .select('id, full_name, name, phone, email, role, is_admin, org_id, auth_user_id')
          .eq('auth_user_id', uid)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          // Покажем полный объект ошибки, чтобы видеть message/code/details
          console.error('[AUTH] technicians query error:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          setTechRow(null);
        } else {
          setTechRow(data || null);
        }
      } catch (e) {
        console.error('[AUTH] technicians query exception:', e?.message || e);
        setTechRow(null);
      } finally {
        if (alive) setProfileLoading(false);
      }
    }

    loadTech(session?.user?.id || null);
    return () => { alive = false; };
  }, [session?.user?.id]);

  // ===== 3) Надёжно определяем роль =====
  useEffect(() => {
    let alive = true;

    async function resolveRole() {
      // 3.1 сначала из technicians.role / is_admin
      const fromTech = (() => {
        const r = String(techRow?.role || '').toLowerCase();
        if (r === 'admin' || r === 'manager' || r === 'technician' || r === 'tech') return r === 'technician' ? 'tech' : r;
        if (techRow?.is_admin) return 'admin';
        return null;
      })();

      if (fromTech) { if (alive) setRole(fromTech); return; }

      // 3.2 затем пытаемся через RPC (читает profiles, работает под SECURITY DEFINER)
      try {
        const { data, error } = await supabase.rpc('my_role');
        if (!alive) return;
        if (!error && data) {
          const r = String(data).toLowerCase();
          setRole(r === 'technician' ? 'tech' : r);
          return;
        }
        if (error) {
          console.warn('[AUTH] my_role rpc error:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
        }
      } catch (e) {
        console.warn('[AUTH] my_role rpc exception:', e?.message || e);
      }

      // 3.3 fallback: app_metadata.role из токена (если настроено в Auth → Users)
      const metaRole = String(session?.user?.app_metadata?.role || '').toLowerCase();
      if (metaRole) {
        setRole(metaRole === 'technician' ? 'tech' : metaRole);
        return;
      }

      // 3.4 ничего не нашли — явно null
      setRole(null);
    }

    // не дёргаем лишний раз, пока нет сессии
    if (session?.user?.id) resolveRole();
    else setRole(null);

    return () => { alive = false; };
  }, [techRow?.role, techRow?.is_admin, session?.user?.id, session?.user?.app_metadata?.role]);

  const loading = authLoading || profileLoading;

  // ===== 4) Экспортируемые значения в контексте =====
  const value = useMemo(() => {
    const fullName = techRow?.full_name || techRow?.name || null;
    return {
      session,
      user: session?.user ?? null,
      profile: techRow
        ? {
            id: techRow.id,
            full_name: fullName,
            phone: techRow.phone ?? null,
            email: techRow.email ?? null,
            org_id: techRow.org_id ?? null,
          }
        : null,
      role,                     // 'admin' | 'manager' | 'tech' | null
      isAdmin: role === 'admin',
      isActive: true,           // если появится флаг активности — подставим реальный
      loading,
      logout: async () => {
        try { await supabase.auth.signOut(); }
        catch (e) { console.error('[AUTH] signOut error:', e?.message || e); }
      },
    };
  }, [session, techRow, role, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
