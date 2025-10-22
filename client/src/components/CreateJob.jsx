// src/pages/CreateJob.jsx
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

const input = {
  width: '100%',
  padding: '8px 10px',
  boxSizing: 'border-box',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  height: 36,
};
const row = {
  display: 'grid',
  gridTemplateColumns: '170px 1fr',
  gap: 10,
  alignItems: 'center',
};
const btn = {
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  border: 'none',
};
const primary = { ...btn, background: '#2563eb', color: '#fff' };

const dropdownWrap = { position: 'relative' };
const dropdown = {
  position: 'absolute',
  zIndex: 20,
  top: 40,
  left: 0,
  right: 0,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
  maxHeight: 260,
  overflowY: 'auto',
};
const li = {
  padding: '8px 10px',
  cursor: 'pointer',
  borderBottom: '1px solid #f1f5f9',
};
const liHover = { background: '#f8fafc' };

/** ===== Blacklist helpers (используем колонку `blacklist` text) ===== */
const getBlacklistNote = (c) => (c?.blacklist ?? '').toString().trim();
const isBlacklisted = (c) => getBlacklistNote(c).length > 0;

export default function CreateJob({ onCreated }) {
  const [form, setForm] = useState({
    issue: '',
    system_type: 'HVAC',
    scf: '120',
    technician_id: '',
    client_company: '',
    client_name: '',
    client_phone: '',
    client_email: '',
    client_address: '',
  });

  const [existingClientId, setExistingClientId] = useState(null);
  const [chosenClient, setChosenClient] = useState(null); // полная строка клиента (для blacklist)
  const [busy, setBusy] = useState(false);
  const [techs, setTechs] = useState([]);

  // ---- AUTOCOMPLETE ----
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const nameInputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('technicians')
        .select('id, name, role, is_active')
        .in('role', ['technician', 'tech'])
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (!error) setTechs(data || []);
      else console.error('load technicians error:', error);
    })();
  }, []);

  const set = (k) => (e) => {
    const v = e?.target?.value ?? '';
    setForm((p) => ({ ...p, [k]: v }));
    if (k === 'client_name') {
      setExistingClientId(null);
      setChosenClient(null);
      setQ(v);
    }
    if (k === 'client_company') {
      setExistingClientId(null);
      setChosenClient(null);
    }
  };

  const toNum = (v) =>
    v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);

  const resetForm = () => {
    setForm({
      issue: '',
      system_type: 'HVAC',
      scf: '120',
      technician_id: '',
      client_company: '',
      client_name: '',
      client_phone: '',
      client_email: '',
      client_address: '',
    });
    setExistingClientId(null);
    setChosenClient(null);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  // поиск клиентов по имени (берём * чтобы получить blacklist)
  useEffect(() => {
    if (!q || q.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoadingSug(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .ilike('full_name', `%${q.trim()}%`)
          .order('full_name', { ascending: true })
          .limit(10);

        if (cancelled) return;
        if (error) {
          console.warn('autocomplete clients error:', error);
          setSuggestions([]);
          setOpen(false);
        } else {
          setSuggestions(data || []);
          setOpen((data || []).length > 0);
        }
      } finally {
        if (!cancelled) setLoadingSug(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e) => {
      if (
        dropRef.current &&
        !dropRef.current.contains(e.target) &&
        nameInputRef.current &&
        !nameInputRef.current.contains(e.target)
      ) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const chooseClient = (c) => {
    setExistingClientId(c.id);
    setChosenClient(c);
    setForm((p) => ({
      ...p,
      client_company: (c.company ?? '') || '',
      client_name: c.full_name || '',
      client_phone: c.phone || '',
      client_email: c.email || '',
      client_address: c.address || '',
    }));
    setOpen(false);
    setActiveIdx(-1);
  };

  async function insertClientSafe(payload) {
    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('id')
      .single();

    if (error && error.code === '42703') {
      // запасной вариант, если колонки company нет
      const { data: d2, error: e2 } = await supabase
        .from('clients')
        .insert({
          full_name: payload.full_name,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
        })
        .select('id')
        .single();
      return { data: d2, error: e2 };
    }
    return { data, error };
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      let clientId = existingClientId || null;

      const wantClient =
        (form.client_company ||
          form.client_name ||
          form.client_phone ||
          form.client_email ||
          form.client_address)
          ?.toString?.()
          ?.trim?.() !== '' ||
        Boolean(
          form.client_company ||
            form.client_name ||
            form.client_phone ||
            form.client_email ||
            form.client_address
        );

      if (wantClient && !clientId) {
        const clientPayload = {
          company: (form.client_company || '').trim(),
          full_name: (form.client_name || '').trim(),
          phone: (form.client_phone || '').trim(),
          email: (form.client_email || '').trim(),
          address: (form.client_address || '').trim(),
        };

        const allEmpty =
          !clientPayload.company &&
          !clientPayload.full_name &&
          !clientPayload.phone &&
          !clientPayload.email &&
          !clientPayload.address;

        if (!allEmpty) {
          const { data, error } = await insertClientSafe(clientPayload);
          if (!error) clientId = data?.id ?? null;
          else console.warn('create client error:', error);
        }
      }

      const jobPayload = {
        issue: (form.issue || '').trim(),
        system_type: form.system_type || null,
        scf: toNum(form.scf),
        technician_id: form.technician_id ? Number(form.technician_id) : null,
        client_id: clientId,
        status: 'Diagnosis',
      };

      const { error: jobErr } = await supabase.from('jobs').insert(jobPayload);
      if (jobErr) {
        console.error('create job error:', jobErr
