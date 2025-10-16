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
const small = { ...btn, background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '6px 10px' };

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

export default function CreateJob({ onCreated }) {
  const [form, setForm] = useState({
    issue: '',
    system_type: 'HVAC',
    scf: '120',
    technician_id: '',
    client_company: '',   // NEW
    client_name: '',
    client_phone: '',
    client_email: '',
    client_address: '',
  });

  const [existingClientId, setExistingClientId] = useState(null);
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
      setQ(v);
    }
    if (k === 'client_company') {
      setExistingClientId(null);
    }
  };

  const toNum = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

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
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  // поиск клиентов (по имени; компания влияет только на создание)
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
        // Берём все колонки, чтобы безопасно получить company если она есть.
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

  const clearChosen = () => {
    setExistingClientId(null);
  };

  const onNameKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && activeIdx < suggestions.length) {
        e.preventDefault();
        chooseClient(suggestions[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  async function insertClientSafe(payload) {
    // Пытаемся вставить с полем company; если таблица его не знает — повторим без него.
    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('id')
      .single();

    if (error && error.code === '42703') {
      // колонка не существует — пробуем без company
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
        (form.client_company || form.client_name || form.client_phone || form.client_email || form.client_address)
          .trim?.() !== '' ||
        Boolean(form.client_company || form.client_name || form.client_phone || form.client_email || form.client_address);

      if (wantClient && !clientId) {
        const clientPayload = {
          company: (form.client_company || '').trim(),   // возможно отсутствует в БД — обработаем
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
        console.error('create job error:', jobErr, jobPayload);
        return;
      }

      resetForm();
      if (typeof onCreated === 'function') onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        maxWidth: 960,
        margin: '0 auto 16px',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 16,
        background: '#fff',
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: 10,
          fontSize: 20,
          fontWeight: 800,
          textAlign: 'center',
        }}
      >
        Create Job
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={row}>
            <div>Job number</div>
            <input style={input} value="Automatic" disabled />
          </div>

          <div style={row}>
            <div>Issue description</div>
            <input
              style={input}
              value={form.issue}
              onChange={set('issue')}
              placeholder="Describe the issue"
            />
          </div>

          <div style={row}>
            <div>System</div>
            <select style={input} value={form.system_type} onChange={set('system_type')}>
              <option value="Appliance">Appliance</option>
              <option value="HVAC">HVAC</option>
            </select>
          </div>

          <div style={row}>
            <div>SCF ($)</div>
            <input
              style={input}
              type="number"
              value={form.scf}
              onChange={set('scf')}
              placeholder="SCF"
            />
          </div>

          <div style={row}>
            <div>— Select technician —</div>
            <select
              style={input}
              value={form.technician_id}
              onChange={set('technician_id')}
            >
              <option value="">—</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {/* NEW: Company above Client name */}
          <div style={row}>
            <div>Company</div>
            <input
              style={input}
              value={form.client_company}
              onChange={set('client_company')}
              placeholder="Organization / Company"
            />
          </div>

          <div style={row}>
            <div>Client name</div>
            <div style={dropdownWrap} ref={nameInputRef}>
              <input
                style={input}
                value={form.client_name}
                onChange={set('client_name')}
                onFocus={() => setOpen(suggestions.length > 0)}
                onKeyDown={onNameKeyDown}
                placeholder="Client name"
                autoComplete="off"
              />
              {existingClientId && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#16a34a' }}>
                    Linked to existing client (ID: {existingClientId})
                  </span>
                  <button type="button" style={small} onClick={clearChosen}>Unlink</button>
                </div>
              )}
              {open && (
                <div style={dropdown} ref={dropRef}>
                  {loadingSug && (
                    <div style={{ padding: 10, fontSize: 13, color: '#64748b' }}>
                      Searching…
                    </div>
                  )}
                  {(suggestions || []).map((c, idx) => (
                    <div
                      key={c.id}
                      style={{ ...li, ...(idx === activeIdx ? liHover : null) }}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onMouseLeave={() => setActiveIdx(-1)}
                      onClick={() => chooseClient(c)}
                      title={`Company: ${c.company ?? '-'} • Phone: ${c.phone || '-'} • Email: ${c.email || '-'} • Address: ${c.address || '-'}`}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {c.full_name || '—'} {c.company ? `• ${c.company}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {(c.phone || '')}
                        {c.email ? ` • ${c.email}` : ''}
                        {c.address ? ` • ${c.address}` : ''}
                      </div>
                    </div>
                  ))}
                  {!loadingSug && suggestions.length === 0 && (
                    <div style={{ padding: 10, fontSize: 13, color: '#64748b' }}>
                      No matches
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={row}>
            <div>Phone</div>
            <input
              style={input}
              value={form.client_phone}
              onChange={set('client_phone')}
              placeholder="Phone"
            />
          </div>

          <div style={row}>
            <div>Email</div>
            <input
              style={input}
              value={form.client_email}
              onChange={set('client_email')}
              placeholder="Email"
            />
          </div>

          <div style={row}>
            <div>Address</div>
            <input
              style={input}
              value={form.client_address}
              onChange={set('client_address')}
              placeholder="Address"
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, gap: 8 }}>
        <button type="submit" style={primary} disabled={busy}>
          {busy ? 'Creating…' : 'Create job'}
        </button>
        {open && (
          <button type="button" style={small} onClick={() => setOpen(false)}>
            Hide suggestions
          </button>
        )}
      </div>
    </form>
  );
}
