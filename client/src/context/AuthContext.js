// client/src/context/AuthContext.js
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const Ctx = createContext({
  user: null,
  profile: null,
  role: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async (u) => {
      if (!u) {
        setProfile(null);
        return;
      }
      // грузим профиль по id (id = auth.users.id)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, technician_id, is_admin')
        .eq('id', u.id)
        .maybeSingle(); // если версия supabase-js ругается — замени на .single()

      if (!cancelled) {
        if (error) {
          console.warn('profiles load error:', error);
          setProfile(null);
        } else {
          setProfile(data);
        }
      }
    };

    // 1) начальная сессия
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      loadProfile(u).finally(() => setLoading(false));
    });

    // 2) подписка на изменения авторизации
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      loadProfile(u);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const value = {
    user,
    profile,
    role: profile?.role ?? null,
    isAdmin: !!profile?.is_admin || profile?.role === 'admin',
    loading,
    signOut: () => supabase.auth.signOut(),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);

// (необязательно) default export, если где-то импортируется по умолчанию
export default Ctx;
