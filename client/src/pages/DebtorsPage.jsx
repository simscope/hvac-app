// client/src/pages/DebtorsPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

const DebtorsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterTech, setFilterTech] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [showBlacklistedOnly, setShowBlacklistedOnly] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);

    const [jobsRes, techRes, clientsRes] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
      supabase.from('clients').select('*'),
    ]);

    setJobs(jobsRes.data || []);
    setOrigJobs(jobsRes.data || []);
    setTechnicians(techRes.data || []);
    setClients(clientsRes.data || []);
    setLoading(false);
  };

  const getClient = useCallback((id) => clients.find((c) => c.id === id), [clients]);

  const handleChange = (id, field, value) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, [field]: value } : j)));
  };

  const handleSave = async (job) => {
    const payload = {
      scf: job.scf !== '' && job.scf != null ? parseFloat(job.scf) : null,
      labor_price: job.labor_price !== '' && job.labor_price != null ? parseFloat(job.labor_price) : null,
      scf_payment_method: job.scf_payment_method ?? null,
      labor_payment_method: job.labor_payment_method ?? null,
    };

    const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
    if (error) {
      console.error('Save error (debtor job):', error, payload);
      alert('Failed to save');
      return;
    }

    await fetchAll();
    alert('Saved');
  };

  const toggleBlacklist = async (clientId, shouldBlacklist) => {
    const c = getClient(clientId);
    if (!c) return;

    const value = shouldBlacklist
      ? `BLACKLIST: unpaid / ${new Date().toISOString()}`
      : null;

    const { error } = await supabase.from('clients').update({ blacklist: value }).eq('id', clientId);
    if (error) {
      console.error('Blacklist update error:', error);
      alert('Failed to update blacklist');
      return;
    }
    await fetchAll();
  };

  const filtered = useMemo(() => {
    const list = (jobs || [])
      // ✅ только Completed
      .filter((j) => isDone(j.status))
      // ✅ только неоплаченные (по твоей логике)
      .filter((j) => isUnpaidByPaymentMethod(j))
      // фильтр по технику
      .filter((j) => (filterTech === 'all' ? true : String(j.technician_id) === String(filterTech)))
      // фильтр по blacklisted
      .filter((j) => {
        if (!showBlacklistedOnly) return true;
        const c = getClient(j.client_id);
        return Boolean(String(c?.blacklist || '').trim());
      })
      // поиск
      .filter((j) => {
        if (!searchText.trim()) return true;
        const t = searchText.toLowerCase();
        const c = getClient(j.client_id);

        const addr = formatAddress(c).toLowerCase();
        return (
          String(j.job_number || '').toLowerCase().includes(t) ||
          String(c?.company || '').toLowerCase().includes(t) ||
          String(c?.full_name || c?.name || '').toLowerCase().includes(t) ||
          String(c?.phone || '').toLowerCase().includes(t) ||
          addr.includes(t)
        );
      })
      .sort((a, b) => {
        const A = (a.job_number || a.id).toString();
        const B = (b.job_number || b.id).toString();
        return sortAsc ? A.localeCompare(B) : B.localeCompare(A);
      });

    return list;
  }, [jobs, filterTech, searchText, showBlacklistedOnly, sortAsc, getClient]);

  const grouped = useMemo(() => {
    const g = {};
    for (const j of filtered) {
      const key = j.technician_id || 'No technician';
      if (!g[key]) g[key] = [];
      g[key].push(j);
    }
    return g;
  }, [filtered]);

  return (
    <div className="p-4">
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#0f172a; color:#e5e7eb; font-weight:700; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table input, .jobs-table select { width:100%; height:28px; font-size:14px; padding:2px 6px; box-sizing:border-box; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .jobs-table .center { text-align:center; }

        .jobs-table tr.debtor { background:#fee2e2; }
        .jobs-table tr.debtor:hover { background:#fecaca; }
        .jobs-table tr.blacklisted { outline: 2px solid rgba(239,68,68,.45); outline-offset:-2px; }
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }

        .filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; align-items:center; }
        .pill { display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border-radius:999px; border:1px solid #e5e7eb; background:#fff; }
        .btn { border:1px solid #e5e7eb; background:#fff; padding:6px 10px; border-radius:10px; cursor:pointer; }
        .btn:hover { background:#f8fafc; }
        .btn-danger { border-color: rgba(239,68,68,.35); }
        .btn-danger:hover { background:#fff1f2; }
      `}</style>

      <h1 className="text-2xl font-bold mb-2">💳 Должники (Completed & Unpaid)</h1>

      <div className="filters">
        <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="all">All technicians</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Job #, company, name, phone or address"
          style={{ width: 320 }}
        />

        <label className="pill" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showBlacklistedOnly}
            onChange={(e) => setShowBlacklistedOnly(e.target.checked)}
          />
          Только blacklist
        </label>

        <button className="btn" onClick={() => setSortAsc(!sortAsc)}>
          Sort by Job # {sortAsc ? '↑' : '↓'}
        </button>

        <button
          className="btn"
          onClick={() => {
            setFilterTech('all');
            setSearchText('');
            setShowBlacklistedOnly(false);
            setSortAsc(false);
          }}
        >
          Reset
        </button>

        <button className="btn" onClick={fetchAll}>
          Refresh
        </button>
      </div>

      {loading && <p>Loading...</p>}
      {!loading && filtered.length === 0 && <p>No debtors found.</p>}

      {Object.entries(grouped).map(([techId, groupJobs]) => (
        <div key={techId} className="mb-6">
          <h2 className="text-lg font-semibold mb-1">
            {techId === 'No technician'
              ? '🧾 No technician'
              : `👨‍🔧 ${technicians.find((t) => String(t.id) === String(techId))?.name || '—'}`}
            <span style={{ marginLeft: 10, color: '#6b7280', fontSize: 13 }}>
              ({groupJobs.length})
            </span>
          </h2>

          <div className="overflow-x-auto">
            <table className="jobs-table">
              <colgroup>
                <col style={{ width: 70 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 260 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 50 }} />
                <col style={{ width: 50 }} />
              </colgroup>

              <thead>
                <tr>
                  <th>Job #</th>
                  <th>Client</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>System</th>
                  <th>Issue</th>
                  <th>SCF</th>
                  <th>SCF payment</th>
                  <th>Labor</th>
                  <th>Labor payment</th>
                  <th className="center">Archived</th>
                  <th className="center">BL</th>
                  <th className="center">💾</th>
                  <th className="center">✏️</th>
                </tr>
              </thead>

              <tbody>
                {groupJobs.map((job) => {
                  const client = getClient(job.client_id);
                  const isBL = Boolean(String(client?.blacklist || '').trim());

                  const scfError = needsScfPayment(job);
                  const laborError = needsLaborPayment(job);

                  return (
                    <tr
                      key={job.id}
                      className={`debtor ${isBL ? 'blacklisted' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        const tag = e.target.tagName;
                        if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) {
                          navigate(`/job/${job.id}`);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/job/${job.id}`);
                          }
                        }
                      }}
                      title="Open job details"
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div
                          className="cell-wrap"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/job/${job.id}`);
                          }}
                        >
                          <span className="num-link">{job.job_number || job.id}</span>
                        </div>
                      </td>

                      <td>
                        <div className="cell-wrap">
                          {client?.company ? (
                            <>
                              <div style={{ fontWeight: 700 }}>{client.company}</div>
                              <div style={{ color: '#6b7280', fontSize: 12 }}>
                                {client.full_name || client.name || '—'}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontWeight: 700 }}>{client?.full_name || client?.name || '—'}</div>
                          )}
                          {isBL && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#dc2626', fontWeight: 700 }}>
                              BLACKLIST
                            </div>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="cell-wrap">{client?.phone || '—'}</div>
                      </td>

                      <td>
                        <div className="cell-wrap">{formatAddress(client) || '—'}</div>
                      </td>

                      <td>
                        <div className="cell-wrap">{job.system_type || '—'}</div>
                      </td>

                      <td>
                        <div className="cell-wrap">{job.issue || '—'}</div>
                      </td>

                      <td>
                        <input
                          type="number"
                          value={job.scf || ''}
                          onChange={(e) => handleChange(job.id, 'scf', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>

                      <td>
                        <select
                          className={scfError ? 'error' : ''}
                          value={job.scf_payment_method || ''}
                          onChange={(e) => handleChange(job.id, 'scf_payment_method', e.target.value || null)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">—</option>
                          <option value="cash">cash</option>
                          <option value="zelle">Zelle</option>
                          <option value="card">card</option>
                          <option value="check">check</option>
                          <option value="ACH">ACH</option>
                          <option value="-">-</option>
                        </select>
                      </td>

                      <td>
                        <input
                          type="number"
                          value={job.labor_price || ''}
                          onChange={(e) => handleChange(job.id, 'labor_price', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>

                      <td>
                        <select
                          className={laborError ? 'error' : ''}
                          value={job.labor_payment_method || ''}
                          onChange={(e) => handleChange(job.id, 'labor_payment_method', e.target.value || null)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">—</option>
                          <option value="cash">cash</option>
                          <option value="zelle">Zelle</option>
                          <option value="card">card</option>
                          <option value="check">check</option>
                          <option value="ACH">ACH</option>
                          <option value="-">-</option>
                        </select>
                      </td>

                      <td className="center">{job.archived_at ? '✅' : ''}</td>

                      <td className="center">
                        <button
                          className={`btn ${isBL ? '' : 'btn-danger'}`}
                          title={isBL ? 'Remove from blacklist' : 'Add to blacklist'}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBlacklist(job.client_id, !isBL);
                          }}
                        >
                          {isBL ? '✅' : '⛔'}
                        </button>
                      </td>

                      <td className="center">
                        <button
                          className="btn"
                          title="Save"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSave(job);
                          }}
                        >
                          💾
                        </button>
                      </td>

                      <td className="center">
                        <button
                          className="btn"
                          title="Open job"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/job/${job.id}`);
                          }}
                        >
                          ✏️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DebtorsPage;

/* ===== helpers ===== */

function canonStatus(val) {
  const raw = String(val ?? '').toLowerCase();
  const v = raw.replace(/[\s\-_]+/g, '');
  if (!v) return '';
  if (v.startsWith('rec')) return 'recall';
  if (v === 'diagnosis') return 'diagnosis';
  if (v === 'inprogress') return 'in progress';
  if (v === 'partsordered') return 'parts ordered';
  if (v === 'waitingforparts') return 'waiting for parts';
  if (v === 'tofinish') return 'to finish';
  if (v === 'completed' || v === 'complete' || v === 'done') return 'completed';
  return v;
}

function isDone(status) {
  return canonStatus(status) === 'completed';
}

function methodChosen(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
}

// твоя логика: неоплачено = НЕ выбран тип оплаты
function isUnpaidByPaymentMethod(j) {
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  const scfUnpaid = scf > 0 && !methodChosen(j.scf_payment_method);
  const laborUnpaid = labor > 0 && !methodChosen(j.labor_payment_method);

  // если вообще нет сумм — не считаем должником
  if (scf <= 0 && labor <= 0) return false;

  return scfUnpaid || laborUnpaid;
}

function needsScfPayment(j) {
  return Number(j.scf || 0) > 0 && !methodChosen(j.scf_payment_method);
}

function needsLaborPayment(j) {
  return Number(j.labor_price || 0) > 0 && !methodChosen(j.labor_payment_method);
}

function formatAddress(c) {
  if (!c) return '';
  const parts = [
    c.address,
    c.address_line1,
    c.address_line2,
    c.street,
    c.city,
    c.state,
    c.region,
    c.zip,
    c.postal_code,
  ].filter(Boolean);
  return parts.join(', ');
}
