// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

/* ===== Полный набор статусов для выбора (лейблы для UI) ===== */
const STATUS_LABELS = {
  recall: 'ReCall',
  diagnosis: 'Diagnosis',
  'in progress': 'In progress',
  'parts ordered': 'Parts ordered',
  'waiting for parts': 'Waiting for parts',
  'to finish': 'To finish',
  completed: 'Completed',
  canceled: 'Canceled',
};
const ALL_STATUS_ORDER = [
  'recall',
  'diagnosis',
  'in progress',
  'parts ordered',
  'waiting for parts',
  'to finish',
  'completed',
  'canceled',
];

/* ===== Видим только эти статусы в таблице ===== */
const VISIBLE_SET = new Set(['recall', 'Diagnosis', 'In progress', 'To finish']);

/* ===== Нормализация произвольного статуса к канону (нижний регистр) ===== */
const canonStatus = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const low = s.toLowerCase();

  if (low.includes('recall')) return 'recall';
  if (low === 'Diagnosis') return 'Diagnosis';
  if (low === 'In progress' || low === 'In-progress') return 'In progress';
  if (low === 'Parts ordered' || low === 'Parts-ordered') return 'Parts ordered';
  if (low.startsWith('Waiting for')) return 'Waiting for parts';
  if (low === 'To finish' || low === 'To-finish') return 'To finish';
  if (low === 'Completed' || low === 'Complete') return 'Completed';
  if (low === 'Canceled' || low === 'Cancelled' || low === 'Declined') return 'Canceled';

  // если встретился другой текст — вернём как есть (но в нижнем регистре)
  return low;
};

