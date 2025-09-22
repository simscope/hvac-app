// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);

  // то, что прочитали из profiles
  const [profRow, setProfRow] = useState(null);
  // то, что (при необходимости) прочитали из technicians
  const [techRow, setTechRow] = useState(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profLoading, setProfLoading] = useState(false);
  const [techLoading, setTechLoading] = useState(false);

  // 1) Сессия + подписка
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

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // 2) Тянем профиль из public.profiles по user.id
  useEffect(() => {
    let alive = true;
    async function loadProfile(uid) {
      setProfRow(null);
      setTechRow(null);
      if (!uid) return;

      setProfLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, role, technician_id, org_id')
          .eq('id', uid)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          console.error('[AUTH] profiles query error:', {
            message: error.message, details: error.details, hint: error.hint, code: error.code,
          });
          setProfRow(null);
        } else {
          setProfRow(data || null);
        }
      } catch (e) {
        console.error('[AUTH] profiles query exception:', e?.message || e);
        setProfRow(null);
      } finally {
        if (alive) setProfLoading(false);
      }
    }

    loadProfile(session?.user?.id || null);
    return () => { alive = false; };
  }, [session?.user?.id]);

  // 3) Если роль technician и есть technician_id — тянем public.technicians по id
  useEffect(() => {
    let alive = true;

    const roleText = String(profRow?.role || '').toLowerCase();
    const isTech = roleText === 'technician' || roleText === 'tech';
    const techId = profRow?.technician_id || null;

    async function loadTech(id) {
      setTechRow(null);
      if (!id) return;

      setTechLoading(true);
      try {
        const { data, error } = await supabase
          .from('technicians')
          .select('id, full_name, name, phone, email')
          .eq('id', id)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          console.error('[AUTH] technicians query error:', {
            message: error.message, details: error.details, hint: error.hint, code: error.code,
          });
          setTechRow(null);
        } else {
          setTechRow(data || null);
        }
      } catch (e) {
        console.error('[AUTH] technicians query exception:', e?.message || e);
        setTechRow(null);
      } finally {
        if (alive) setTechLoading(false);
      }
    }

    if (isTech) loadTech(techId);
    else { setTechRow(null); setTechLoading(false); }

    return () => { alive = false; };
  }, [profRow?.role, profRow?.technician_id]);

  // 4) Роль
  const role = useMemo(() => {
    const r = String(profRow?.role || '').toLowerCase();
    if (r === 'technician') return 'tech';
    if (r === 'admin' || r === 'manager' || r === 'tech') return r;
    return null;
  }, [profRow?.role]);

  // 5) Собираем profile для приложения
  // ВАЖНО: profile.id для tech = technicians.id (нужно для JobAccess)
  const profile = useMemo(() => {
    if (!profRow) return null;

    const base = {
      // это id техники (для admin/manager будет null)
      id: role === 'tech' ? (techRow?.id ?? profRow?.technician_id ?? null) : null,
      full_name: (techRow?.full_name || techRow?.name || profRow?.full_name || null),
      phone: techRow?.phone ?? null,
      email: techRow?.email ?? null,
      org_id: profRow?.org_id ?? null,
    };
    return base;
  }, [role, profRow, techRow]);

  const loading = authLoading || profLoading || techLoading;

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    role,                  // 'admin' | 'manager' | 'tech' | null
    isAdmin: role === 'admin',
    isActive: true,
    loading,
    logout: async () => {
      try { await supabase.auth.signOut(); }
      catch (e) { console.error('[AUTH] signOut error:', e?.message || e); }
    },
  }), [session, profile, role, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
