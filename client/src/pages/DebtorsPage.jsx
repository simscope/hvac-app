// client/src/pages/DebtorsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function DebtorsPage() {
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);

  // для автосохранения (debounce по job id)
  const timersRef = useRef(new Map());
  const savingRef = useRef(new Set()); // id которые сейчас сохраняются (чтобы не исчезали мгновенно)
  const [, forceTick] = useState(0);

  // модалка blacklist
  const [blOpen, setBlOpen] = useState(false);
  const [blClient, setBlClient] = useState(null); // {id, full_name/name, company, blacklist}
  const [blText, setBlText] = useState('');
  const [blSaving, setBlSaving] = useState(false);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    setLoading(true);

    const [jobsRes, clientsRes, techRes] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('clients').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
    ]);

    setJobs(jobsRes.data || []);
    setClients(clientsRes.data || []);
    setTechnicians(techRes.data || []);
    setLoading(false);
  };

  const clientById = useMemo(() => {
    const m = new Map();
    for (const c of clients || []) m.set(c.id, c);
    return m;
  }, [clients]);

  const techById = useMemo(() => {
    const m = new Map();
    for (const t of technicians || []) m.set(String(t.id), t);
    return m;
  }, [technicians]);

  // ======= ЛОГИКА ДОЛГА =======
  // долг = scf>0 и не выбран метод оплаты ИЛИ labor>0 и не выбран метод оплаты
  const debtOfJob = (j) => {
    const scf = num(j.scf);
    const labor = num(j.labor_price);
    const scfUnpaid = scf > 0 && !methodChosen(j.scf_payment_method);
    const laborUnpaid = labor > 0 && !methodChosen(j.labor_payment_method);
    return (scfUnpaid ? scf : 0) + (laborUnpaid ? labor : 0);
  };

  const isJobUnpaid = (j) => debtOfJob(j) > 0;

  // если job сейчас сохраняется — не убираем из списка до результата
  const isSaving = (id) => savingRef.current.has(id);

  const unpaidJobs = useMemo(() => {
    return (jobs || []).filter((j) => isJobUnpaid(j) || isSaving(j.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, /* tick */ savingRef.current.size]);

  // группировка по технику + сумма
  const grouped = useMemo(() => {
    const g = {};
    for (const j of unpaidJobs) {
      const key = j.technician_id ? String(j.technician_id) : 'No technician';
      if (!g[key]) g[key] = { jobs: [], total: 0 };
      g[key].jobs.push(j);
      g[key].total += debtOfJob(j);
    }
    // сортируем внутри
    for (const k of Object.keys(g)) {
      g[k].jobs.sort((a, b) => String(a.job_number || '').localeCompare(String(b.job_number || ''), undefined, { numeric: true }));
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpaidJobs, clients]);

  // ======= Автосохранение оплаты =======
  const updateJobLocal = (id, patch) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  };

  const scheduleAutoSave = (jobId) => {
    // debounce 500ms
    const prev = timersRef.current.get(jobId);
    if (prev) clearTimeout(prev);

    const t = setTimeout(async () => {
      timersRef.current.delete(jobId);
      const job = (jobs || []).find((x) => x.id === jobId);
      if (!job) return;

      savingRef.current.add(jobId);
      forceTick((x) => x + 1);

      const payload = {
        scf_payment_method: normPay(job.scf_payment_method),
        labor_payment_method: normPay(job.labor_payment_method),
        // если нужно — можно сюда же scf / labor_price добавить, но сейчас правим только оплату
      };

      const { error } = await supabase.from('jobs').update(payload).eq('id', jobId);

      savingRef.current.delete(jobId);
      forceTick((x) => x + 1);

      if (error) {
        console.error('Auto-save payment error:', error);
        alert('Не удалось сохранить оплату');
        return;
      }

      // перезагрузим данные, чтобы гарантированно обновилось + строка исчезла если оплачена
      await fetchAll();
    }, 500);

    timersRef.current.set(jobId, t);
  };

  // ======= BLACKLIST MODAL =======
  const openBlacklist = (client) => {
    if (!client) return;
    setBlClient(client);
    setBlText(client.blacklist || '');
    setBlOpen(true);
  };

  const saveBlacklist = async () => {
    if (!blClient?.id) return;
    setBlSaving(true);

    const payload = { blacklist: (blText || '').trim() || null };
    const { error } = await supabase.from('clients').update(payload).eq('id', blClient.id);

    setBlSaving(false);

    if (error) {
      console.error('Save blacklist error:', error);
      alert('Не удалось сохранить blacklist');
      return;
    }

    // локально обновим клиентов (чтобы сразу отобразилось)
    setClients((prev) =>
      prev.map((c) => (c.id === blClient.id ? { ...c, blacklist: payload.blacklist } : c))
    );
    setBlOpen(false);
    setBlClient(null);
    setBlText('');
  };

  return (
    <div className="p-4">
      <style>{`
        .wrap { max-width: 1400px; margin: 0 auto; }
        .h1 { font-size: 24px; font-weight: 800; margin-bottom: 10px; }
        .hint { color:#6b7280; font-size: 13px; margin-bottom: 14px; }
        .section { margin-bottom: 18px; }
        .secTitle { display:flex; align-items:center; justify-content:space-between; gap:10px; margin: 14px 0 8px; }
        .secTitle h2 { font-size: 16px; font-weight: 800; margin:0; }
        .secTitle .sum { font-weight: 800; color:#111827; background:#f3f4f6; border:1px solid #e5e7eb; padding:6px 10px; border-radius: 10px; }
        .table { width:100%; border-collapse: collapse; table-layout: fixed; }
        .table th, .table td { border:1px solid #e5e7eb; padding:8px; vertical-align: top; }
        .table th { background:#f9fafb; text-align:left; font-weight:700; }
        .cell { white-space: normal; word-break: break-word; line-height:1.2; }
        .num { color:#2563eb; text-decoration: underline; cursor:pointer; font-weight: 700; }
        select { width: 100%; height: 32px; border:1px solid #d1d5db; border-radius: 8px; padding: 4px 8px; background:#fff; }
        .debt { font-weight: 900; }
        .row { background: #fff; }
        .row:hover { background: #f8fafc; }
        .badgeSaving { font-size: 11px; color:#6b7280; margin-left: 6px; }
        .black { cursor:pointer; color:#111827; }
        .black .tag {
          display:inline-flex; align-items:center; gap:6px;
          padding: 4px 8px; border-radius: 999px;
          border: 1px solid #e5e7eb; background: #fff;
          font-size: 12px; font-weight: 700;
        }
        .black .tag.on { border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.08); }
        .black .sub { display:block; margin-top: 4px; font-size: 12px; color:#6b7280; }

        /* modal */
        .modalOverlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.45);
          display:flex; align-items:center; justify-content:center;
          z-index: 999;
        }
        .modal {
          width: min(720px, calc(100vw - 24px));
          background:#fff; border-radius: 14px;
          box-shadow: 0 20px 60px rgba(0,0,0,.25);
          overflow:hidden;
        }
        .modalHead {
          padding: 12px 14px; border-bottom:1px solid #e5e7eb;
          display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
        }
        .modalHead .ttl { font-weight: 900; font-size: 16px; }
        .modalHead .meta { color:#6b7280; font-size: 12px; margin-top: 2px; }
        .modalBody { padding: 12px 14px; }
        .modalBody textarea {
          width: 100%;
          min-height: 140px;
          resize: vertical;
          border:1px solid #d1d5db;
          border-radius: 12px;
          padding: 10px;
          font-size: 14px;
          outline: none;
        }
        .modalFoot {
          padding: 12px 14px; border-top:1px solid #e5e7eb;
          display:flex; justify-content:flex-end; gap:10px;
        }
        .btn {
          height: 36px; border-radius: 10px; padding: 0 12px;
          border: 1px solid #e5e7eb; background:#fff; cursor:pointer; font-weight: 800;
        }
        .btn.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
        .btn:disabled { opacity:.6; cursor:not-allowed; }
      `}</style>

      <div className="wrap">
        <div className="h1">💰 Должники</div>
        <div className="hint">
          Тут показываются <b>все неоплаченные</b> заявки (даже если они уже в архиве).
          Неоплаченные = <b>не выбран тип оплаты</b> при сумме &gt; 0. Оплата сохраняется <b>автоматически</b>.
        </div>

        {loading && <div>Loading...</div>}

        {!loading && Object.keys(grouped).length === 0 && (
          <div style={{ padding: 14, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
            Нет неоплаченных заявок ✅
          </div>
        )}

        {!loading &&
          Object.entries(grouped).map(([techId, block]) => {
            const techName =
              techId === 'No technician'
                ? '🧾 Без техника'
                : `👨‍🔧 ${techById.get(String(techId))?.name || '—'}`;

            return (
              <div className="section" key={techId}>
                <div className="secTitle">
                  <h2>
                    {techName}
                  </h2>
                  <div className="sum">Итого долг: {money(block.total)}</div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <colgroup>
                      <col style={{ width: 90 }} />
                      <col style={{ width: 240 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 260 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 220 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Job #</th>
                        <th>Client</th>
                        <th>Phone</th>
                        <th>Address</th>
                        <th>Debt</th>
                        <th>System</th>
                        <th>SCF payment</th>
                        <th>Labor payment</th>
                        <th>Blacklist</th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.jobs.map((job) => {
                        const c = clientById.get(job.client_id);
                        const debt = debtOfJob(job);

                        return (
                          <tr className="row" key={job.id}>
                            <td>
                              <div
                                className="num"
                                onClick={() => navigate(`/job/${job.id}`)}
                                title="Открыть заявку"
                              >
                                {job.job_number || '—'}
                              </div>
                              {isSaving(job.id) && <span className="badgeSaving">saving...</span>}
                            </td>

                            <td>
                              <div className="cell">
                                {c?.company ? (
                                  <>
                                    <div style={{ fontWeight: 800 }}>{c.company}</div>
                                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                                      {c.full_name || c.name || '—'}
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ fontWeight: 800 }}>{c?.full_name || c?.name || '—'}</div>
                                )}
                              </div>
                            </td>

                            <td>
                              <div className="cell">{c?.phone || '—'}</div>
                            </td>

                            <td>
                              <div className="cell">{formatAddress(c) || '—'}</div>
                            </td>

                            <td>
                              <div className="cell debt">{money(debt)}</div>
                              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                                {needsScfPayment(job) ? `SCF: ${money(num(job.scf))}` : ''}
                                {needsScfPayment(job) && needsLaborPayment(job) ? ' • ' : ''}
                                {needsLaborPayment(job) ? `Labor: ${money(num(job.labor_price))}` : ''}
                              </div>
                            </td>

                            <td>
                              <div className="cell">{job.system_type || '—'}</div>
                            </td>

                            <td>
                              <select
                                value={job.scf_payment_method || ''}
                                onChange={(e) => {
                                  updateJobLocal(job.id, { scf_payment_method: e.target.value || null });
                                  scheduleAutoSave(job.id);
                                }}
                                title="Оплата SCF (если пусто — не оплачено)"
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
                              <select
                                value={job.labor_payment_method || ''}
                                onChange={(e) => {
                                  updateJobLocal(job.id, { labor_payment_method: e.target.value || null });
                                  scheduleAutoSave(job.id);
                                }}
                                title="Оплата Labor (если пусто — не оплачено)"
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
                              <div
                                className="black"
                                onClick={() => openBlacklist(c)}
                                title="Открыть/изменить причину blacklist"
                              >
                                <span className={`tag ${c?.blacklist ? 'on' : ''}`}>
                                  {c?.blacklist ? 'BLACKLIST' : '—'}
                                </span>
                                {c?.blacklist && <span className="sub">{truncate(c.blacklist, 70)}</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

        {/* ===== MODAL: Blacklist ===== */}
        {blOpen && (
          <div
            className="modalOverlay"
            onMouseDown={(e) => {
              // клик по фону закрывает
              if (e.target.classList.contains('modalOverlay')) {
                setBlOpen(false);
                setBlClient(null);
                setBlText('');
              }
            }}
          >
            <div className="modal" role="dialog" aria-modal="true">
              <div className="modalHead">
                <div>
                  <div className="ttl">Blacklist: причина</div>
                  <div className="meta">
                    {(blClient?.company ? `${blClient.company} — ` : '')}
                    {(blClient?.full_name || blClient?.name || '—')}
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setBlOpen(false);
                    setBlClient(null);
                    setBlText('');
                  }}
                >
                  ✕
                </button>
              </div>

              <div className="modalBody">
                <textarea
                  value={blText}
                  onChange={(e) => setBlText(e.target.value)}
                  placeholder="Например: не оплатил SCF, хамил, отменял в последний момент..."
                />
              </div>

              <div className="modalFoot">
                <button
                  className="btn"
                  onClick={() => {
                    setBlOpen(false);
                    setBlClient(null);
                    setBlText('');
                  }}
                  disabled={blSaving}
                >
                  Cancel
                </button>
                <button className="btn primary" onClick={saveBlacklist} disabled={blSaving}>
                  {blSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== helpers ===== */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function methodChosen(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
}

function needsScfPayment(j) {
  return num(j.scf) > 0 && !methodChosen(j.scf_payment_method);
}

function needsLaborPayment(j) {
  return num(j.labor_price) > 0 && !methodChosen(j.labor_payment_method);
}

function normPay(v) {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

function money(v) {
  const n = num(v);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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

function truncate(s, max = 60) {
  const t = String(s || '');
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}
