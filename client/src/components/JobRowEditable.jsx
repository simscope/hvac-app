import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

/** Приводим id: ''|null => null; '123' => 123; любой другой => строка */
const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s; // число или uuid-строка
};

export default function JobRowEditable({ job, technicians = [], onUpdate, onSelect }) {
  const [draft, setDraft] = useState({
    system_type: job.system_type ?? '',
    issue: job.issue ?? '',
    scf: job.scf ?? '',
    technician_id: job.technician_id ?? '',
    status: job.status ?? '',
  });

  useEffect(() => {
    setDraft({
      system_type: job.system_type ?? '',
      issue: job.issue ?? '',
      scf: job.scf ?? '',
      technician_id: job.technician_id ?? '',
      status: job.status ?? '',
    });
  }, [job.id]);

  const techOptions = useMemo(
    () =>
      (technicians || [])
        .filter((t) => !t.role || String(t.role).toLowerCase() === 'tech')
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [technicians]
  );

  const onChange = (field) => (e) => setDraft((p) => ({ ...p, [field]: e.target.value }));

  const statusLower = String(draft.status || '').toLowerCase().trim();
  const isRecall = statusLower === 'recall' || draft.status === 'ReCall';

  const handleSave = async () => {
    const payload = {
      system_type: draft.system_type || null,
      issue: draft.issue || null,
      scf: draft.scf === '' || draft.scf == null ? null : Number(draft.scf),
      technician_id: normalizeId(draft.technician_id), // <-- ключевое
      status: draft.status || null,
    };

    try {
      const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
      if (error) throw error;
      onUpdate && onUpdate();
    } catch (err) {
      console.error('Ошибка сохранения job:', err);
      alert('Ошибка при сохранении заявки');
    }
  };

  const openDetails = () => onSelect && onSelect(job);

  return (
    <tr>
      {/* 1. Номер */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <span
          title="Открыть детали заявки"
          onClick={openDetails}
          style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
        >
          {job.job_number || job.id}
        </span>
      </td>

      {/* 2. Клиент */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {job.client_name || '—'}
      </td>

      {/* 3. Система */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <input value={draft.system_type} onChange={onChange('system_type')} style={{ width: '100%' }} />
      </td>

      {/* 4. Проблема */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <input value={draft.issue} onChange={onChange('issue')} style={{ width: '100%' }} />
      </td>

      {/* 5. SCF */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}>
        <input type="number" value={draft.scf} onChange={onChange('scf')} style={{ width: '100%', textAlign: 'right' }} />
      </td>

      {/* 6. Техник */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <select
          value={draft.technician_id == null || draft.technician_id === '' ? '' : String(draft.technician_id)}
          onChange={(e) => {
            const v = e.target.value;
            setDraft((p) => ({ ...p, technician_id: v === '' ? '' : v })); // в стейте держим строку
          }}
          style={{ width: '100%' }}
        >
          <option value="">—</option>
          {techOptions.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </select>
      </td>

      {/* 7. Дата */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{job.created_at_fmt || '—'}</td>

      {/* 8. Статус */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <select
          value={draft.status ?? ''}
          onChange={onChange('status')}
          style={{
            width: '100%',
            border: '1px solid',
            borderColor: isRecall ? '#d32f2f' : '#ccc',
            backgroundColor: isRecall ? '#fde7e9' : 'white',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          <option value="recall">ReCall</option>
          <option value="">—</option>
          <option value="диагностика">диагностика</option>
          <option value="в работе">в работе</option>
          <option value="заказ деталей">заказ деталей</option>
          <option value="ожидание деталей">ожидание деталей</option>
          <option value="к финишу">к финишу</option>
          <option value="завершено">завершено</option>
        </select>
      </td>

      {/* 9. Действия */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'center' }}>
        <button onClick={handleSave} title="Сохранить" style={{ marginRight: 8 }}>💾</button>
        <button onClick={openDetails} title="Открыть">✏️</button>
      </td>
    </tr>
  );
}
