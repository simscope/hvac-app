// client/src/pages/MaterialsPage.jsx
// Materials table + inline status/technician editing, modal to add/edit materials
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

/* ---------- Canonical statuses ---------- */
const CANON = {
  RECALL: 'Recall',
  PARTS_ORDERED: 'Parts ordered',
  WAITING: 'Waiting for parts',
  IN_PROGRESS: 'In progress',
  TO_FINISH: 'To finish',
  COMPLETED: 'Completed',
  DIAGNOSIS: 'Diagnosis',
};

/* Показываем в UI только эти три */
const SHOW_STATUSES = new Set([CANON.RECALL, CANON.PARTS_ORDERED, CANON.WAITING]);

/* Нормализация статусов к канонической форме.
   Ловим разные написания: "Part(s) ordered", "Parts Ordered", "Waiting for Parts", и т.п. */
function normalizeStatusForDb(s) {
  if (!s) return null;
  const raw = String(s).trim();
  const low = raw.toLowerCase();

  if (low === 'recall' || raw === 'ReCall') return CANON.RECALL;

  // любые варианты "parts ordered" / "part(s) ordered" / "parts ord"
  if (/^part/i.test(low) && /order/i.test(low)) return CANON.PARTS_ORDERED;

  // любые варианты "waiting for parts" / "wait parts" / "waiting parts"
  if (/wait/i.test(low) && /part/i.test(low)) return CANON.WAITING;

  if (low === 'in progress') return CANON.IN_PROGRESS;
  if (low === 'to finish') return CANON.TO_FINISH;

  if (low === 'completed' || low === 'done' || raw === 'выполнено') return CANON.COMPLETED;
  if (low === 'diagnosis' || low === 'diag') return CANON.DIAGNOSIS;

  return raw; // неизвестное — оставляем как есть
}

const STATUS_FILTER_OPTIONS = [CANON.RECALL, CANON.PARTS_ORDERED, CANON.WAITING];
const STATUS_VALUES = [
  CANON.RECALL,
  CANON.PARTS_ORDERED,
  CANON.WAITING,
  CANON.IN_PROGRESS,
  CANON.TO_FINISH,
  CANON.COMPLETED,
  CANON.DIAGNOSIS,
];

const input = { width: '100%', padding: '6px 8px', boxSizing: 'border-box' };
const btn = { padding: '8px 12px', cursor: 'pointer' };

