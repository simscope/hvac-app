// client/src/components/CreateJob.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const input = {
  width: '100%',
  padding: '8px 10px',
  boxSizing: 'border-box',
  border: '1px solid #e5e7eb',
  borderRadius: 8,// client/src/components/CreateJob.jsx
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
    // job_number умышленно отсутствует — БД проставит сама
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
        .in('role', ['technician', 'tech'])   // ← фикс: поддерживаем обе роли
        .eq('is_active', true)                // ← только активные
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
      // 1) Пытаемся создать клиента, если что-то введено
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

        if (error) {
          // не блокируем создание заявки, просто лог
          console.warn('create client error:', error);
        } else {
          clientId = data?.id ?? null;
        }
      }

      // 2) Создаём заявку — job_number НЕ отправляем (ставит БД)
      const jobPayload = {
        issue: (form.issue || '').trim(),
        system_type: form.system_type || null,
        scf: toNum(form.scf),
        technician_id: form.technician_id ? Number(form.technician_id) : null,
        client_id: clientId,
        status: 'диагностика',
      };

      const { error: jobErr } = await supabase.from('jobs').insert(jobPayload);
      if (jobErr) {
        console.error('create job error:', jobErr, jobPayload);
        // Сообщения не показываем по твоему требованию
        return;
      }

      // 3) Обновляем список и очищаем форму — без всплывающих окон
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
        Создание заявки
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Левая колонка */}
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={row}>
            <div>Номер заявки</div>
            {/* Показать, что номер ставится автоматически */}
            <input style={input} value="Автоматически" disabled />
          </div>

          <div style={row}>
            <div>Описание проблемы</div>
            <input
              style={input}
              value={form.issue}
              onChange={set('issue')}
              placeholder="Описание проблемы"
            />
          </div>

          <div style={row}>
            <div>Система</div>
            <select style={input} value={form.system_type} onChange={set('system_type')}>
              <option value="HVAC">HVAC</option>
              <option value="Appliance">Appliance</option>
              <option value="Plumbing">Plumbing</option>
              <option value="Electrical">Electrical</option>
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
            <div>— Выбери техника —</div>
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

        {/* Правая колонка — клиент */}
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={row}>
            <div>Имя клиента</div>
            <input
              style={input}
              value={form.client_name}
              onChange={set('client_name')}
              placeholder="Имя клиента"
            />
          </div>

          <div style={row}>
            <div>Телефон</div>
            <input
              style={input}
              value={form.client_phone}
              onChange={set('client_phone')}
              placeholder="Телефон"
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
            <div>Адрес</div>
            <input
              style={input}
              value={form.client_address}
              onChange={set('client_address')}
              placeholder="Адрес"
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <button style={primary} disabled={busy}>
          {busy ? 'Создаём…' : 'Создать заявку'}
        </button>
      </div>
    </form>
  );
}

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
    // job_number умышленно отсутствует — БД проставит сама
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
        .select('id, name, role')
        .eq('role', 'tech')
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
      // 1) Пытаемся создать клиента, если что-то введено
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

        if (error) {
          // не блокируем создание заявки, просто лог
          console.warn('create client error:', error);
        } else {
          clientId = data?.id ?? null;
        }
      }

      // 2) Создаём заявку — job_number НЕ отправляем (ставит БД)
      const jobPayload = {
        issue: (form.issue || '').trim(),
        system_type: form.system_type || null,
        scf: toNum(form.scf),
        technician_id: form.technician_id ? Number(form.technician_id) : null,
        client_id: clientId,
        status: 'диагностика',
      };

      const { error: jobErr } = await supabase.from('jobs').insert(jobPayload);
      if (jobErr) {
        console.error('create job error:', jobErr, jobPayload);
        // Сообщения не показываем по твоему требованию
        return;
      }

      // 3) Обновляем список и очищаем форму — без всплывающих окон
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
        Создание заявки
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Левая колонка */}
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={row}>
            <div>Номер заявки</div>
            {/* Показать, что номер ставится автоматически */}
            <input style={input} value="Автоматически" disabled />
          </div>

          <div style={row}>
            <div>Описание проблемы</div>
            <input
              style={input}
              value={form.issue}
              onChange={set('issue')}
              placeholder="Описание проблемы"
            />
          </div>

          <div style={row}>
            <div>Система</div>
            <select style={input} value={form.system_type} onChange={set('system_type')}>
              <option value="HVAC">HVAC</option>
              <option value="Appliance">Appliance</option>
              <option value="Plumbing">Plumbing</option>
              <option value="Electrical">Electrical</option>
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
            <div>— Выбери техника —</div>
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

        {/* Правая колонка — клиент */}
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={row}>
            <div>Имя клиента</div>
            <input
              style={input}
              value={form.client_name}
              onChange={set('client_name')}
              placeholder="Имя клиента"
            />
          </div>

          <div style={row}>
            <div>Телефон</div>
            <input
              style={input}
              value={form.client_phone}
              onChange={set('client_phone')}
              placeholder="Телефон"
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
            <div>Адрес</div>
            <input
              style={input}
              value={form.client_address}
              onChange={set('client_address')}
              placeholder="Адрес"
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <button style={primary} disabled={busy}>
          {busy ? 'Создаём…' : 'Создать заявку'}
        </button>
      </div>
    </form>
  );
}

