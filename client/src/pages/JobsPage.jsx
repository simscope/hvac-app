// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

/* ===== Status dictionaries ===== */
// Canonical order (English values)
const STATUS_ORDER_VALUES = [
  'recall',
  'diagnosis',
  'in progress',
  'parts ordered',
  'waiting for parts',
  'to finish',
  'completed',
  'canceled',
];

// UI labels for the dropdown (English)
const STATUS_LABELS = [
  { value: 'recall',            label: 'ReCall' },
  { value: 'diagnosis',         label: 'Diagnosis' },
  { value: 'in progress',       label: 'In progress' },
  { value: 'parts ordered',     label: 'Parts ordered' },
  { value: 'waiting for parts', label: 'Waiting for parts' },
  { value: 'to finish',         label: 'To finish' },
  { value: 'completed',         label: 'Completed' },
  { value: 'canceled',          label: 'Canceled' },
];

// Hidden statuses (English canonical)
const HIDDEN_STATUSES = new Set(['diagnosis','in progress','parts ordered','completed','canceled']);

// Map common Russian variants → English canonical
function normalizeStatus(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  // Russian → English
  if (v === 'recall' || v === 'recall' ) return 'recall';
  if (v === 'диагностика') return 'diagnosis';
  if (v === 'в работе') return 'in progress';
  if (v === 'заказ деталей') return 'parts ordered';
  if (v === 'ожидание деталей') return 'waiting for parts';
  if (v === 'к финишу') return 'to finish';
  if (v === 'завершено' || v === 'выполнено') return 'completed';
  if (v === 'отменено' || v === 'отказ') return 'canceled';
  // Already English or unknown -> keep as is
  return v;
}

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
      return {
        ...j,
        // compute normalized status (for view/sort/filter)
        _status_norm: normalizeStatus(j.status),
        client_name: c?.full_name || c?.name || '—',
        client_phone: c?.phone || '',
        created_at_fmt: fmtDate(j.created_at),
      };
    });
  }, [jobs, clients]);

  // In active list we hide "archived"
  const activeJobsView = useMemo(() => {
    return jobsView.filter(
      (j) =>
        !HIDDEN_STATUSES.has(j._status_norm) &&
        !j.archived_at // hide archived
    );
  }, [jobsView]);

  const orderMap = useMemo(() => {
    const m = new Map();
    STATUS_ORDER_VALUES.forEach((val, idx) => m.set(val, idx));
    // add Russian synonyms to the same rank (for legacy data)
    m.set('recall', m.get('recall'));
    m.set('диагностика', m.get('diagnosis'));
    m.set('в работе', m.get('in progress'));
    m.set('заказ деталей', m.get('parts ordered'));
    m.set('ожидание деталей', m.get('waiting for parts'));
    m.set('к финишу', m.get('to finish'));
    m.set('завершено', m.get('completed'));
    m.set('выполнено', m.get('completed'));
    m.set('отменено', m.get('canceled'));
    m.set('отказ', m.get('canceled'));
    return m;
  }, []);

  const sortedJobs = useMemo(() => {
    return [...activeJobsView].sort((a, b) => {
      const ar = orderMap.get(a._status_norm) ?? 999;
      const br = orderMap.get(b._status_norm) ?? 999;
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
        status: job.status != null ? normalizeStatus(job.status) : null, // save in English canonical
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
      alert('Failed to save');
    } finally {
      setSavingId(null);
    }
  }

  // Archive / Unarchive
  async function handleArchive(job) {
    try {
      if (!job.archived_at) {
        const reason =
          window.prompt('Archive reason (e.g., "customer declined repair")', 'customer declined repair') || null;
        const patch = {
          archived_at: new Date().toISOString(),
          archived_reason: reason,
          status: 'canceled', // mark as canceled; adjust if you prefer not to change status
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
      alert('Archiving failed: ' + (e.message || e));
    }
  }

  const openJob = (id) => navigate(`/job/${id}`);

  const STATUS_OPTIONS = useMemo(() => STATUS_LABELS, []);

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

                {/* Issue */}
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
                    value={normalizeStatus(job.status) || ''}
                    onChange={(e) => handleChange(job.id, 'status', e.target.value)}
                  >
                    <option value="">—</option>
                    {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                    {/* Archive instead of "Invoice" */}
                    <button
                      title={job.archived_at ? 'Unarchive' : 'Archive'}
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
