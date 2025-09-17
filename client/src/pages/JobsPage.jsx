// client/src/components/CreateJob.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const BOX = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#fff',
  padding: 12,
};
const ROW = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 10,
  alignItems: 'center',
};
const INPUT = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  height: 36,
  boxSizing: 'border-box',
};

export default function CreateJob({ onCreated }) {
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(false);

  // form state
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [address, setAddress] = useState('');
  const [systemType, setSystemType] = useState('HVAC');
  const [issue, setIssue] = useState('');
  const [scf, setScf] = useState('120');
  const [technicianId, setTechnicianId] = useState(''); // пусто = не выбран

  useEffect(() => {
    loadRefs();
  }, []);

  async function loadRefs() {
    // клиенты (если нужны в выпадашке — оставляю на будущее)
    const clientsReq = supabase.from('clients').select('id,full_name,phone').order('full_name', { ascending: true });

    // ТЕХНИКИ — ВАЖНО: берём только активных, роль 'technician' (и legacy 'tech')
    const techsReq = supabase
      .from('technicians')
      .select('id,name,role,is_active')
      .in('role', ['technician', 'tech'])
      .eq('is_active', true)
      .order('name', { ascending: true });

    const [{ data: clientData }, { data: techData, error: techErr }] = await Promise.all([clientsReq, techsReq]);

    if (techErr) {
      console.error(techErr);
      setTechnicians([]);
    } else {
      setTechnicians(techData || []);
    }
    setClients(clientData || []);
  }

  const canSubmit = useMemo(() => issue.trim().length > 0, [issue]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    try {
      const payload = {
        system_type: systemType || null,
        issue: issue.trim(),
        scf: scf === '' ? null : Number(scf),
        technician_id: technicianId === '' ? null : technicianId,
        // ниже поля — если у тебя создание клиента идёт отдельно, можно убрать
        client_name: clientName || null,
        client_phone: clientPhone || null,
        client_email: clientEmail || null,
        address: address || null,
        status: 'диагностика',
      };

      const { error } = await supabase.from('jobs').insert(payload);
      if (error) throw error;

      // сброс формы
      setClientName('');
      setClientPhone('');
      setClientEmail('');
      setAddress('');
      setSystemType('HVAC');
      setIssue('');
      setScf('120');
      setTechnicianId('');

      if (typeof onCreated === 'function') onCreated();
    } catch (err) {
      console.error(err);
      alert('Не удалось создать заявку');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleCreate} style={BOX}>
      <h3 style={{ marginTop: 0, marginBottom: 10, textAlign: 'center' }}>Создание заявки</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={ROW}>
          <label>Номер заявки</label>
          <input style={INPUT} value="Автоматически" disabled readOnly />
        </div>

        <div style={ROW}>
          <label>Описание проблемы</label>
          <input
            style={INPUT}
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Описание проблемы"
          />
        </div>

        <div style={ROW}>
          <label>Система</label>
          <select style={INPUT} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
            <option value="HVAC">HVAC</option>
            <option value="Appliance">Appliance</option>
          </select>
        </div>

        <div style={ROW}>
          <label>SCF ($)</label>
          <input
            style={INPUT}
            type="number"
            value={scf}
            onChange={(e) => setScf(e.target.value)}
            placeholder="—"
          />
        </div>

        <div style={ROW}>
          <label>— Выбери техника —</label>
          <select
            style={INPUT}
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
          >
            <option value="">—</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* справа у тебя поля клиента — оставил как простые инпуты */}
        <div style={ROW}>
          <label>Имя клиента</label>
          <input style={INPUT} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Имя клиента" />
        </div>
        <div style={ROW}>
          <label>Телефон</label>
          <input style={INPUT} value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="Телефон" />
        </div>
        <div style={ROW}>
          <label>Email</label>
          <input style={INPUT} value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Email" />
        </div>
        <div style={ROW}>
          <label>Адрес</label>
          <input style={INPUT} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес" />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            type="submit"
            disabled={!canSubmit || loading}
            style={{
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: '#2563eb',
              color: '#fff',
              minWidth: 140,
            }}
          >
            {loading ? 'Создаю…' : 'Создать заявку'}
          </button>
        </div>
      </div>
    </form>
  );
}
