import React, { useEffect, useState, useMemo } from 'react';
import JobRowEditable from '../components/JobRowEditable';
import { supabase } from '../supabaseClient';

const hours = Array.from({ length: 13 }, (_, i) => 8 + i);
const days = Array.from({ length: 10 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - 2 + i);
  return new Date(d);
});

export default function TechnicianCalendar({ jobs, onJobUpdated }) {
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: techs }, { data: cls }] = await Promise.all([
        supabase.from('technicians').select('*').order('name', { ascending: true }),
        supabase.from('clients').select('id, full_name, phone, email, address'),
      ]);
      setTechnicians(techs || []);
      setClients(cls || []);
    })();
  }, []);

  const clientsById = useMemo(() => {
    const m = new Map();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const handleDrop = async (e, day, hour, technicianId) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('job-id');
    if (!jobId) return;
    const t = new Date(day);
    t.setHours(hour, 0, 0, 0);
    const iso = t.toISOString();
    await supabase.from('jobs').update({ appointment_time: iso, technician_id: technicianId }).eq('id', jobId);
    onJobUpdated?.();
  };

  // ---- нормализация статуса и цвета
  const normalizeStatus = (s) => {
    if (!s) return '';
    const v = String(s).toLowerCase().trim();
    if (v === 'recall' || v === 'recal' || v === 'reсall' || v === 'рекол' || v === 'реколл' || v === 'recаll') return 'recall';
    if (v === 'диагностика') return 'diagnostics';
    if (v === 'к финишу') return 'to_finish';
    if (v === 'ожидание' || v === 'ожидание деталей') return 'waiting_parts';
    if (v === 'заказ деталей') return 'parts_ordered';
    if (v === 'в работе') return 'in_progress';
    if (v === 'завершено' || v === 'выполнено') return 'finished';
    return v;
  };

  const statusStyle = (statusRaw, unpaid) => {
    const s = normalizeStatus(statusRaw);
    const pal = {
      recall:        { bg: '#fee2e2', fg: '#b91c1c', ring: '#fecaca' },
      diagnostics:   { bg: '#fef9c3', fg: '#a16207', ring: '#fde68a' },
      to_finish:     { bg: '#fffbeb', fg: '#92400e', ring: '#fde68a' },
      waiting_parts: { bg: '#ede9fe', fg: '#5b21b6', ring: '#ddd6fe' },
      parts_ordered: { bg: '#e0e7ff', fg: '#3730a3', ring: '#c7d2fe' },
      in_progress:   { bg: '#e0f2fe', fg: '#075985', ring: '#bae6fd' },
      finished:      { bg: '#d1fae5', fg: '#065f46', ring: '#a7f3d0' },
      default:       { bg: '#f3f4f6', fg: '#374151', ring: '#e5e7eb' },
    };
    const base = pal[s] || pal.default;
    return {
      backgroundColor: base.bg,
      color: base.fg,
      border: unpaid ? '2px dashed #ef4444' : `1px solid ${base.ring}`,
    };
  };

  const getClientInfo = (job) => {
    const c = job?.client_id ? clientsById.get(job.client_id) : null;
    const name =
      c?.full_name ||
      job?.client_name ||
      job?.full_name ||
      'Без имени';
    const address =
      c?.address ||
      job?.client_address ||
      job?.address ||
      '';
    return { name, address };
  };

  const renderJobsForCell = (tech, day, hour) =>
    jobs
      .filter((job) => {
        if (!job.appointment_time || job.technician_id !== tech.id) return false;
        const t = new Date(job.appointment_time);
        return t.getHours() === hour && t.toDateString() === day.toDateString();
      })
      .map((job) => {
        const unpaid = !job?.payment || job.payment === '—';
        const st = statusStyle(job.status, unpaid);
        const isRecall = normalizeStatus(job.status) === 'recall';
        const { name, address } = getClientInfo(job);

        return (
          <div
            key={job.id}
            draggable
            onClick={() => setSelectedJob(job)}
            onDragStart={(e) => e.dataTransfer.setData('job-id', job.id)}
            style={{
              ...st,
              margin: '2px',
              padding: '6px 8px',
              borderRadius: '8px',
              fontSize: '12px',
              cursor: 'grab',
              display: 'grid',
              gap: 3,
            }}
            title={isRecall ? 'ReCall' : undefined}
          >
            <div style={{ fontWeight: 700 }}>
              #{job.job_number || String(job.id).slice(0, 6)} — {name}
              {isRecall && <span style={{ marginLeft: 6 }}>⚠️ ReCall</span>}
            </div>
            {address ? (
              <div style={{ opacity: 0.9 }}>
                📍 {address.length > 60 ? address.slice(0, 60) + '…' : address}
              </div>
            ) : null}
            {job.issue && (
              <div style={{ opacity: 0.85 }}>
                {job.issue.length > 70 ? job.issue.slice(0, 70) + '…' : job.issue}
              </div>
            )}
            {unpaid && <div style={{ fontSize: 11, color: '#b91c1c' }}>не оплачено</div>}
          </div>
        );
      });

  const unassignedJobs = jobs.filter((j) => !j.appointment_time && j.technician_id);

  return (
    <div style={{ padding: 20 }}>
      <h3>Не назначенные заявки</h3>
      {technicians.map((tech) => (
        <div key={tech.id} style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '8px 0' }}>{tech.name}</h4>
          <table style={{ width: '100%', marginBottom: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {unassignedJobs
                .filter((j) => j.technician_id === tech.id)
                .map((job) => (
                  // Важно: не оборачиваем в <tr>, JobRowEditable сам возвращает <tr>
                  <JobRowEditable
                    key={job.id}
                    job={job}
                    technicians={technicians}
                    onUpdate={onJobUpdated}
                    onSelect={() => setSelectedJob(job)}
                  />
                ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3>Календарь по техникам</h3>
      {technicians.map((tech) => (
        <div key={tech.id}>
          <h4 style={{ margin: '8px 0' }}>{tech.name}</h4>
          <table border="1" cellPadding="5" style={{ width: '100%', marginBottom: 30, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Время</th>
                {days.map((d, i) => (
                  <th
                    key={i}
                    style={{
                      backgroundColor: d.toDateString() === new Date().toDateString() ? '#ffffcc' : undefined,
                    }}
                  >
                    {d.toLocaleDateString()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <td style={{ whiteSpace: 'nowrap' }}>{h}:00</td>
                  {days.map((day, j) => (
                    <td
                      key={j}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDrop(e, day, h, tech.id)}
                      style={{ minHeight: 56, verticalAlign: 'top' }}
                    >
                      {renderJobsForCell(tech, day, h)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {selectedJob && (
        <div
          style={{
            position: 'fixed',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#fff',
            border: '1px solid #ccc',
            padding: 20,
            width: 440,
            zIndex: 1000,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            Заявка #{selectedJob.job_number || String(selectedJob.id).slice(0, 6)}
          </h3>
          {(() => {
            const { name, address } = getClientInfo(selectedJob);
            return (
              <>
                <p><b>Клиент:</b> {name}</p>
                {address && <p><b>Адрес:</b> {address}</p>}
              </>
            );
          })()}
          <p><b>Проблема:</b> {selectedJob.issue || '—'}</p>
          <p>
            <b>Статус:</b> {selectedJob.status || '—'}
            {normalizeStatus(selectedJob.status) === 'recall' && (
              <span style={{ marginLeft: 8, color: '#b91c1c' }}>⚠️ ReCall</span>
            )}
          </p>
          <p><b>SCF:</b> {selectedJob.scf != null ? `$${selectedJob.scf}` : '—'}</p>
          <p><b>Дата и время:</b> {selectedJob.appointment_time ? new Date(selectedJob.appointment_time).toLocaleString() : '—'}</p>
          <p><b>Тип:</b> {selectedJob.system_type || selectedJob.system || '—'}</p>
          {(!selectedJob?.payment || selectedJob.payment === '—') && (
            <p style={{ color: '#b91c1c' }}><b>Оплата:</b> не выбрана / не оплачено</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setSelectedJob(null)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
