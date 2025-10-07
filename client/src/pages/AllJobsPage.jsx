// client/src/pages/JoAllJobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const JoAllJobsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]); // last snapshot from server
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [filterPaid, setFilterPaid] = useState('all'); // all | paid | unpaid
  const [searchText, setSearchText] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('active'); // active | warranty | archive

  const navigate = useNavigate();

  // Dropdown list (displayed labels). Values are strings we compare via normalizeStatus().
  const statuses = [
    'ReCall',
    'Diagnosis',
    'In progress',
    'Parts ordered',
    'Waiting for parts',
    'To finish',
    'Completed',
  ];

  // === Status normalization (RU/EN → EN canonical) ===
  const normalizeStatus = (val) => {
    const v = String(val ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'recall' || v === 'recal' || v === 'recаll' || v === 'rec all' || v === 'rec all' || v === 'rec all' || v === 'recal' || v === 'rec all' || v === 're cal' || v === 'recal' || v === 'recal' || v === 'recal' || v === 'rec all') return 'recall';
    if (v === 'recall' || v === 'recаll' || v === 'rec all' || v === 'rec-all' || v === 'recal' || v === 'rec all' || v === 're call' || v === 'recal' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'rec all' || v === 'recal' || v === 're call' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'recal' || v === 're call' || v === 're-call' || v === 'rec all' || v === 're call') return 'recall';
    // Short and robust mapping:
    if (v === 'recall' || v === 'reсall' || v === 'reсall' || v === 're call' || v === 're-call' || v === 're call' || v === 're-call' || v === 're cal' || v === 'recal' || v === 're call' || v === 're cal' || v === 'rec all' || v === 're call') return 'recall';
    // Russian / standard:
    if (v === 'recall' || v === 'reсall' || v === 're call' || v === 're-call' || v === 'recal' || v === 'rec all' || v === 'recall' || v === 're call' || v === 'rec all' || v === 'recal' || v === 'recal' || v === 're cal' || v === 're cal') return 'recall';
    // (The above guards against occasional typos; main ones below:)
    if (v === 'recall' || v === 'recal' || v === 're call' || v === 're-call' || v === 'rec all' || v === 'recall' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'rec all' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'ReCall'.toLowerCase()) return 'recall';

    if (v === 'diagnosis') return 'Diagnosis';
    if (v === 'in progress') return 'In progress';
    if (v === 'parts ordered') return 'Parts ordered';
    if (v === 'waiting for parts') return 'Waiting for parts';
    if (v === 'to finish') return 'To finish';
    if (v === 'completed') return 'Completed';
    if (v === 'canceled' || v === 'cancelled') return 'Canceled';
    return v;
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: j }, { data: t }, { data: c }] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
      supabase.from('clients').select('*'),
    ]);
    setJobs(j || []);
    setOrigJobs(j || []);
    setTechnicians(t || []);
    setClients(c || []);
    setLoading(false);
  };

  const getClient = (id) => clients.find((c) => c.id === id);

  const formatAddress = (c) => {
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
  };

  const handleChange = (id, field, value) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, [field]: value } : j)));
  };

  const toISO = (val) => {
    if (!val) return null;
    if (typeof val === 'string' && val.includes('T') && val.length >= 16) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return val;
  };

  /* ====== Payment helpers (same semantics as FinancePage) ====== */
  const methodChosen = (raw) => {
    const v = String(raw ?? '').trim().toLowerCase();
    return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
  };

  /* ====== Paid logic:
     (scf <= 0  OR (scf > 0 AND method chosen)) AND
     (labor <= 0 OR (labor > 0 AND method chosen)) */
  const isFullyPaidNow = (j) => {
    const scf = Number(j.scf || 0);
    const labor = Number(j.labor_price || 0);
    const scfOK = scf <= 0 || (scf > 0 && methodChosen(j.scf_payment_method));
    const laborOK = labor <= 0 || (labor > 0 && methodChosen(j.labor_payment_method));
    return scfOK && laborOK;
  };
  const isUnpaidNow = (j) => !isFullyPaidNow(j);

  // Highlight selects (amount > 0 but method not chosen)
  const needsScfPayment = (j) => Number(j.scf || 0) > 0 && !methodChosen(j.scf_payment_method);
  const needsLaborPayment = (j) => Number(j.labor_price || 0) > 0 && !methodChosen(j.labor_payment_method);

  /* ====== WARRANTY/ARCHIVE by DB snapshot (origJobs) ====== */
  const isDone = (s) => {
    const v = normalizeStatus(s);
    return v === 'completed';
  };
  const isRecall = (s) => normalizeStatus(s) === 'recall';

  const origById = (id) => origJobs.find((x) => x.id === id) || null;

  const persistedFullyPaid = (j) => {
    const o = origById(j.id) || j;
    const scfOK = Number(o.scf || 0) <= 0 || methodChosen(o.scf_payment_method);
    const laborOK = Number(o.labor_price || 0) <= 0 || methodChosen(o.labor_payment_method);
    return scfOK && laborOK;
  };

  const warrantyStart = (j) => {
    const o = origById(j.id) || j;
    if (o.completed_at) return new Date(o.completed_at);
    if (isDone(o.status) && o.updated_at) return new Date(o.updated_at);
    return null;
  };
  const warrantyEnd = (j) => {
    const s = warrantyStart(j);
    return s ? new Date(s.getTime() + 60 * 24 * 60 * 60 * 1000) : null; // +60 days
  };
  const now = new Date();

  const persistedInWarranty = (j) => {
    const o = origById(j.id) || j;
    if (isRecall(o.status)) return false; // ReCall is always active
    return isDone(o.status) && persistedFullyPaid(j) && warrantyStart(j) && now <= warrantyEnd(j);
  };
  const persistedInArchiveByWarranty = (j) => {
    const o = origById(j.id) || j;
    if (isRecall(o.status)) return false;
    return isDone(o.status) && persistedFullyPaid(j) && warrantyStart(j) && now > warrantyEnd(j);
  };

  /* ====== Save ====== */
  const handleSave = async (job) => {
    const { id } = job;

    const prev = origById(id) || {};
    const wasDone = isDone(prev.status);
    const willBeDone = isDone(job.status);

    const payload = {
      scf: job.scf !== '' && job.scf != null ? parseFloat(job.scf) : null,
      status: job.status ?? null,
      appointment_time: toISO(job.appointment_time),
      labor_price: job.labor_price !== '' && job.labor_price != null ? parseFloat(job.labor_price) : null,
      scf_payment_method: job.scf_payment_method ?? null,
      labor_payment_method: job.labor_payment_method ?? null,
      system_type: job.system_type ?? null,
      issue: job.issue ?? null,
    };

    // on transition to "completed" fix the timestamp
    if (!wasDone && willBeDone) {
      payload.completed_at = new Date().toISOString();
    }

    let { error } = await supabase.from('jobs').update(payload).eq('id', id);

    if (error && String(error.message || '').toLowerCase().includes('completed_at')) {
      const { completed_at, ...withoutCompleted } = payload;
      ({ error } = await supabase.from('jobs').update(withoutCompleted).eq('id', id));
    }

    if (error) {
      console.error('Save error (jobs):', error, payload);
      alert('Failed to save');
      return;
    }
    await fetchAll();
    alert('Saved');
  };

  const resetFilters = () => {
    setFilterStatus('all');
    setFilterTech('all');
    setFilterPaid('all');
    setSearchText('');
    setViewMode('active');
  };

  const handleExport = () => {
    const rows = filteredJobs.map((job) => {
      const client = getClient(job.client_id);
      const tech = technicians.find((t) => String(t.id) === String(job.technician_id));
      return {
        Job: job.job_number || job.id,
        Client: client?.name || client?.full_name || '',
        Phone: client?.phone || '',
        Address: formatAddress(client),
        SCF: job.scf,
        'SCF payment': job.scf_payment_method,
        Labor: job.labor_price,
        'Labor payment': job.labor_payment_method,
        Status: job.status,
        'Completed at': job.completed_at || '',
        Technician: tech?.name || '',
        System: job.system_type,
        Issue: job.issue,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jobs');
    XLSX.writeFile(wb, 'jobs.xlsx');
  };

  /* ====== Filter / group ====== */
  const filteredJobs = useMemo(() => {
    return (jobs || [])
      .filter((j) => {
        const o = origById(j.id) || j;
        const recall = isRecall(o.status);

        if (viewMode === 'warranty') {
          // Only warranty, exclude manually archived
          return !recall && !j.archived_at && persistedInWarranty(j);
        }

        if (viewMode === 'archive') {
          // Archive: manually archived OR expired warranty
          return j.archived_at || (!recall && persistedInArchiveByWarranty(j));
        }

        // active: everything NOT in warranty and NOT in archive, + ReCall; exclude manually archived
        return (recall || !(persistedInWarranty(j) || persistedInArchiveByWarranty(j))) && !j.archived_at;
      })
      .filter((j) =>
        filterStatus === 'all'
          ? true
          : filterStatus === 'ReCall'
          ? isRecall(j.status)
          : normalizeStatus(j.status) === normalizeStatus(filterStatus)
      )
      .filter((j) => filterTech === 'all' || String(j.technician_id) === String(filterTech))
      .filter((j) => {
        if (!searchText) return true;
        const c = getClient(j.client_id);
        const t = searchText.toLowerCase();
        const addr = formatAddress(c).toLowerCase();
        return (
          c?.name?.toLowerCase().includes(t) ||
          c?.full_name?.toLowerCase().includes(t) ||
          c?.phone?.toLowerCase().includes(t) ||
          addr.includes(t)
        );
      })
      .filter((j) => {
        if (filterPaid === 'paid') return isFullyPaidNow(j);
        if (filterPaid === 'unpaid') return isUnpaidNow(j);
        return true; // all
      })
      .sort((a, b) => {
        const A = (a.job_number || a.id).toString();
        const B = (b.job_number || b.id).toString();
        return sortAsc ? A.localeCompare(B) : B.localeCompare(A);
      });
  }, [
    jobs,
    technicians,
    clients,
    filterStatus,
    filterTech,
    filterPaid,
    searchText,
    sortAsc,
    viewMode,
    origJobs,
  ]);

  const grouped = useMemo(() => {
    const g = {};
    filteredJobs.forEach((j) => {
      const key = j.technician_id || 'No technician';
      if (!g[key]) g[key] = [];
      g[key].push(j);
    });
    return g;
  }, [filteredJobs]);

  return (
    <div className="p-4">
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table input, .jobs-table select, .jobs-table textarea { width:100%; height:28px; font-size:14px; padding:2px 6px; box-sizing:border-box; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .jobs-table .center { text-align:center; }
        .jobs-table tr.warranty { background:#dcfce7; }
        .jobs-table tr.unpaid { background:#fee2e2; }           /* 🔴 unpaid (only completed) */
        .jobs-table tr.unpaid:hover { background:#fecaca; }
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }
      `}</style>

      <h1 className="text-2xl font-bold mb-2">📋 All Jobs</h1>

      {/* Legend for the active list */}
      {viewMode === 'active' && (
        <div style={{ marginBottom: 8, color: '#6b7280', fontSize: 13 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, background: '#fee2e2', border: '1px solid #fca5a5' }} />
            <span>red — <b>COMPLETED</b> but <b>NOT PAID</b> (amounts &gt; 0 without a selected payment method)</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, background: '#dcfce7', border: '1px solid #86efac' }} />
            <span>green — jobs under 60-day warranty</span>
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="all">All technicians</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select value={filterPaid} onChange={(e) => setFilterPaid(e.target.value)}>
          <option value="all">All payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>

        <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
          <option value="active">Active</option>
          <option value="warranty">Warranty</option>
          <option value="archive">Archive</option>
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Name, phone or address"
        />
        <button onClick={resetFilters}>🔄 Reset</button>
        <button onClick={handleExport}>📤 Export to Excel</button>
        <button onClick={() => setSortAsc(!sortAsc)}>
          Sort by Job # {sortAsc ? '↑' : '↓'}
        </button>
      </div>

      {loading && <p>Loading...</p>}

      {Object.entries(grouped).map(([techId, groupJobs]) => (
        <div key={techId} className="mb-6">
          <h2 className="text-lg font-semibold mb-1">
            {techId === 'No technician'
              ? '🧾 No technician'
              : `👨‍🔧 ${technicians.find((t) => String(t.id) === String(techId))?.name || '—'}`}
          </h2>

          <div className="overflow-x-auto">
            <table className="jobs-table">
              <colgroup>
                <col style={{ width: 70 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 40 }} />
                <col style={{ width: 50 }} />
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
                  <th>Status</th>
                  <th className="center">✔</th>
                  <th className="center">💾</th>
                  <th className="center">✏️</th>
                  <th className="center">📄</th>
                </tr>
              </thead>

              <tbody>
                {groupJobs.map((job) => {
                  const client = getClient(job.client_id);

                  // 🔴 highlight in red ONLY if completed AND unpaid
                  const rowClass = job.archived_at
                    ? '' // manually archived is only visible in "Archive", don't color it red
                    : (persistedInWarranty(job)
                        ? 'warranty'
                        : (isDone(job.status) && isUnpaidNow(job))
                        ? 'unpaid'
                        : '');

                  const scfError = needsScfPayment(job);
                  const laborError = needsLaborPayment(job);

                  return (
                    <tr
                      key={job.id}
                      className={rowClass}
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
                      title="Open job editor"
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
                        <div className="cell-wrap">{client?.full_name || client?.name || '—'}</div>
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
                          value={job.scf_payment_method || ''} // SCF
                          onChange={(e) =>
                            handleChange(job.id, 'scf_payment_method', e.target.value || null)
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">—</option>
                          <option value="cash">cash</option>
                          <option value="zelle">Zelle</option>
                          <option value="card">card</option>
                          <option value="check">check</option>
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
                          onChange={(e) =>
                            handleChange(job.id, 'labor_payment_method', e.target.value || null)
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">—</option>
                          <option value="cash">cash</option>
                          <option value="zelle">Zelle</option>
                          <option value="card">card</option>
                          <option value="check">check</option>
                          <option value="-">-</option>
                        </select>
                      </td>

                      <td>
                        <select
                          value={job.status || ''}
                          onChange={(e) => handleChange(job.id, 'status', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">—</option>
                          {statuses.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="center">{isFullyPaidNow(job) ? '✔️' : ''}</td>

                      <td className="center">
                        <button
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
                          title="Edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/job/${job.id}`);
                          }}
                        >
                          ✏️
                        </button>
                      </td>
                      <td className="center">
                        <button
                          title="Invoice"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/invoice/${job.id}`);
                          }}
                        >
                          📄
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

export default JoAllJobsPage;