const labelFor = (canon) => STATUS_LABELS[canon] ?? (canon ? canon[0].toUpperCase() + canon.slice(1) : '—');

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const jobsReq    = supabase.from('jobs').select('*');
    const clientsReq = supabase.from('clients').select('*');
    const techsReq   = supabase
      .from('technicians')
      .select('id,name,role,is_active')
      .in('role', ['technician', 'tech'])
      .eq('is_active', true)
      .order('name', { ascending: true });

    const [jobsRes, clientsRes, techsRes] = await Promise.all([jobsReq, clientsReq, techsReq]);
    if (jobsRes.error) console.error(jobsRes.error);
    if (clientsRes.error) console.error(clientsRes.error);
    if (techsRes.error) console.error(techsRes.error);

    setJobs(jobsRes.data || []);
    setClients(clientsRes.data || []);
    setTechnicians(techsRes.data || []);
  }

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const jobsView = useMemo(() => {
    return (jobs || []).map((j) => {
      const c = clients.find((x) => x.id === j.client_id);
      const canon = canonStatus(j.status);
      return {
        ...j,
        status_canon: canon,
        client_name: c?.full_name || c?.name || '—',
        client_phone: c?.phone || '',
        created_at_fmt: fmtDate(j.created_at),
      };
    });
  }, [jobs, clients]);

  // Показываем ТОЛЬКО нужные статусы и неархивные заявки
  const visibleJobs = useMemo(
    () => jobsView.filter((j) => !j.archived_at && VISIBLE_SET.has(String(j.status_canon || ''))),
    [jobsView]
  );

  // Сортировка: по приоритету статуса, затем по дате (новые выше)
  const orderMap = useMemo(() => new Map(ALL_STATUS_ORDER.map((s, i) => [s, i])), []);
  const sortedJobs = useMemo(() => {
    return [...visibleJobs].sort((a, b) => {
      const ar = orderMap.get(a.status_canon) ?? 999;
      const br = orderMap.get(b.status_canon) ?? 999;
      if (ar !== br) return ar - br;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [visibleJobs, orderMap]);

  function handleChange(id, field, value) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, [field]: value } : j)));
  }

  async function handleSave(job) {
    setSavingId(job.id);
    try {
      const payload = {
        technician_id: job.technician_id ? job.technician_id : null,
        // сохраняем в каноне, чтобы дальше всё было единообразно
        status: job.status ? canonStatus(job.status) : (job.status_canon ?? null),
        scf:
          job.scf === '' || job.scf == null
            ? null
            : Number.isNaN(Number(job.scf)) ? null : Number(job.scf),
        issue: job.issue || null,
      };
      const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
      if (error) throw error;
      await fetchAll();
      alert('Saved');
    } catch (e) {
      console.error(e);
      alert('Save error');
    } finally {
      setSavingId(null);
    }
  }

  const openJob = (id) => navigate(`/job/${id}`);

  // Полный набор опций для выбора статуса в каждой строке
  const STATUS_OPTIONS = useMemo(
    () => ALL_STATUS_ORDER.map((value) => ({ value, label: labelFor(value) })),
    []
  );

  return (
    <div className="p-4">
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .row-click { cursor:pointer; }
        .row-click:hover { background:#f9fafb; }
        .jobs-table input, .jobs-table select { width:100%; height:28px; font-size:14px; padding:2px 6px; box-sizing:border-box; }
        @media (max-width: 1024px) { .col-system, .col-date { display:none; } }
      `}</style>

      <CreateJob onCreated={fetchAll} />

      <div className="overflow-x-auto" style={{ marginTop: 16 }}>
        <table className="jobs-table">
          <colgroup>
            <col style={{ width: 70 }} />
            <col style={{ width: 240 }} />
            <col style={{ width: 140 }} className="col-system" />
            <col style={{ width: 300 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 160 }} className="col-date" />
            <col style={{ width: 180 }} />
            <col style={{ width: 140 }} />
          </colgroup>

          <thead>
            <tr>
              <th>Job #</th>
              <th>Client</th>
              <th className="col-system">System</th>
              <th>Issue</th>
              <th>SCF</th>
              <th>Technician</th>
              <th className="col-date">Created</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {sortedJobs.map((job) => (
              <tr
                key={job.id}
                className="row-click"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  const tag = e.target.tagName;
                  if (!['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(tag)) openJob(job.id);
                }}
                onKeyDown={(e) => {
                  if (!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJob(job.id); }
                  }
                }}
                title="Open job"
              >
                <td>
                  <div
                    className="cell-wrap num-link"
                    onClick={(e) => { e.stopPropagation(); openJob(job.id); }}
                  >
                    {job.job_number || job.id}
                  </div>
                </td>

                <td><div className="cell-wrap">
                  {job.client_name}{job.client_phone ? ` — ${job.client_phone}` : ''}
                </div></td>

                <td className="col-system"><div className="cell-wrap">{job.system_type || '—'}</div></td>

                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={job.issue ?? ''}
                    onChange={(e) => handleChange(job.id, 'issue', e.target.value)}
                    placeholder="—"
                  />
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={job.scf ?? ''}
                    onChange={(e) => handleChange(job.id, 'scf', e.target.value)}
                    placeholder="—"
                  />
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    value={job.technician_id || ''}
                    onChange={(e) => handleChange(job.id, 'technician_id', e.target.value || null)}
                  >
                    <option value="">—</option>
                    {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>

                <td className="col-date"><div className="cell-wrap">{job.created_at_fmt}</div></td>

                <td onClick={(e) => e.stopPropagation()}>
                  {/* Полный набор опций; строка при смене на "невидимый" статус пропадёт после сохранения/обновления */}
                  <select
                    value={job.status_canon || ''}
                    onChange={(e) => {
                      const canon = e.target.value;
                      setJobs((prev) =>
                        prev.map((j) =>
                          j.id === job.id ? { ...j, status: canon, status_canon: canon } : j
                        )
                      );
                    }}
                  >
                    <option value="">—</option>
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      title="Save"
                      onClick={() => handleSave(job)}
                      disabled={savingId === job.id}
                    >
                      {savingId === job.id ? '…' : '💾'}
                    </button>
                    <button title="Edit" onClick={() => openJob(job.id)}>✏️</button>
                  </div>
                </td>
              </tr>
            ))}

            {sortedJobs.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 10 }}>No jobs in selected statuses</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

