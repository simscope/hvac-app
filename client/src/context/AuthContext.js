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