export default function MaterialsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]); // может быть пустым из-за RLS — это нормально
  const [materials, setMaterials] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [comments, setComments] = useState([]);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [searchJob, setSearchJob] = useState('');

  const [modalJob, setModalJob] = useState(null);
  const [modalRows, setModalRows] = useState([]);
  const [modalTechnician, setModalTechnician] = useState('');
  const [modalStatus, setModalStatus] = useState('');

  const [hoveredJobId, setHoveredJobId] = useState(null);
  const [loading, setLoading] = useState(false);

  // ---------- table sizing ----------
  const COL = {
    JOB: 560,
    TECH: 220,
    NAME: 260,
    QTY: 80,
    PRICE: 110,
    SUPPLIER: 220,
    STATUS: 180,
  };
  const TABLE_WIDTH =
    COL.JOB + COL.TECH + COL.NAME + COL.QTY + COL.PRICE + COL.SUPPLIER + COL.STATUS;
  const tableStyle = {
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    width: `${TABLE_WIDTH}px`,
  };
  const th = (w, a = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: a,
    background: '#f5f5f5',
    fontWeight: 600,
  });
  const td = (w, a = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: a,
    verticalAlign: 'top',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  });

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchJobsSafe() {
    // 1) пробуем nested select по FK client_id; тянем и uuid, и id
    const try1 = await supabase
      .from('jobs')
      .select(`
        id,
        job_number,
        system_type,
        issue,
        status,
        technician_id,
        client_id,
        client:client_id (
          id,
          uuid,
          full_name,
          name,
          first_name,
          last_name,
          company,
          phone,
          mobile,
          phone_number
        )
      `);

    if (!try1.error && Array.isArray(try1.data)) return try1.data;

    // 2) если не получилось (неверный путь/ошибка) — откатываемся к простому select
    const try2 = await supabase.from('jobs').select('*');
    return try2.data || [];
  }

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [j, mRes, tRes, cRes] = await Promise.all([
        fetchJobsSafe(),
        supabase.from('materials').select('*'),
        supabase
          .from('technicians')
          .select('id, name, role, is_active')
          .in('role', ['technician', 'tech'])
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('comments')
          .select('id, job_id, created_at, text, image_url, technician_photos, author_user_id')
          .order('created_at', { ascending: false }),
      ]);

      // клиентов пробуем грузить «best effort» — если RLS не даст, просто будет []
      const clRes = await supabase
        .from('clients')
        .select('id, uuid, full_name, name, first_name, last_name, company, phone, mobile, phone_number');

      setJobs(j || []);
      setMaterials(mRes.data || []);
      setTechnicians(tRes.data || []);
      setComments(cRes.data || []);
      setClients(clRes.data || []); // может быть []
    } finally {
      setLoading(false);
    }
  };

  /* ---------- comments helpers ---------- */
  const commentsByJob = useMemo(() => {
    const map = new Map();
    (comments || []).forEach((c) => {
      const key = c.job_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    return map;
  }, [comments]);

  const getLatestComment = (jobId) => {
    const arr = commentsByJob.get(jobId) || [];
    if (!arr.length) return null;
    const c = arr[0];
    const imgUrl = c.image_url || c.technician_photos || null;
    return { text: c.text ?? '', image_url: imgUrl };
  };

  /* ---------- clients index: по id И по uuid ---------- */
  const clientsIndex = useMemo(() => {
    const m = new Map();
    (clients || []).forEach((c) => {
      const k1 = c?.id ? String(c.id) : null;
      const k2 = c?.uuid ? String(c.uuid) : null;
      if (k1) m.set(k1, c);
      if (k2) m.set(k2, c);
    });
    return m;
  }, [clients]);

  const techById = useMemo(() => {
    const m = new Map();
    (technicians || []).forEach((t) => m.set(String(t.id), t));
    return m;
  }, [technicians]);

  const techName = (id) => techById.get(String(id))?.name || '';

  function getSystemLabel(job) {
    return String(job?.system_type || '').trim();
  }
  function getProblemText(job) {
    return String(job?.issue || '').trim();
  }

  function pickClientFromJob(job) {
    // 1) если nested-join вернул клиента — используем его
    if (job?.client) return job.client;
    // 2) иначе ищем по client_id и в id, и в uuid
    if (job?.client_id) {
      const hit = clientsIndex.get(String(job.client_id));
      if (hit) return hit;
    }
    return null;
  }

  function getClientDisplay(job) {
    const c = pickClientFromJob(job);
    if (c) {
      const name =
        c.full_name ||
        c.name ||
        [c.first_name, c.last_name].filter(Boolean).join(' ') ||
        c.company ||
        '';
      const phone = c.phone || c.mobile || c.phone_number || '';
      return {
        name: name.trim(),
        company: String(c.company || '').trim(),
        phone: String(phone).trim(),
      };
    }
    // жёсткий фолбэк — короткий client_id
    if (job?.client_id) return { name: `Client ${String(job.client_id).slice(0, 8)}…`, company: '', phone: '' };
    return { name: '', company: '', phone: '' };
  }

  /* ---------- UI actions ---------- */
  const openModal = (job) => {
    const existingRows = materials.filter((m) => m.job_id === job.id);
    const st = normalizeStatusForDb(job.status) || '';
    setModalTechnician(job.technician_id ?? '');
    setModalStatus(st);
    setModalRows(
      existingRows.length
        ? existingRows
        : [{ name: '', price: '', quantity: 1, supplier: '', job_id: job.id }]
    );
    setModalJob(job);
  };

  const handleModalChange = (index, field, value) => {
    setModalRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };
  const addModalRow = () =>
    setModalRows((prev) => [
      ...prev,
      { name: '', price: '', quantity: 1, supplier: '', job_id: modalJob.id },
    ]);
  const removeModalRow = (index) =>
    setModalRows((prev) => prev.filter((_, i) => i !== index));

  const linkNumStyle = { color: '#2563eb', textDecoration: 'underline' };
  const rowClickableProps = (job) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => openModal(job),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(job);
      }
    },
    onMouseEnter: () => setHoveredJobId(job.id),
    onMouseLeave: () => setHoveredJobId(null),
    style: {
      cursor: 'pointer',
      background: hoveredJobId === job.id ? '#f9fafb' : 'transparent',
    },
  });

  // inline: status
  const handleInlineStatusChange = async (job, newVal) => {
    const newStatus = normalizeStatusForDb(newVal);
    const prevStatus = normalizeStatusForDb(job.status);

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: newStatus } : j)));

    const { error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', job.id);
    if (error) {
      // rollback
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: prevStatus } : j)));
      return;
    }
    await fetchAll();
  };

  // inline: technician
  const handleInlineTechChange = async (job, newTechId) => {
    const parsed =
      newTechId === '' || newTechId == null
        ? null
        : Number.isNaN(Number(newTechId))
        ? newTechId
        : parseInt(newTechId, 10);

    const prev = job.technician_id ?? null;
    setJobs((prevJobs) =>
      prevJobs.map((j) => (j.id === job.id ? { ...j, technician_id: parsed } : j))
    );

    const { error } = await supabase.from('jobs').update({ technician_id: parsed }).eq('id', job.id);
    if (error) {
      // rollback
      setJobs((prevJobs) =>
        prevJobs.map((j) => (j.id === job.id ? { ...j, technician_id: prev } : j))
      );
    }
  };

  /* ---------- derived ---------- */
  const jobsMap = useMemo(() => {
    const map = new Map();
    jobs.forEach((j) => map.set(j.id, j));
    return map;
  }, [jobs]);

  const filteredMaterials = useMemo(() => {
    return materials.filter((row) => {
      const job = jobsMap.get(row.job_id);
      if (!job) return false;

      const normalizedStatus = normalizeStatusForDb(job.status);
      if (!SHOW_STATUSES.has(normalizedStatus)) return false;

      if (filterStatus !== 'all' && normalizedStatus !== filterStatus) return false;

      if (filterTech !== 'all') {
        const jid = job.technician_id == null ? '' : String(job.technician_id);
        if (String(filterTech) !== jid) return false;
      }

      if (searchJob.trim()) {
        const q = searchJob.trim().toLowerCase();
        const num = (job.job_number ?? '').toString().toLowerCase();
        const idStr = (job.id ?? '').toString().toLowerCase();
        if (!num.includes(q) && !idStr.includes(q)) return false;
      }

      return true;
    });
  }, [materials, jobsMap, filterStatus, filterTech, searchJob]);

  const jobsWithoutMaterials = useMemo(() => {
    return jobs.filter(
      (j) =>
        SHOW_STATUSES.has(normalizeStatusForDb(j.status)) &&
        !materials.find((m) => m.job_id === j.id)
    );
  }, [jobs, materials]);

  const renderJobCell = (job) => {
    const { name, phone, company } = getClientDisplay(job);
    const system = getSystemLabel(job);
    const problem = getProblemText(job);

    return (
      <div>
        <div>
          <span style={linkNumStyle}>№{job.job_number || job.id}</span>
          {name ? <span> — {name}</span> : null}
          {company ? <span> ({company})</span> : null}
          {phone ? <span> • {phone}</span> : null}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          {system ? <span><strong>System:</strong> {system}</span> : null}
          {system && problem ? <span> • </span> : null}
          {problem ? <span><strong>Problem:</strong> {problem}</span> : null}
        </div>
      </div>
    );
  };

  const renderJobLineCompact = (job) => {
    const { name, phone, company } = getClientDisplay(job);
    const system = getSystemLabel(job);
    const problem = getProblemText(job);

    const pieces = [
      `№${job.job_number || job.id}`,
      [name, company].filter(Boolean).join(' / ') || '',
      phone || '',
      system ? `System: ${system}` : '',
      problem ? `Problem: ${problem}` : '',
    ].filter(Boolean);

    return pieces.join(' — ');
  };

  /* ---------- modal sizing ---------- */
  const mCOL = { NAME: 320, QTY: 110, PRICE: 130, SUP: 280, ACT: 80 };
  const mth = (w, a = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    background: '#f5f5f5',
    fontWeight: 600,
    textAlign: a,
  });
  const mtd = (w, a = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: a,
    verticalAlign: 'top',
  });

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Materials by Jobs</h2>

      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        💡 Tip: click <span style={{ color: '#2563eb', textDecoration: 'underline' }}>job number</span> or anywhere on a row to open the materials editor. You can change <strong>Status</strong> and <strong>Technician</strong> inline.
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ ...input, width: 260 }}
          >
            <option value="all">All (showing only: Recall / Part(s) ordered / Waiting for parts)</option>
            {STATUS_FILTER_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Technician</label>
          <select
            value={filterTech}
            onChange={(e) => setFilterTech(e.target.value)}
            style={{ ...input, width: 220 }}
          >
            <option value="all">All</option>
            {technicians.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Search by Job # / ID</label>
          <input
            value={searchJob}
            onChange={(e) => setSearchJob(e.target.value)}
            placeholder="e.g. 42 or 6f1a-..."
            style={input}
          />
        </div>

        <button onClick={fetchAll} style={{ ...btn, border: '1px solid #ddd' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Jobs without materials */}
      {jobsWithoutMaterials.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '6px 0' }}>Jobs without materials:</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {jobsWithoutMaterials.map((j) => (
              <li key={j.id} style={{ marginBottom: 6 }}>
                <span style={{ color: '#2563eb', textDecoration: 'underline' }}>{renderJobLineCompact(j)}</span>{' '}
                <button
                  onClick={() => openModal(j)}
                  style={{ ...btn, padding: '4px 8px', border: '1px solid #ddd', marginLeft: 6 }}
                >
                  Add material
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Materials table */}
      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: COL.JOB }} />
            <col style={{ width: COL.TECH }} />
            <col style={{ width: COL.NAME }} />
            <col style={{ width: COL.QTY }} />
            <col style={{ width: COL.PRICE }} />
            <col style={{ width: COL.SUPPLIER }} />
            <col style={{ width: COL.STATUS }} />
          </colgroup>
          <thead>
            <tr>
              <th style={th(COL.JOB)}>Job / Client / System / Problem</th>
              <th style={th(COL.TECH)}>Technician</th>
              <th style={th(COL.NAME)}>Material</th>
              <th style={th(COL.QTY, 'right')}>Qty</th>
              <th style={th(COL.PRICE, 'right')}>Price</th>
              <th style={th(COL.SUPPLIER)}>Supplier</th>
              <th style={th(COL.STATUS)}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredMaterials.map((row) => {
              const job = jobsMap.get(row.job_id);
              if (!job) return null;

              const jobTechVal = job.technician_id == null ? '' : String(job.technician_id);
              const techExists = jobTechVal === '' || technicians.some((t) => String(t.id) === jobTechVal);

              return (
                <tr key={row.id} {...rowClickableProps(job)}>
                  <td style={td(COL.JOB)}>
                    {renderJobCell(job)}
                  </td>

                  {/* Technician: INLINE SELECT */}
                  <td
                    style={td(COL.TECH)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <select
                      value={jobTechVal}
                      onChange={(e) => handleInlineTechChange(job, e.target.value)}
                      style={input}
                    >
                      <option value="">—</option>
                      {!techExists && jobTechVal && (
                        <option value={jobTechVal}>{techName(job.technician_id) || `ID ${jobTechVal}`}</option>
                      )}
                      {technicians.map((t) => (
                        <option key={t.id} value={String(t.id)}>{t.name}</option>
                      ))}
                    </select>
                  </td>

                  <td style={td(COL.NAME)}>{row.name}</td>
                  <td style={td(COL.QTY, 'right')}>{row.quantity}</td>
                  <td style={td(COL.PRICE, 'right')}>{row.price}</td>
                  <td style={td(COL.SUPPLIER)}>{row.supplier}</td>

                  {/* Status: INLINE SELECT */}
                  <td
                    style={td(COL.STATUS)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <select
                      value={normalizeStatusForDb(job.status) || ''}
                      onChange={(e) => handleInlineStatusChange(job, e.target.value)}
                      style={input}
                    >
                      {!STATUS_VALUES.includes(normalizeStatusForDb(job.status) || '') && (
                        <option value={normalizeStatusForDb(job.status) || ''}>
                          {normalizeStatusForDb(job.status) || ''}
                        </option>
                      )}
                      {STATUS_FILTER_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}

            {filteredMaterials.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 8, border: '1px solid #ccc' }}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modalJob && (() => {
        const lc = getLatestComment(modalJob.id);
        return (
          <div
            style={{
              border: '1px solid #ccc',
              padding: 16,
              borderRadius: 8,
              maxWidth: mCOL.NAME + mCOL.QTY + mCOL.PRICE + mCOL.SUP + mCOL.ACT,
              background: '#fff',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
              Job №{modalJob.job_number || modalJob.id}
            </h3>

            <div style={{ marginBottom: 8, fontSize: 14 }}>
              <strong>Comment:</strong> {lc?.text?.trim() ? lc.text : '—'}
            </div>

            <div style={{ marginBottom: 10, fontSize: 14 }}>
              <strong>Photo:</strong>{' '}
              {lc?.image_url ? (
                <img
                  src={lc.image_url}
                  width="150"
                  alt="technician photo"
                  style={{ borderRadius: 4, border: '1px solid #ddd' }}
                />
              ) : '—'}
            </div>

            <div style={{ marginBottom: 10, display: 'flex', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Technician</label>
                <select
                  value={modalTechnician ?? ''}
                  onChange={(e) => setModalTechnician(e.target.value)}
                  style={input}
                >
                  <option value="">—</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Status</label>
                <select
                  value={normalizeStatusForDb(modalStatus) || ''}
                  onChange={(e) => setModalStatus(e.target.value)}
                  style={input}
                >
                  {!STATUS_VALUES.includes(normalizeStatusForDb(modalStatus) || '') && (
                    <option value={normalizeStatusForDb(modalStatus) || ''}>
                      {normalizeStatusForDb(modalStatus) || ''}
                    </option>
                  )}
                  {STATUS_FILTER_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width: `${mCOL.NAME + mCOL.QTY + mCOL.PRICE + mCOL.SUP + mCOL.ACT}px` }}>
                <colgroup>
                  <col style={{ width: mCOL.NAME }} />
                  <col style={{ width: mCOL.QTY }} />
                  <col style={{ width: mCOL.PRICE }} />
                  <col style={{ width: mCOL.SUP }} />
                  <col style={{ width: mCOL.ACT }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={mth(mCOL.NAME)}>Material</th>
                    <th style={mth(mCOL.QTY, 'right')}>Qty</th>
                    <th style={mth(mCOL.PRICE, 'right')}>Price</th>
                    <th style={mth(mCOL.SUP)}>Supplier</th>
                    <th style={mth(mCOL.ACT, 'center')}></th>
                  </tr>
                </thead>
                <tbody>
                  {modalRows.map((r, i) => (
                    <tr key={`${r.id || 'new'}_${i}`}>
                      <td style={mtd(mCOL.NAME)}>
                        <input
                          value={r.name}
                          onChange={(e) => handleModalChange(i, 'name', e.target.value)}
                          style={input}
                          placeholder="Name"
                        />
                      </td>
                      <td style={mtd(mCOL.QTY, 'right')}>
                        <input
                          type="number"
                          value={r.quantity}
                          onChange={(e) => handleModalChange(i, 'quantity', e.target.value)}
                          style={{ ...input, textAlign: 'right' }}
                          placeholder="1"
                        />
                      </td>
                      <td style={mtd(mCOL.PRICE, 'right')}>
                        <input
                          type="number"
                          value={r.price}
                          onChange={(e) => handleModalChange(i, 'price', e.target.value)}
                          style={{ ...input, textAlign: 'right' }}
                          placeholder="$"
                        />
                      </td>
                      <td style={mtd(mCOL.SUP)}>
                        <input
                          value={r.supplier}
                          onChange={(e) => handleModalChange(i, 'supplier', e.target.value)}
                          style={input}
                          placeholder="Supplier"
                        />
                      </td>
                      <td style={mtd(mCOL.ACT, 'center')}>
                        <button onClick={() => removeModalRow(i)} title="Remove row" style={btn}>×</button>
                      </td>
                    </tr>
                  ))}

                  {modalRows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 8, border: '1px solid #ccc' }}>No rows</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={addModalRow} style={{ ...btn, border: '1px solid #ddd' }}>+ Add another</button>
              <div style={{ flex: 1 }} />
              <button
                onClick={async () => {
                  if (!modalJob) return;
                  // save job fields
                  await supabase.from('jobs').update({
                    technician_id:
                      modalTechnician === '' || modalTechnician == null
                        ? null
                        : Number.isNaN(Number(modalTechnician))
                        ? modalTechnician
                        : parseInt(modalTechnician, 10),
                    status: normalizeStatusForDb(modalStatus) || null,
                  }).eq('id', modalJob.id);

                  // split
                  const inserts = modalRows.filter(r => !r.id).map(r => ({
                    job_id: modalJob.id,
                    name: r.name,
                    price: r.price === '' || r.price == null ? null : parseFloat(r.price),
                    quantity: r.quantity === '' || r.quantity == null ? null : parseInt(r.quantity, 10),
                    supplier: r.supplier || null,
                  }));
                  const updates = modalRows.filter(r => r.id);

                  for (const u of updates) {
                    await supabase.from('materials').update({
                      name: u.name,
                      price: u.price === '' || u.price == null ? null : parseFloat(u.price),
                      quantity: u.quantity === '' || u.quantity == null ? null : parseInt(u.quantity, 10),
                      supplier: u.supplier || null,
                    }).eq('id', u.id);
                  }
                  if (inserts.length) await supabase.from('materials').insert(inserts);

                  setModalJob(null);
                  await fetchAll();
                }}
                style={{ ...btn, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6 }}
              >
                Save
              </button>
              <button onClick={() => setModalJob(null)} style={{ ...btn, border: '1px solid #ddd' }}>Close</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
