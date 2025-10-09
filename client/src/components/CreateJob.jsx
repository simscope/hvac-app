import React, { useEffect, useState } from 'react';
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

export default function CreateJob({ onCreated }) {
  const [form, setForm] = useState({
    issue: '',
    system_type: 'HVAC',
    scf: '120',
    technician_id: '',
    client_name: '',
    client_phone: '',
    client_email: '',
    client_address: '',
  });
  const [busy, setBusy] = useState(false);
  const [techs, setTechs] = useState([]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('technicians')
        .select('id, name, role, is_active')
        .in('role', ['technician', 'tech'])   // support both roles
        .eq('is_active', true)                // only active
        .order('name', { ascending: true });
      if (!error) setTechs(data || []);
      else console.error('load technicians error:', error);
    })();
  }, []);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value ?? '' }));
  const toNum = (v) =>
    v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);

  const resetForm = () =>
    setForm({
      issue: '',
      system_type: 'HVAC',
      scf: '120',
      technician_id: '',
      client_name: '',
      client_phone: '',
      client_email: '',
      client_address: '',
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      let clientId = null;
      const wantClient =
        (form.client_name || form.client_phone || form.client_email || form.client_address)
          .trim?.() !== '' ||
        Boolean(form.client_name || form.client_phone || form.client_email || form.client_address);

      if (wantClient) {
        const clientPayload = {
          full_name: (form.client_name || '').trim(),
          phone: (form.client_phone || '').trim(),
          email: (form.client_email || '').trim(),
          address: (form.client_address || '').trim(),
        };

        const { data, error } = await supabase
          .from('clients')
          .insert(clientPayload)
          .select('id')
          .single();

        if (!error) clientId = data?.id ?? null;
        else console.warn('create client error:', error);
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
          <div style={row}>
            <div>Client name</div>
            <input
              style={input}
              value={form.client_name}
              onChange={set('client_name')}
              placeholder="Client name"
            />
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

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <button style={primary} disabled={busy}>
          {busy ? 'Creating…' : 'Create job'}
        </button>
      </div>
    </form>
  );
}

