// client/src/pages/DebtorsPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function DebtorsPage() {
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]);

  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);

  const [loading, setLoading] = useState(true);

  // filters
  const [filterTech, setFilterTech] = useState('all');
  const [searchText, setSearchText] = useState('');

  // autosave jobs
  const saveTimersRef = useRef(new Map()); // jobId -> timerId
  const [savingById, setSavingById] = useState({}); // jobId -> bool
  const [errorById, setErrorById] = useState({}); // jobId -> string
  const [keepVisibleById, setKeepVisibleById] = useState({}); // keep row visible until save completes

  // autosave clients (blacklist)
  const clientSaveTimersRef = useRef(new Map()); // clientId -> timerId
  const [savingClientById, setSavingClientById] = useState({}); // clientId -> bool
  const [errorClientById, setErrorClientById] = useState({}); // clientId -> string

  useEffect(() => {
    fetchAll();
    return () => {
      for (const t of saveTimersRef.current.values()) clearTimeout(t);
      saveTimersRef.current.clear();

      for (const t of clientSaveTimersRef.current.values()) clearTimeout(t);
      clientSaveTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    setLoading(true);

    const [jobsRes, clientsRes, techRes] = await Promise.all([
      // include archived too (unpaid can be archived by old logic)
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),

      // blacklist хранится в clients
      supabase.from('clients').select('*').order('created_at', { ascending: false }),

      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
    ]);

    setJobs(jobsRes.data || []);
    setOrigJobs(jobsRes.data || []);

    setClients(clientsRes.data || []);
    setTechnicians(techRes.data || []);

    setLoading(false);
  };

  const getClient = useCallback(
    (id) => (clients || []).find((c) => String(c.id) === String(id)) || null,
    [clients]
  );

  const getTechName = useCallback(
    (id) =>
      (technicians || []).find((t) => String(t.id) === String(id))?.name ||
      (id ? '—' : 'No technician'),
    [technicians]
  );

  const updateLocalJob = (id, patch) => {
    setJobs((prev) => prev.map((j) => (String(j.id) === String(id) ? { ...j, ...patch } : j)));
  };

  const updateLocalClient = (clientId, patch) => {
    setClients((prev) =>
      (prev || []).map((c) => (String(c.id) === String(clientId) ? { ...c, ...patch } : c))
    );
  };

  const toISO = (val) => {
    if (!val) return null;
    if (typeof val === 'string' && val.includes('T') && val.length >= 16) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return val;
  };

  const scheduleAutosave = (jobId, reason = 'change') => {
    const old = saveTimersRef.current.get(jobId);
    if (old) clearTimeout(old);

    // keep visible even if it becomes "paid" until save completes
    setKeepVisibleById((p) => ({ ...p, [jobId]: true }));

    const t = setTimeout(() => {
      doSave(jobId, reason);
    }, 650);

    saveTimersRef.current.set(jobId, t);
  };

  const doSave = async (jobId, reason = 'autosave') => {
    const job = (jobs || []).find((j) => String(j.id) === String(jobId));
    if (!job) return;

    setSavingById((p) => ({ ...p, [jobId]: true }));
    setErrorById((p) => ({ ...p, [jobId]: '' }));

    const prev = origById(jobId, origJobs) || {};
    const wasDone = isDone(prev.status);
    const willBeDone = isDone(job.status);

    const payload = {
      scf: job.scf !== '' && job.scf != null ? parseFloat(job.scf) : null,
      labor_price:
        job.labor_price !== '' && job.labor_price != null
          ? parseFloat(job.labor_price)
          : null,

      scf_payment_method: job.scf_payment_method ?? null,
      labor_payment_method: job.labor_payment_method ?? null,

      status: job.status ?? null,
      technician_id: job.technician_id ?? null,
      appointment_time: toISO(job.appointment_time),

      issue: job.issue ?? null,
      system_type: job.system_type ?? null,
    };

    if (!wasDone && willBeDone) {
      payload.completed_at = new Date().toISOString();
    }

    let { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
    if (error && String(error.message || '').toLowerCase().includes('completed_at')) {
      const { completed_at, ...rest } = payload;
      ({ error } = await supabase.from('jobs').update(rest).eq('id', jobId));
    }

    if (error) {
      console.error('Autosave error:', reason, error, payload);
      setErrorById((p) => ({
        ...p,
        [jobId]: (error?.message || 'Failed to save').toString(),
      }));
      setSavingById((p) => ({ ...p, [jobId]: false }));
      return;
    }

    // update local "orig"
    setOrigJobs((prevOrig) =>
      prevOrig.map((x) => (String(x.id) === String(jobId) ? { ...x, ...payload } : x))
    );

    setSavingById((p) => ({ ...p, [jobId]: false }));
    setKeepVisibleById((p) => ({ ...p, [jobId]: false }));

    await fetchAll();
  };

  /* ====== BLACKLIST: autosave clients ====== */

  const scheduleClientAutosave = (clientId, reason = 'blacklist-change') => {
    const old = clientSaveTimersRef.current.get(clientId);
    if (old) clearTimeout(old);

    const t = setTimeout(() => {
      doClientSave(clientId, reason);
    }, 650);

    clientSaveTimersRef.current.set(clientId, t);
  };

  const doClientSave = async (clientId, reason = 'blacklist-autosave') => {
    const c = (clients || []).find((x) => String(x.id) === String(clientId));
    if (!c) return;

    setSavingClientById((p) => ({ ...p, [clientId]: true }));
    setErrorClientById((p) => ({ ...p, [clientId]: '' }));

    // хранение: любой текст = blacklisted, пусто = не в blacklist
    const raw = c.blacklist;
    const nextVal = String(raw ?? '').trim();
    const payload = { blacklist: nextVal ? nextVal : null };

    const { error } = await supabase.from('clients').update(payload).eq('id', clientId);

    if (error) {
      console.error('Client autosave error:', reason, error, payload);
      setErrorClientById((p) => ({
        ...p,
        [clientId]: (error?.message || 'Failed to save').toString(),
      }));
      setSavingClientById((p) => ({ ...p, [clientId]: false }));
      return;
    }

    setSavingClientById((p) => ({ ...p, [clientId]: false }));
    // можно без fetchAll, но оставлю лёгкий refresh, чтобы всё было точно консистентно
    await fetchAll();
  };

  // Completed + unpaid
  const debtors = useMemo(() => {
    const txt = searchText.trim().toLowerCase();

    return (jobs || [])
      .filter((j) => isDone(j.status))
      .filter((j) => isUnpaid(j))
      .filter((j) =>
        filterTech === 'all' ? true : String(j.technician_id) === String(filterTech)
      )
      .filter((j) => {
        if (!txt) return true;
        const c = getClient(j.client_id);
        const addr = formatAddress(c).toLowerCase();
        const company = (c?.company || '').toLowerCase();
        const name = (c?.full_name || c?.name || '').toLowerCase();
        const phone = (c?.phone || '').toLowerCase();
        const jobNo = String(j.job_number || '').toLowerCase();
        return (
          company.includes(txt) ||
          name.includes(txt) ||
          phone.includes(txt) ||
          addr.includes(txt) ||
          jobNo.includes(txt)
        );
      })
      .sort((a, b) => {
        const A = Number(a.job_number || 0);
        const B = Number(b.job_number || 0);
        if (A && B) return B - A;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
  }, [jobs, filterTech, searchText, getClient]);

  // keep rows visible until save completes
  const visibleDebtors = useMemo(() => {
    const base = new Map(debtors.map((j) => [String(j.id), j]));
    for (const [id, keep] of Object.entries(keepVisibleById || {})) {
      if (!keep) continue;
      const j = (jobs || []).find((x) => String(x.id) === String(id));
      if (j && isDone(j.status)) base.set(String(j.id), j);
    }
    return Array.from(base.values());
  }, [debtors, keepVisibleById, jobs]);

  // group by technician
  const grouped = useMemo(() => {
    const g = {};
    for (const j of visibleDebtors) {
      const key = j.technician_id ? String(j.technician_id) : 'No technician';
      if (!g[key]) g[key] = [];
      g[key].push(j);
    }
    return g;
  }, [visibleDebtors]);

  const grandTotal = useMemo(() => {
    let s = 0;
    for (const j of visibleDebtors) s += debtAmount(j);
    return s;
  }, [visibleDebtors]);

  const paymentOptions = useMemo(
    () => [
      { v: '', label: '—' },
      { v: 'cash', label: 'cash' },
      { v: 'zelle', label: 'Zelle' },
      { v: 'card', label: 'card' },
      { v: 'check', label: 'check' },
      { v: 'ACH', label: 'ACH' },
      { v: '-', label: '-' },
    ],
    []
  );

  return (
    <div className="p-4">
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table input, .jobs-table select { width:100%; height:28px; font-size:14px; padding:2px 6px; box-sizing:border-box; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .jobs-table tr.debtor { background:#fee2e2; }
        .jobs-table tr.debtor:hover { background:#fecaca; }
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }

        .filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; align-items:center; }
        .badge {
          display:inline-flex; align-items:center; gap:8px;
          padding:4px 10px; border-radius:999px;
          font-size:12px; font-weight:800;
          background:#0f172a; color:#fff;
        }
        .err { color:#b91c1c; font-size:12px; margin-top:4px; }

        .bl-wrap { display:flex; flex-direction:column; gap:6px; }
        .bl-row { display:flex; gap:6px; align-items:center; }
        .bl-input { width:100%; height:28px; font-size:13px; padding:2px 6px; box-sizing:border-box; }
        .bl-btn {
          height:28px; padding:0 10px; border-radius:8px;
          border:1px solid #e5e7eb; background:#fff; cursor:pointer;
          font-weight:700; font-size:12px;
        }
        .bl-btn:hover { background:#f3f4f6; }
        .bl-pill {
          display:inline-flex; align-items:center; gap:6px;
          padding:4px 10px; border-radius:999px;
          font-size:12px; font-weight:900;
          background:#111827; color:#fff;
          border: 1px solid rgba(255,255,255,0.12);
          white-space:nowrap;
          max-width: 100%;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .bl-pill--yes { background:#7f1d1d; border-color: rgba(255,255,255,0.18); }
        .bl-pill--no { background:#0f172a; }
        .mini { font-size:11px; color:#6b7280; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h1 className="text-2xl font-bold">💸 Должники (Unpaid)</h1>
        <span className="badge" title="Completed + unpaid (по типу оплаты)">
          <span>{visibleDebtors.length}</span>
          <span style={{ opacity: 0.85 }}>jobs</span>
          <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.25)' }} />
          <span style={{ opacity: 0.85 }}>Total:</span>
          <span style={{ fontWeight: 900 }}>{money(grandTotal)}</span>
        </span>
      </div>

      <div className="filters">
        <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="all">All technicians</option>
          {(technicians || []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Company, name, phone, address or Job #"
          style={{ width: 360 }}
        />

        <button onClick={fetchAll}>🔄 Refresh</button>
      </div>

      {loading && <p>Loading...</p>}

      {!loading && visibleDebtors.length === 0 && (
        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}>
          Нет должников по текущей логике. (Completed + unpaid)
        </div>
      )}

      {!loading &&
        Object.entries(grouped)
          .sort(([a], [b]) => {
            if (a === 'No technician') return 1;
            if (b === 'No technician') return -1;
            const an = getTechName(a);
            const bn = getTechName(b);
            return an.localeCompare(bn);
          })
          .map(([techId, list]) => {
            const title =
              techId === 'No technician' ? '🧾 No technician' : `👨‍🔧 ${getTechName(techId)}`;

            return (
              <div key={techId} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 18, fontWeight: 900, margin: '14px 0 8px' }}>{title}</div>

                <div className="overflow-x-auto">
                  <table className="jobs-table">
                    <colgroup>
                      <col style={{ width: 70 }} />
                      <col style={{ width: 240 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 260 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 260 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 230 }} />
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
                        <th>Blacklist</th>
                      </tr>
                    </thead>

                    <tbody>
                      {list.map((job) => {
                        const client = getClient(job.client_id);

                        const scfErr = needsScfPayment(job);
                        const laborErr = needsLaborPayment(job);

                        const err = errorById[job.id] || '';

                        const blVal = client?.blacklist;
                        const isBl = !!(blVal && String(blVal).trim() !== '');

                        const clientErr = client ? errorClientById[client.id] || '' : '';
                        const clientSaving = client ? !!savingClientById[client.id] : false;

                        return (
                          <tr
                            key={job.id}
                            className="debtor"
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
                                {job.archived_at && (
                                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                    archived
                                  </div>
                                )}
                                {err ? <div className="err">⚠ {err}</div> : null}
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
                                  <div style={{ fontWeight: 700 }}>
                                    {client?.full_name || client?.name || '—'}
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
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, { scf: e.target.value });
                                  scheduleAutosave(job.id, 'scf');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'scf-blur')}
                              />
                            </td>

                            <td>
                              <select
                                className={scfErr ? 'error' : ''}
                                value={job.scf_payment_method || ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, {
                                    scf_payment_method: e.target.value || null,
                                  });
                                  scheduleAutosave(job.id, 'scf_payment_method');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'scf_payment_method-blur')}
                              >
                                {paymentOptions.map((o) => (
                                  <option key={o.v || 'empty'} value={o.v}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td>
                              <input
                                type="number"
                                value={job.labor_price || ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, { labor_price: e.target.value });
                                  scheduleAutosave(job.id, 'labor_price');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'labor_price-blur')}
                              />
                            </td>

                            <td>
                              <select
                                className={laborErr ? 'error' : ''}
                                value={job.labor_payment_method || ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, {
                                    labor_payment_method: e.target.value || null,
                                  });
                                  scheduleAutosave(job.id, 'labor_payment_method');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'labor_payment_method-blur')}
                              >
                                {paymentOptions.map((o) => (
                                  <option key={o.v || 'empty'} value={o.v}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* ===== LIVE BLACKLIST ===== */}
                            <td onClick={(e) => e.stopPropagation()}>
                              {!client ? (
                                <span className="bl-pill bl-pill--no">—</span>
                              ) : (
                                <div className="bl-wrap">
                                  <span
                                    className={`bl-pill ${isBl ? 'bl-pill--yes' : 'bl-pill--no'}`}
                                    title={isBl ? `Blacklisted: ${String(blVal)}` : 'Not blacklisted'}
                                  >
                                    {isBl ? `⛔ ${String(blVal)}` : '—'}
                                  </span>

                                  <div className="bl-row">
                                    <input
                                      className="bl-input"
                                      value={client.blacklist || ''}
                                      placeholder="Blacklist reason (type to save)"
                                      onChange={(e) => {
                                        updateLocalClient(client.id, { blacklist: e.target.value });
                                        scheduleClientAutosave(client.id, 'blacklist');
                                      }}
                                      onBlur={() => doClientSave(client.id, 'blacklist-blur')}
                                    />
                                    <button
                                      className="bl-btn"
                                      title="Clear blacklist"
                                      onClick={() => {
                                        updateLocalClient(client.id, { blacklist: '' });
                                        scheduleClientAutosave(client.id, 'blacklist-clear');
                                        // быстро сохраняем без ожидания blur
                                        doClientSave(client.id, 'blacklist-clear-now');
                                      }}
                                    >
                                      Clear
                                    </button>
                                  </div>

                                  <div className="mini">
                                    {clientSaving ? 'Saving…' : ''}
                                    {clientErr ? <span style={{ color: '#b91c1c' }}>⚠ {clientErr}</span> : ''}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                    Логика: должники = <b>Completed</b> + не выбран тип оплаты (SCF/Labor).
                    Как только ты выбрал тип оплаты — строка исчезнет <b>после успешного автосохранения</b>.
                  </div>
                </div>
              </div>
            );
          })}
    </div>
  );
}

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

function methodChosen(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
}

function needsScfPayment(j) {
  return Number(j.scf || 0) > 0 && !methodChosen(j.scf_payment_method);
}

function needsLaborPayment(j) {
  return Number(j.labor_price || 0) > 0 && !methodChosen(j.labor_payment_method);
}

function isUnpaid(j) {
  // unpaid if ANY required payment method missing
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  const scfNeeded = scf > 0;
  const laborNeeded = labor > 0;

  const scfOK = !scfNeeded || methodChosen(j.scf_payment_method);
  const laborOK = !laborNeeded || methodChosen(j.labor_payment_method);

  return !(scfOK && laborOK);
}

function debtAmount(j) {
  // kept for header total only
  let s = 0;
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  if (scf > 0 && !methodChosen(j.scf_payment_method)) s += scf;
  if (labor > 0 && !methodChosen(j.labor_payment_method)) s += labor;

  return s;
}

function origById(id, origJobs) {
  return (origJobs || []).find((x) => String(x.id) === String(id)) || null;
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

function money(n) {
  const x = Number(n || 0);
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
