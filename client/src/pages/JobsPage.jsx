// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

/* ===== Канон и лейблы ===== */
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
const STATUS_ORDER = Object.keys(STATUS_LABELS);

/* ===== Нормализация из БД к канону ===== */
const canonStatus = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const low = s.toLowerCase();

  // частые варианты с капитализацией/пробелами
  if (low.includes('recall')) return 'recall';
  if (low === 'diagnosis') return 'diagnosis';
  if (low === 'in progress' || low === 'in-progress') return 'in progress';
  if (low === 'parts ordered' || low === 'parts-ordered') return 'parts ordered';
  if (low.startsWith('waiting for')) return 'waiting for parts';
  if (low === 'to finish' || low === 'to-finish') return 'to finish';
  if (low === 'completed' || low === 'complete') return 'completed';
  if (low === 'canceled' || low === 'cancelled' || low === 'declined') return 'canceled';

  // если встретилось что-то иное — оставим как есть в нижнем регистре,
  // чтобы селект не пустел (добавим опцию на лету)
  return low;
};

/* чтобы красиво показать даже нестандартные статусы */
const labelFor = (canon) => STATUS_LABELS[canon] ?? (canon ? canon[0].toUpperCase() + canon.slice(1) : '—');

/* НЕ скрываем по статусу — только архив */
const HIDDEN_STATUSES = new Set();

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

  // активный список: не показываем архив
  const activeJobsView = useMemo(() => {
    return jobsView.filter(
      (j) =>
        !HIDDEN_STATUSES.has(String(j.status_canon || '').toLowerCase()) &&
        !j.archived_at
    );
  }, [jobsView]);

  const orderMap = useMemo(() => {
    const m = new Map(STATUS_ORDER.map((s, i) => [s.toLowerCase(), i]));
    return m;
  }, []);

  const sortedJobs = useMemo(() => {
    return [...activeJobsView].sort((a, b) => {
      const ar = orderMap.get(String(a.status_canon || '').toLowerCase()) ?? 999;
      const br = orderMap.get(String(b.status_canon || '').toLowerCase()) ?? 999;
      if (ar !== br) return ar - br;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [activeJobsView, orderMap]);

  function handleChange(id, field, value) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, [field]: value } : j)));
  }

  async function handleSave(job) {
    setSavingId(job.id);
    try {
      const payload = {
        technician_id: job.technician_id ? job.technician_id : null,
        // сохраняем канон
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

  // Архив / разархивировать
  async function handleArchive(job) {
    try {
      if (!job.archived_at) {
        const reason =
          window.prompt('Archive reason (e.g. "repair declined")', 'repair declined') || null;
        const patch = {
          archived_at: new Date().toISOString(),
          archived_reason: reason,
          status: 'canceled',
        };
        const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
        if (error) throw error;
      } else {
        if (!window.confirm('Restore job from archive?')) return;
        const patch = { archived_at: null, archived_reason: null };
        const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
        if (error) throw error;
      }
      await fetchAll();
    } catch (e) {
      console.error(e);
      alert('Archive failed: ' + (e.message || e));
    }
  }

  const openJob = (id) => navigate(`/job/${id}`);

  // список опций селекта: канон -> лейбл
  const STATUS_OPTIONS = useMemo(() => {
    return Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));
  }, []);

  // собрать набор статусов, чтобы отобразить и нестандартные (если вдруг есть)
  const extraStatuses = useMemo(() => {
    const set = new Set(Object.keys(STATUS_LABELS));
    for (const j of jobsView) {
      if (j.status_canon && !set.has(j.status_canon)) set.add(j.status_canon);
    }
    return Array.from(set);
  }, [jobsView]);

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
            <col style={{ width: 160 }} />
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
              <th className="col-date">Date</th>
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
                  <select
                    value={job.status_canon || ''}
                    onChange={(e) => {
                      const canon = e.target.value;
                      // держим и "сырой" статус для сохранения, и канон для UI
                      setJobs((prev) =>
                        prev.map((j) =>
                          j.id === job.id ? { ...j, status: canon, status_canon: canon } : j
                        )
                      );
                    }}
                  >
                    <option value="">—</option>

                    {/* основной набор */}
                    {STATUS_ORDER.map((value) => (
                      <option key={value} value={value}>{labelFor(value)}</option>
                    ))}

                    {/* вдруг есть «нестандартный» из старых данных */}
                    {extraStatuses
                      .filter((v) => !STATUS_ORDER.includes(v))
                      .map((v) => (
                        <option key={v} value={v}>{labelFor(v)}</option>
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
                    <button
                      title={job.archived_at ? 'Restore from archive' : 'Archive'}
                      onClick={(e) => { e.stopPropagation(); handleArchive(job); }}
                    >
                      {job.archived_at ? '♻️' : '📦 Archive'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {sortedJobs.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 10 }}>No jobs</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
