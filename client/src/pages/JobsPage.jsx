import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

/* ===== Статусы ===== */
const STATUS_VALUES = [
  'Recall',
  'Diagnosis',
  'In progress',
  'Parts ordered',
  'Waiting for parts',
  'To finish',
  'Completed',
];

/* ===== Какие статусы показываем ===== */
const VISIBLE_SET = new Set(['Recall', 'Diagnosis', 'In progress', 'To finish']);

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
  if (['completed', 'complete', 'done'].includes(low)) return 'Completed';

  return s;
};

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [savingId, setSavingId] = useState(null);

  // blacklist modal
  const [blOpen, setBlOpen] = useState(false);
  const [blClient, setBlClient] = useState(null);
  const [blText, setBlText] = useState('');
  const [blSaving, setBlSaving] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    const [jobsRes, clientsRes, techsRes] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('clients').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

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
    return d.toLocaleString();
  };

  const jobsView = useMemo(() => {
    return jobs.map((j) => {
      const c = clients.find((x) => x.id === j.client_id);
      return {
        ...j,
        status_canon: toDbStatus(j.status),
        client_name: c?.full_name || c?.name || '—',
        client_company: c?.company || '',
        client_phone: c?.phone || '',
        client_blacklist: (c?.blacklist || '').trim(),
        created_at_fmt: fmtDate(j.created_at),
      };
    });
  }, [jobs, clients]);

  const visibleJobs = useMemo(
    () => jobsView.filter((j) => !j.archived_at && VISIBLE_SET.has(j.status_canon)),
    [jobsView]
  );

  /* ===== СОРТИРОВКА: ТОЛЬКО ПО НОМЕРУ РАБОТЫ (ВОЗРАСТАНИЕ) ===== */
  const sortedJobs = useMemo(() => {
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return [...visibleJobs].sort((a, b) => {
      const an = toNum(a.job_number ?? a.id);
      const bn = toNum(b.job_number ?? b.id);

      if (an == null && bn != null) return 1;
      if (an != null && bn == null) return -1;
      if (an == null && bn == null) return 0;

      return an - bn; // ВОЗРАСТАНИЕ
    });
  }, [visibleJobs]);

  function handleChange(id, field, value) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, [field]: value } : j)));
  }

  async function handleSave(job) {
    setSavingId(job.id);
    try {
      const payload = {
        technician_id: job.technician_id || null,
        status: toDbStatus(job.status_canon),
        scf: job.scf === '' ? null : Number(job.scf),
        issue: job.issue || null,
      };

      const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
      if (error) throw error;

      await fetchAll();
    } catch (e) {
      console.error(e);
      alert('Save error');
    } finally {
      setSavingId(null);
    }
  }

  const openJob = (id) => navigate(`/job/${id}`);

  function openBlacklistEditor(job) {
    const client = clients.find((c) => c.id === job.client_id);
    if (!client) return;
    setBlClient(client);
    setBlText(client.blacklist || '');
    setBlOpen(true);
  }

  async function saveBlacklist() {
    if (!blClient) return;
    setBlSaving(true);
    try {
      await supabase
        .from('clients')
        .update({ blacklist: blText.trim() || null })
        .eq('id', blClient.id);

      setBlOpen(false);
      setBlClient(null);
      setBlText('');
      await fetchAll();
    } catch (e) {
      console.error(e);
      alert('Blacklist save error');
    } finally {
      setBlSaving(false);
    }
  }

  return (
    <div className="p-4">
      <CreateJob onCreated={fetchAll} />

      <div className="overflow-x-auto mt-4">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Job #</th>
              <th>Client</th>
              <th>Issue</th>
              <th>SCF</th>
              <th>Technician</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {sortedJobs.map((job) => (
              <tr key={job.id} onClick={() => openJob(job.id)}>
                <td>{job.job_number || job.id}</td>

                <td>
                  <b>{job.client_company || job.client_name}</b>
                  {job.client_blacklist && <span style={{ color: 'red', marginLeft: 6 }}>BLACKLIST</span>}
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    value={job.issue || ''}
                    onChange={(e) => handleChange(job.id, 'issue', e.target.value)}
                  />
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={job.scf ?? ''}
                    onChange={(e) => handleChange(job.id, 'scf', e.target.value)}
                  />
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    value={job.technician_id || ''}
                    onChange={(e) => handleChange(job.id, 'technician_id', e.target.value)}
                  >
                    <option value="">—</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    value={job.status_canon}
                    onChange={(e) =>
                      handleChange(job.id, 'status', toDbStatus(e.target.value))
                    }
                  >
                    {STATUS_VALUES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>

                <td onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleSave(job)} disabled={savingId === job.id}>
                    💾
                  </button>
                  <button onClick={() => openBlacklistEditor(job)}>🚫</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {blOpen && (
        <div className="modal-back" onClick={() => setBlOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Blacklist</h3>
            <textarea value={blText} onChange={(e) => setBlText(e.target.value)} rows={5} />
            <button onClick={saveBlacklist} disabled={blSaving}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
