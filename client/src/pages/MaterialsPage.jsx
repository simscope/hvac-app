// client/src/pages/MaterialsPage.jsx
// Materials table + inline status/technician editing, modal to add/edit materials
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

/* ---------- Status values stored in DB (Title Case) ---------- */
const STATUS_VALUES = [
  'Recall',
  'Parts ordered',
  'Waiting for parts',
  'In progress',
  'To finish',
  'Completed',
];

const STATUS_LABEL = (v) => v;

/* Normalize any incoming value → DB format with Capitalized form */
const normalizeStatusForDb = (s) => {
  if (!s) return null;
  const raw = String(s).trim();
  const low = raw.toLowerCase();

  if (low === 'recall' || raw === 'ReCall') return 'Recall';
  if (low === 'parts ordered') return 'Parts ordered';
  if (low === 'waiting for parts') return 'Waiting for parts';
  if (low === 'in progress') return 'In progress';
  if (low === 'to finish') return 'To finish';
  if (low === 'completed' || low === 'done' || raw === 'выполнено') return 'Completed';
  return raw;
};

/* ---------- Show only these in the table ---------- */
const SHOW_STATUSES = new Set(['Recall', 'Parts ordered', 'Waiting for parts']);

/* ---------- Small helpers ---------- */
const toIntOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};
const toFloatOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

