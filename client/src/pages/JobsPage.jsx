// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

/* ===== Полный набор статусов (Title Case) ===== */
const STATUS_VALUES = [
  'Recall',
  'Diagnosis',
  'In progress',
  'Parts ordered',
  'Waiting for parts',
  'To finish',
  'Completed',
  ];

/* ===== Для сортировки — заданный порядок ===== */
const ALL_STATUS_ORDER = [...STATUS_VALUES];

/* ===== Какие статусы показываем в таблице ===== */
const VISIBLE_SET = new Set(['Recall', 'Diagnosis', 'In progress', 'To finish']);

/* ===== Нормализация произвольного значения к Title Case (как в БД) ===== */
const toDbStatus = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const low = s.toLowerCase().replace(/[\s\-_]+/g, '');

  if (low.startsWith('rec')) return 'Recall';
  if (low === 'diagnosis') return 'Diagnosis';
  if (low === 'inprogress') return 'In progress';
  if (low === 'partsordered') return 'Parts ordered';
  if (low === 'waitingforparts') return 'Waiting for parts';
  if (low === 'tofinish') return 'To finish';
  if (low === 'completed' || low === 'complete' || low === 'done' || s === 'Выполнено') return 'Completed';
  if (STATUS_VALUES.includes(s)) return s;
  return s[0].toUpperCase() + s.slice(1);
};

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [savingId, setSavingId] = useState(null);

  // === состояние модалки "чёрный список"
  const [blOpen, setBlOpen] = useState(false);
  const [blClient, setBlClient] = useState(null);     // полная строка клиента
  const [blText, setBlText] = useState('');
  const [blSaving, setBlSaving] = useState(false);

  const navigate = useNavigate();

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const jobsReq    = supabase.from('jobs').select('*');
    const clientsReq = supabase.from('clients').select('*'); // берём blacklist тоже
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
      const canon = toDbStatus(j.status);
      return {
        ...j,
        status_canon: canon,
        client_id: c?.id || null,
        client_name: c?.full_name || c?.name || '—',
        client_company: c?.company || '',
        client_phone: c?.phone || '',
        client_blacklist: (c?.blacklist || '').trim(),
        created_at_fmt: fmtDate(j.created_at),
      };
    });
  }, [jobs, clients]);

  // Видимость: только определённые статусы и неархивные
  const visibleJobs = useMemo(
    () => jobsView.filter((j) => !j.archived_at && VISIBLE_SET.has(j.status_canon || '')),
    [jobsView]
  );

  // Сортировка: по порядку статусов, затем по дате
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
        status: job.status ? toDbStatus(job.status) : (job.status_canon ?? null),
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

  // Открыть редактор blacklist по клиенту этой строки
  function openBlacklistEditor(job) {
    const client = clients.find((c) => c.id === job.client_id);
    if (!client) {
      alert('Client not found for this job');
      return;
    }
    setBlClient(client);
    setBlText((client.blacklist || '').trim());
    setBlOpen(true);
  }

  async function saveBlacklist() {
    if (!blClient) return;
    setBlSaving(true);
    try {
      const value = (blText || '').trim();
      const { error } = await supabase
        .from('clients')
        .update({ blacklist: value === '' ? null : value })
        .eq('id', blClient.id);
      if (error) throw error;
      setBlOpen(false);
      setBlClient(null);
      setBlText('');
      await fetchAll();
    } catch (e) {
      console.error(e);
      alert('Save blacklist error');
    } finally {
      setBlSaving(false);
    }
  }

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
        .icon-btn { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border:1px solid #e5e7eb; border-radius:6px; background:#fff; cursor:pointer; }
        .icon-btn:hover { background:#f3f4f6; }
        .icon-red { color:#b91c1c; border-color:#fecaca; }
        .tag-bl { display:inline-block; margin-left:6px; font-size:11px; color:#b91c1c; font-weight:700; }
        /* Modal */
        .modal-back { position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:50; }
        .modal-card { width:520px; max-width:calc(100% - 24px); background:#fff; border-radius:12px; border:1px solid #e5e7eb; box-shadow:0 10px 30px rgba(0,0,0,.15); }
        .modal-head { padding:12px 14px; border-bottom:1px solid #e5e7eb; font-weight:700; }
        .modal-body { padding:12px 14px; }
        .modal-foot { padding:12px 14px; border-top:1px solid #e5e7eb; display:flex; gap:8px; justify-content:flex-end; }
        .btn { padding:8px 12px; border-radius:8px; border:1px solid #e5e7eb; background:#f8fafc; cursor:pointer; }
        .btn-primary { background:#2563eb; color:#fff; border-color:#2563eb; }
        .btn-danger { background:#fee2e2; color:#b91c1c; border-color:#fecaca; }
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
            <col style={{ width: 180 }} />
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

                {/* CLIENT with company + метка, если в ч/с */}
                <td>
                  <div className="cell-wrap">
                    {job.client_company ? (
                      <>
                        <div style={{ fontWeight: 600 }}>
                          {job.client_company}
                          {job.client_blacklist ? <span className="tag-bl">BLACKLIST</span> : null}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: 12 }}>
                          {job.client_name}
                          {job.client_phone ? ` — ${job.client_phone}` : ''}
                        </div>
                      </>
                    ) : (
                      <div>
                        {job.client_name}
                        {job.client_phone ? ` — ${job.client_phone}` : ''}
                        {job.client_blacklist ? <span className="tag-bl">BLACKLIST</span> : null}
                      </div>
                    )}
                  </div>
                </td>

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
                      const canon = toDbStatus(e.target.value);
                      setJobs((prev) =>
                        prev.map((j) =>
                          j.id === job.id ? { ...j, status: canon, status_canon: canon } : j
                        )
                      );
                    }}
                  >
                    <option value="">—</option>
                    {STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </td>

                {/* ACTIONS: Save / Edit / Blacklist */}
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      title="Save"
                      className="icon-btn"
                      onClick={() => handleSave(job)}
                      disabled={savingId === job.id}
                    >
                      {savingId === job.id ? '…' : '💾'}
                    </button>

                    <button
                      title="Edit"
                      className="icon-btn"
                      onClick={() => openJob(job.id)}
                    >
                      ✏️
                    </button>

                    <button
                      title={
                        job.client_blacklist
                          ? `Blacklist: ${job.client_blacklist}`
                          : 'Add to blacklist'
                      }
                      className={`icon-btn ${job.client_blacklist ? 'icon-red' : ''}`}
                      onClick={() => openBlacklistEditor(job)}
                    >
                      🚫
                    </button>
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

      {/* ===== Modal: Blacklist editor ===== */}
      {blOpen && (
        <div className="modal-back" onClick={() => setBlOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">Чёрный список клиента</div>
            <div className="modal-body">
              <div style={{ marginBottom: 6, color: '#6b7280', fontSize: 13 }}>
                {blClient?.full_name || '—'}
                {blClient?.company ? ` • ${blClient.company}` : ''}
                {blClient?.phone ? ` • ${blClient.phone}` : ''}
              </div>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                Причина / заметка (будет сохранена в clients.blacklist):
              </label>
              <textarea
                value={blText}
                onChange={(e) => setBlText(e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: '8px 10px',
                  resize: 'vertical',
                }}
                placeholder="Например: не оплачивает счета, не подпускает к оборудованию и т.п."
              />
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                Пустое поле — удалит отметку из чёрного списка.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setBlOpen(false)} disabled={blSaving}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => { setBlText(''); }}
                disabled={blSaving}
                title="Очистить blacklist"
              >
                Clear
              </button>
              <button className="btn btn-primary" onClick={saveBlacklist} disabled={blSaving}>
                {blSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

