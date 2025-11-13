// client/src/pages/AllJobsPage.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const AllJobsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]); // инвойсы из БД

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [filterPaid, setFilterPaid] = useState('all'); // all | paid | unpaid
  const [searchText, setSearchText] = useState('');
  const [invoiceQuery, setInvoiceQuery] = useState(''); // поиск по invoice_no / job_number
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('active'); // active | warranty | archive

  const [showInvoiceList, setShowInvoiceList] = useState(true);
  const invoiceBoxRef = useRef(null);
  const navigate = useNavigate();

  const statuses = [
    'ReCall',
    'Diagnosis',
    'In progress',
    'Parts ordered',
    'Waiting for parts',
    'To finish',
    'Completed',
  ];

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (invoiceBoxRef.current && !invoiceBoxRef.current.contains(e.target)) {
        setShowInvoiceList(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [jobsRes, techRes, clientsRes, invRes] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
      supabase.from('clients').select('*'),
      supabase.from('invoices').select('id, job_id, invoice_no, file_key, created_at'),
    ]);

    setJobs(jobsRes.data || []);
    setOrigJobs(jobsRes.data || []);
    setTechnicians(techRes.data || []);
    setClients(clientsRes.data || []);
    setInvoices(invRes.data || []);
    setLoading(false);
  };

  const getClient = (id) => clients.find((c) => c.id === id);

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

  /* ====== Save ====== */
  const handleSave = async (job) => {
    const prev = origById(job.id, origJobs) || {};
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

    if (!wasDone && willBeDone) {
      payload.completed_at = new Date().toISOString();
    }

    let { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
    if (error && String(error.message || '').toLowerCase().includes('completed_at')) {
      const { completed_at, ...rest } = payload;
      ({ error } = await supabase.from('jobs').update(rest).eq('id', job.id));
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
    setInvoiceQuery('');
    setViewMode('active');
    setShowInvoiceList(false);
  };

  /* ====== Maps: invoice by job_id и по номеру ====== */
  const invByJob = useMemo(() => {
    const m = new Map();
    for (const inv of invoices || []) {
      if (!inv.job_id) continue;
      const old = m.get(inv.job_id);
      if (!old || new Date(inv.created_at) > new Date(old.created_at)) {
        m.set(inv.job_id, inv);
      }
    }
    return m;
  }, [invoices]);

  const jobsById = useMemo(() => {
    const m = new Map();
    for (const j of jobs || []) m.set(j.id, j);
    return m;
  }, [jobs]);

  /* ====== Export ====== */
  const handleExport = () => {
    const rows = filteredJobs.map((job) => {
      const client = getClient(job.client_id);
      const tech = technicians.find((t) => String(t.id) === String(job.technician_id));
      const inv = invByJob.get(job.id);
      return {
        Job: job.job_number || job.id,
        Invoice: inv?.invoice_no ?? '',
        Company: client?.company || '',
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

  const now = new Date();

  /* ====== Filter / group ====== */
  const filteredJobs = useMemo(() => {
    return (jobs || [])
      .filter((j) => {
        const o = origById(j.id, origJobs) || j;
        const recall = isRecall(o.status);

        if (viewMode === 'warranty') {
          return !recall && !j.archived_at && persistedInWarranty(j, origJobs, now);
        }
        if (viewMode === 'archive') {
          return j.archived_at || (!recall && persistedInArchiveByWarranty(j, origJobs, now));
        }
        // active
        return (
          (recall || !(persistedInWarranty(j, origJobs, now) || persistedInArchiveByWarranty(j, origJobs, now))) &&
          !j.archived_at
        );
      })
      .filter((j) =>
        filterStatus === 'all'
          ? true
          : filterStatus === 'ReCall'
          ? isRecall(j.status)
          : canonStatus(j.status) === canonStatus(filterStatus),
      )
      .filter((j) => filterTech === 'all' || String(j.technician_id) === String(filterTech))
      // поиск по invoice_no / job_number
      .filter((j) => {
        const q = invoiceQuery.trim();
        if (!q) return true;
        const inv = invByJob.get(j.id);
        if (isDigits(q)) {
          const qn = Number(q);
          const jobNo = Number(j.job_number || NaN);
          return inv?.invoice_no === qn || jobNo === qn;
        }
        const ql = q.toLowerCase();
        const invTxt = inv?.invoice_no != null ? String(inv.invoice_no).toLowerCase() : '';
        const jobTxt = j.job_number != null ? String(j.job_number).toLowerCase() : '';
        return invTxt.includes(ql) || jobTxt.includes(ql);
      })
      // общий поиск по клиенту/адресу
      .filter((j) => {
        if (!searchText) return true;
        const c = getClient(j.client_id);
        const t = searchText.toLowerCase();
        const addr = formatAddress(c).toLowerCase();
        return (
          c?.company?.toLowerCase().includes(t) ||
          c?.name?.toLowerCase().includes(t) ||
          c?.full_name?.toLowerCase().includes(t) ||
          c?.phone?.toLowerCase().includes(t) ||
          addr.includes(t)
        );
      })
      .filter((j) => {
        if (filterPaid === 'paid') return isFullyPaidNow(j);
        if (filterPaid === 'unpaid') return isUnpaidNow(j);
        return true;
      })
      .sort((a, b) => {
        const A = (a.job_number || a.id).toString();
        const B = (b.job_number || b.id).toString();
        return sortAsc ? A.localeCompare(B) : B.localeCompare(A);
      });
  }, [jobs, origJobs, filterStatus, filterTech, filterPaid, searchText, invoiceQuery, sortAsc, viewMode, invByJob]);

  // Быстрые совпадения для выпадающего окна
  const invoiceMatches = useMemo(() => {
    const q = invoiceQuery.trim();
    if (!q) return [];
    const list = [];

    if (isDigits(q)) {
      const qn = Number(q);
      // точные совпадения по номеру инвойса
      for (const inv of invoices || []) {
        if (inv.invoice_no === qn) {
          const job = jobsById.get(inv.job_id);
          if (job) list.push({ job, inv });
        }
      }
      // точные совпадения по job_number
      for (const job of jobs || []) {
        const jobNo = Number(job.job_number || NaN);
        if (jobNo === qn) {
          list.push({ job, inv: invByJob.get(job.id) || null });
        }
      }
    } else {
      const ql = q.toLowerCase();
      for (const inv of invoices || []) {
        const invTxt = inv.invoice_no != null ? String(inv.invoice_no).toLowerCase() : '';
        if (invTxt.includes(ql)) {
          const job = jobsById.get(inv.job_id);
          if (job) list.push({ job, inv });
        }
      }
      for (const job of jobs || []) {
        const jobTxt = job.job_number != null ? String(job.job_number).toLowerCase() : '';
        if (jobTxt.includes(ql)) {
          list.push({ job, inv: invByJob.get(job.id) || null });
        }
      }
    }

    // убрать дубли
    const seen = new Set();
    const uniq = [];
    for (const item of list) {
      const key = `${item.job.id}:${item.inv?.id || 'noinv'}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(item);
      }
    }

    uniq.sort((a, b) => {
      const aKey = String(a.inv?.invoice_no ?? a.job.job_number ?? '');
      const bKey = String(b.inv?.invoice_no ?? b.job.job_number ?? '');
      return aKey.localeCompare(bKey, undefined, { numeric: true });
    });

    return uniq.slice(0, 10);
  }, [invoiceQuery, invoices, jobs, invByJob, jobsById]);

  const grouped = useMemo(() => {
    const g = {};
    filteredJobs.forEach((j) => {
      const key = j.technician_id || 'No technician';
      if (!g[key]) g[key] = [];
      g[key].push(j);
    });
    return g;
  }, [filteredJobs]);

  const openSingleMatchOnEnter = (e) => {
    if (e.key === 'Enter' && invoiceMatches.length > 0) {
      const { job, inv } = invoiceMatches[0];
      if (inv) navigate(`/invoice/${job.id}?invoice=${inv.id}`);
      else navigate(`/invoice/new?job=${job.id}`);
    }
  };

  const openInvoiceForJob = (job) => {
    const inv = invByJob.get(job.id);
    if (inv) navigate(`/invoice/${job.id}?invoice=${inv.id}`);
    else navigate(`/invoice/new?job=${job.id}`);
  };

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
        .jobs-table tr.unpaid { background:#fee2e2; }
        .jobs-table tr.unpaid:hover { background:#fecaca; }
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }

        .filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; align-items:center; }
        .inv-search-wrap { position: relative; display:inline-block; }
        .inv-dropdown {
          position: absolute;
          top: 34px;
          left: 0;
          z-index: 20;
          min-width: 520px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.08);
          max-height: 320px;
          overflow: auto;
        }
        .inv-item { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; display:flex; justify-content:space-between; gap:10px; align-items:center; }
        .inv-item:last-child { border-bottom: none; }
        .inv-item:hover { background:#f8fafc; }
        .inv-item .meta { font-size:12px; color:#6b7280; }
        .inv-actions { display:flex; gap:6px; }
        .btn-link { background:#2563eb; color:#fff; border:none; border-radius:6px; height:28px; padding:0 10px; cursor:pointer; }
        .btn-link.secondary { background:#0ea5e9; }
      `}</style>

      <h1 className="text-2xl font-bold mb-2">📋 All Jobs</h1>

      {viewMode === 'active' && (
        <div style={{ marginBottom: 8, color: '#6b7280', fontSize: 13 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: '#fee2e2',
                border: '1px solid #fca5a5',
              }}
            />
            <span>
              red — <b>COMPLETED</b> but <b>NOT PAID</b> (amounts &gt; 0 without a selected payment method)
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: '#dcfce7',
                border: '1px solid #86efac',
              }}
            />
            <span>green — jobs under 60-day warranty</span>
          </span>
        </div>
      )}

      <div className="filters">
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

        {/* Общий поиск */}
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Company, name, phone or address"
        />

        {/* Поиск по инвойсу/джобу */}
        <div className="inv-search-wrap" ref={invoiceBoxRef}>
          <input
            value={invoiceQuery}
            onChange={(e) => {
              setInvoiceQuery(e.target.value);
              setShowInvoiceList(true);
            }}
            onFocus={() => setShowInvoiceList(true)}
            onKeyDown={openSingleMatchOnEnter}
            placeholder="Invoice # or Job #"
            title="Введите номер инвойса или номер работы"
            style={{ width: 220 }}
          />
          {invoiceQuery && showInvoiceList && invoiceMatches.length > 0 && (
            <div className="inv-dropdown">
              {invoiceMatches.map(({ job, inv }) => {
                const client = getClient(job.client_id);
                return (
                  <div key={`${job.id}:${inv?.id || 'noinv'}`} className="inv-item">
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {inv ? `Invoice: ${inv.invoice_no}` : 'Invoice: —'} · Job: {job.job_number || job.id}
                      </div>
                      <div className="meta">
                        {client?.company ? `${client.company} — ` : ''}
                        {(client?.full_name || client?.name || '—')} • {job.status || '—'}
                      </div>
                    </div>
                    <div className="inv-actions">
                      <button className="btn-link" onClick={() => navigate(`/job/${job.id}`)}>
                        Открыть работу
                      </button>
                      <button
                        className="btn-link secondary"
                        onClick={() =>
                          inv
                            ? navigate(`/invoice/${job.id}?invoice=${inv.id}`)
                            : navigate(`/invoice/new?job=${job.id}`)
                        }
                      >
                        {inv ? 'Инвойс' : 'Создать'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
                <col style={{ width: 220 }} />
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
                  const rowClass = job.archived_at
                    ? ''
                    : persistedInWarranty(job, origJobs, now)
                    ? 'warranty'
                    : isDone(job.status) && isUnpaidNow(job)
                    ? 'unpaid'
                    : '';
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
                        <div className="cell-wrap">
                          {client?.company ? (
                            <>
                              <div style={{ fontWeight: 600 }}>{client.company}</div>
                              <div style={{ color: '#6b7280', fontSize: 12 }}>
                                {client.full_name || client.name || '—'}
                              </div>
                            </>
                          ) : (
                            <div>{client?.full_name || client?.name || '—'}</div>
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
                            openInvoiceForJob(job);
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

export default AllJobsPage;

/* ====== helpers outside component ====== */

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
  if (v === 'canceled' || v === 'cancelled') return 'canceled';
  if (
    [
      'recall',
      'diagnosis',
      'in progress',
      'parts ordered',
      'waiting for parts',
      'to finish',
      'completed',
      'canceled',
    ].includes(raw)
  )
    return raw;
  return v;
}

function isDone(status) {
  return canonStatus(status) === 'completed';
}

function isRecall(status) {
  return canonStatus(status) === 'recall';
}

function methodChosen(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
}

function isFullyPaidNow(j) {
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);
  const scfOK = scf <= 0 || (scf > 0 && methodChosen(j.scf_payment_method));
  const laborOK = labor <= 0 || (labor > 0 && methodChosen(j.labor_payment_method));
  return scfOK && laborOK;
}

function isUnpaidNow(j) {
  return !isFullyPaidNow(j);
}

function needsScfPayment(j) {
  return Number(j.scf || 0) > 0 && !methodChosen(j.scf_payment_method);
}

function needsLaborPayment(j) {
  return Number(j.labor_price || 0) > 0 && !methodChosen(j.labor_payment_method);
}

function origById(id, origJobs) {
  return origJobs.find((x) => x.id === id) || null;
}

function persistedFullyPaid(j, origJobs) {
  const o = origById(j.id, origJobs) || j;
  const scfOK = Number(o.scf || 0) <= 0 || methodChosen(o.scf_payment_method);
  const laborOK = Number(o.labor_price || 0) <= 0 || methodChosen(o.labor_payment_method);
  return scfOK && laborOK;
}

function warrantyStart(j, origJobs) {
  const o = origById(j.id, origJobs) || j;
  if (o.completed_at) return new Date(o.completed_at);
  if (isDone(o.status) && o.updated_at) return new Date(o.updated_at);
  return null;
}

function warrantyEnd(j, origJobs) {
  const s = warrantyStart(j, origJobs);
  return s ? new Date(s.getTime() + 60 * 24 * 60 * 60 * 1000) : null; // +60 дней
}

function persistedInWarranty(j, origJobs, now) {
  const o = origById(j.id, origJobs) || j;
  if (isRecall(o.status)) return false;
  return isDone(o.status) && persistedFullyPaid(j, origJobs) && warrantyStart(j, origJobs) && now <= warrantyEnd(j, origJobs);
}

function persistedInArchiveByWarranty(j, origJobs, now) {
  const o = origById(j.id, origJobs) || j;
  if (isRecall(o.status)) return false;
  return isDone(o.status) && persistedFullyPaid(j, origJobs) && warrantyStart(j, origJobs) && now > warrantyEnd(j, origJobs);
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

function isDigits(s) {
  return /^\d+$/.test(String(s).trim());
}