export default function MaterialsPage() {
  const [jobs, setJobs] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [comments, setComments] = useState([]);
  const [clients, setClients] = useState([]);

  // quick filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [searchJob, setSearchJob] = useState('');

  // modal state
  const [modalJob, setModalJob] = useState(null);
  const [modalRows, setModalRows] = useState([]);
  const [modalTechnician, setModalTechnician] = useState('');
  const [modalStatus, setModalStatus] = useState('');

  const [hoveredJobId, setHoveredJobId] = useState(null);
  const [loading, setLoading] = useState(false);

  // ---------- fixed widths ----------
  const COL = {
    JOB: 560, // шире, т.к. выводим больше текста
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
  const th = (w, align = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: align,
    background: '#f5f5f5',
    fontWeight: 600,
  });
  const td = (w, align = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: align,
    verticalAlign: 'top',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  });
  const input = { width: '100%', padding: '6px 8px', boxSizing: 'border-box' };
  const btn = { padding: '8px 12px', cursor: 'pointer' };

  // modal (materials table)
  const MCOL = { NAME: 320, QTY: 110, PRICE: 130, SUP: 280, ACT: 80 };
  const MTABLE_WIDTH = MCOL.NAME + MCOL.QTY + MCOL.PRICE + MCOL.SUP + MCOL.ACT;
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

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [{ data: j }, { data: m }, { data: t }, { data: c }, { data: cmts }] = await Promise.all([
        supabase.from('jobs').select('*'),
        supabase.from('materials').select('*'),
        supabase
          .from('technicians')
          .select('id, name, role, is_active')
          .in('role', ['technician', 'tech'])
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase.from('clients').select('id, full_name, company'),
        supabase
          .from('comments')
          .select('id, job_id, created_at, text, image_url, technician_photos, author_user_id')
          .order('created_at', { ascending: false }),
      ]);

      setJobs(j || []);
      setMaterials(m || []);
      setTechnicians(t || []);
      setClients(c || []);
      setComments(cmts || []);
    } finally {
      setLoading(false);
    }
  };

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

  /* ---------- комментарии по job (быстрый доступ) ---------- */
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

  const handleModalSave = async () => {
    if (!modalJob) return;

    await supabase
      .from('jobs')
      .update({
        technician_id:
          modalTechnician === '' || modalTechnician == null
            ? null
            : Number.isNaN(Number(modalTechnician))
            ? modalTechnician
            : parseInt(modalTechnician, 10),
        status: normalizeStatusForDb(modalStatus) || null,
      })
      .eq('id', modalJob.id);

    const inserts = modalRows
      .filter((r) => !r.id)
      .map((r) => ({
        job_id: modalJob.id,
        name: r.name,
        price: toFloatOrNull(r.price),
        quantity: toIntOrNull(r.quantity),
        supplier: r.supplier || null,
      }));

    const updates = modalRows.filter((r) => r.id);

    for (const u of updates) {
      await supabase
        .from('materials')
        .update({
          name: u.name,
          price: toFloatOrNull(u.price),
          quantity: toIntOrNull(u.quantity),
          supplier: u.supplier || null,
        })
        .eq('id', u.id);
    }

    if (inserts.length > 0) {
      await supabase.from('materials').insert(inserts);
    }

    setModalJob(null);
    await fetchAll();
  };

  /* ---------- memo maps ---------- */
  const techById = useMemo(() => {
    const m = new Map();
    (technicians || []).forEach((t) => m.set(String(t.id), t));
    return m;
  }, [technicians]);

  const clientsById = useMemo(() => {
    const m = new Map();
    (clients || []).forEach((cl) => m.set(cl.id, cl));
    return m;
  }, [clients]);

  const techName = (id) => techById.get(String(id))?.name || '';

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

  // inline: change status/technician
  const handleInlineStatusChange = async (job, newVal) => {
    const newStatus = normalizeStatusForDb(newVal);
    const prevStatus = normalizeStatusForDb(job.status);

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: newStatus } : j)));

    const { error } = await supabase
      .from('jobs')
      .update({ status: newStatus })
      .eq('id', job.id);

    if (error) {
      alert('Failed to save status');
      console.error(error);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: prevStatus } : j)));
      return;
    }

    await fetchAll();
  };

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

    const { error } = await supabase
      .from('jobs')
      .update({ technician_id: parsed })
      .eq('id', job.id);

    if (error) {
      alert('Failed to save technician');
      console.error(error);
      setJobs((prevJobs) =>
        prevJobs.map((j) => (j.id === job.id ? { ...j, technician_id: prev } : j))
      );
      return;
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

  /* ---------- форматирование без слов: № — Company — Full Name — System — Problem ---------- */
  const clientPlain = (job) => {
    const cl = clientsById.get(job.client_id);
    const hasCompany = !!(cl && cl.company && cl.company.trim());
    const hasName = !!(cl && cl.full_name && cl.full_name.trim());
    if (hasCompany && hasName) return `${cl.company} — ${cl.full_name}`;
    if (hasCompany) return cl.company;
    if (hasName) return cl.full_name;
    return '—';
  };

  const sentenceForJob = (job) => {
    const num = job.job_number || job.id;
    const client = clientPlain(job);
    const sys = job.system_type || '—';
    const problem = job.issue || job.problem || '—';
    return `№${num} — ${client} — ${sys} — ${problem}`;
  };

  const renderJobCell = (job) => (
    <div style={{ fontWeight: 600 }}>{sentenceForJob(job)}</div>
  );

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Materials by Jobs</h2>

      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        💡 Tip: click job row to open the materials editor. You can change Status and Technician inline.
      </div>

      {/* Quick filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ ...input, width: 320 }}
          >
            <option value="all">All (showing only: Recall / Part(s) ordered / Waiting for parts)</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL(s)}
              </option>
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
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
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
                <span>{sentenceForJob(j)}</span>{' '}
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
                  <td style={td(COL.JOB)}>{renderJobCell(job)}</td>

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
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                        </option>
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
                      {STATUS_VALUES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL(s)}
                        </option>
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

      {/* Modal: edit materials */}
      {modalJob && (
        <div
          style={{
            border: '1px solid #ccc',
            padding: 16,
            borderRadius: 8,
            maxWidth: MTABLE_WIDTH,
            background: '#fff',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>
            {sentenceForJob(modalJob)}
          </h3>

          {(() => {
            const lc = getLatestComment(modalJob.id);
            return (
              <>
                <div style={{ marginBottom: 8, fontSize: 14 }}>
                  <strong>Comment:</strong> {lc?.text?.trim() ? lc.text : '—'}
                </div>

                <div style={{ marginBottom: 10, fontSize: 14 }}>
                  <strong>Photo:</strong>{' '}
                  {lc?.image_url ? (
                    <img
                      src={lc.image_url}
                      width="150"
                      alt="technician"
                      style={{ borderRadius: 4, border: '1px solid #ddd' }}
                    />
                  ) : (
                    '—'
                  )}
                </div>
              </>
            );
          })()}

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
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
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
                {STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table
              style={{
                tableLayout: 'fixed',
                borderCollapse: 'collapse',
                width: `${MTABLE_WIDTH}px`,
              }}
            >
              <colgroup>
                <col style={{ width: MCOL.NAME }} />
                <col style={{ width: MCOL.QTY }} />
                <col style={{ width: MCOL.PRICE }} />
                <col style={{ width: MCOL.SUP }} />
                <col style={{ width: MCOL.ACT }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={mth(MCOL.NAME)}>Material</th>
                  <th style={mth(MCOL.QTY, 'right')}>Qty</th>
                  <th style={mth(MCOL.PRICE, 'right')}>Price</th>
                  <th style={mth(MCOL.SUP)}>Supplier</th>
                  <th style={mth(MCOL.ACT, 'center')}></th>
                </tr>
              </thead>
              <tbody>
                {modalRows.map((r, i) => (
                  <tr key={`${r.id || 'new'}_${i}`}>
                    <td style={mtd(MCOL.NAME)}>
                      <input
                        value={r.name}
                        onChange={(e) => handleModalChange(i, 'name', e.target.value)}
                        style={input}
                        placeholder="Name"
                      />
                    </td>
                    <td style={mtd(MCOL.QTY, 'right')}>
                      <input
                        type="number"
                        value={r.quantity}
                        onChange={(e) => handleModalChange(i, 'quantity', e.target.value)}
                        style={{ ...input, textAlign: 'right' }}
                        placeholder="1"
                      />
                    </td>
                    <td style={mtd(MCOL.PRICE, 'right')}>
                      <input
                        type="number"
                        value={r.price}
                        onChange={(e) => handleModalChange(i, 'price', e.target.value)}
                        style={{ ...input, textAlign: 'right' }}
                        placeholder="$"
                      />
                    </td>
                    <td style={mtd(MCOL.SUP)}>
                      <input
                        value={r.supplier}
                        onChange={(e) => handleModalChange(i, 'supplier', e.target.value)}
                        style={input}
                        placeholder="Supplier"
                      />
                    </td>
                    <td style={mtd(MCOL.ACT, 'center')}>
                      <button onClick={() => removeModalRow(i)} title="Remove row" style={btn}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}

                {modalRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 8, border: '1px solid #ccc' }}>
                      No rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={addModalRow} style={{ ...btn, border: '1px solid #ddd' }}>
              + Add another
            </button>
            <div style={{ flex: 1 }} />
            <button
              onClick={handleModalSave}
              style={{ ...btn, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6 }}
            >
              Save
            </button>
            <button onClick={() => setModalJob(null)} style={{ ...btn, border: '1px solid #ddd' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
