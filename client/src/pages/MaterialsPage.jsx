// client/src/pages/MaterialsPage.jsx
// Таблица материалов + inline-смена статуса и техника в самой таблице
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

/* ---------- Статусы: храним в БД нормализованные значения ---------- */
const STATUS_VALUES = [
  'recall',
  'заказ деталей',
  'ожидание деталей',
  'в работе',
  'к финишу',
  'завершено',
];

// отображаемые лейблы для селекта
const STATUS_LABEL = (v) => (v === 'recall' ? 'ReCall' : v);

// нормализация входящего значения в формат БД
const normalizeStatusForDb = (s) => {
  if (!s) return null;
  const v = String(s).trim();
  if (v.toLowerCase() === 'recall' || v === 'ReCall') return 'recall';
  if (v === 'выполнено') return 'завершено';
  return v;
};

/* ---------- Показываем строки только для этих статусов ---------- */
const SHOW_STATUSES = new Set(['recall', 'заказ деталей', 'ожидание деталей']);

const MaterialsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [comments, setComments] = useState([]);

  const [modalJob, setModalJob] = useState(null);
  const [modalRows, setModalRows] = useState([]);
  const [modalTechnician, setModalTechnician] = useState('');
  const [modalStatus, setModalStatus] = useState('');

  const [hoveredJobId, setHoveredJobId] = useState(null);

  // ---------- фиксированные ширины ----------
  const COL = {
    JOB: 120,
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

  // модалка (таблица материалов)
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
  }, []);

  const fetchAll = async () => {
    const [{ data: j }, { data: m }, { data: t }, { data: c }] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('materials').select('*'),
      // ВАЖНО: берём и 'technician', и 'tech', и только активных
      supabase
        .from('technicians')
        .select('id, name, role, is_active')
        .in('role', ['technician', 'tech'])
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase.from('comments').select('*'),
    ]);
    setJobs(j || []);
    setMaterials(m || []);
    setTechnicians(t || []);
    setComments(c || []);
  };

  const openModal = (job) => {
    const existingRows = materials.filter((m) => m.job_id === job.id);
    // нормализуем статус для UI
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

  const getCommentByJob = (id) => {
    const c = comments.find((x) => x.job_id === id);
    return c ? { text: c.text ?? c.content ?? '', technician_photos: c.technician_photos } : null;
  };

  const handleModalSave = async () => {
    if (!modalJob) return;

    // Сохраняем технику и статус заявки
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

    // Разделяем на новые и существующие
    const inserts = modalRows
      .filter((r) => !r.id)
      .map((r) => ({
        job_id: modalJob.id,
        name: r.name,
        price: r.price !== '' && r.price != null ? parseFloat(r.price) : null,
        quantity: r.quantity !== '' && r.quantity != null ? parseInt(r.quantity, 10) : null,
        supplier: r.supplier || null,
      }));

    const updates = modalRows.filter((r) => r.id);

    for (const u of updates) {
      await supabase
        .from('materials')
        .update({
          name: u.name,
          price: u.price !== '' && u.price != null ? parseFloat(u.price) : null,
          quantity: u.quantity !== '' && u.quantity != null ? parseInt(u.quantity, 10) : null,
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

  /* ---------- Вспомогательные ---------- */
  const techById = useMemo(() => {
    const m = new Map();
    (technicians || []).forEach((t) => m.set(String(t.id), t));
    return m;
  }, [technicians]);

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

  // смена статуса прямо в таблице
  const handleInlineStatusChange = async (job, newVal) => {
    const newStatus = normalizeStatusForDb(newVal);
    const prevStatus = normalizeStatusForDb(job.status);

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: newStatus } : j)));

    const { error } = await supabase
      .from('jobs')
      .update({ status: newStatus })
      .eq('id', job.id);

    if (error) {
      alert('Не удалось сохранить статус');
      console.error(error);
      // откат UI
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: prevStatus } : j)));
      return;
    }

    // если ушли из SHOW_STATUSES — таблицу нужно обновить
    await fetchAll();
  };

  // смена техника прямо в таблице
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
      alert('Не удалось сохранить техника');
      console.error(error);
      // откат
      setJobs((prevJobs) =>
        prevJobs.map((j) => (j.id === job.id ? { ...j, technician_id: prev } : j))
      );
      return;
    }
  };

  // заявки без деталей (для SHOW_STATUSES)
  const jobsWithoutMaterials = jobs.filter(
    (j) => SHOW_STATUSES.has(normalizeStatusForDb(j.status)) && !materials.find((m) => m.job_id === j.id)
  );

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Детали по заявкам</h2>

      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        💡 Подсказка: кликните по <span style={linkNumStyle}>№ заявки</span> или по всей строке, чтобы открыть
        редактирование материалов. Статус и технику можно менять прямо в таблице.
      </div>

      {/* Блок «заявки без деталей» */}
      {jobsWithoutMaterials.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '6px 0' }}>Заявки без деталей:</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {jobsWithoutMaterials.map((j) => (
              <li key={j.id} style={{ marginBottom: 4 }}>
                №<span style={linkNumStyle}>{j.job_number || j.id}</span>{' '}
                <button
                  onClick={() => openModal(j)}
                  style={{ ...btn, padding: '4px 8px', border: '1px solid #ddd', marginLeft: 6 }}
                >
                  Добавить деталь
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Таблица материалов по активным (SHOW_STATUSES) */}
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
              <th style={th(COL.JOB)}>№ заявки</th>
              <th style={th(COL.TECH)}>Техник</th>
              <th style={th(COL.NAME)}>Название</th>
              <th style={th(COL.QTY, 'right')}>Кол-во</th>
              <th style={th(COL.PRICE, 'right')}>Цена</th>
              <th style={th(COL.SUPPLIER)}>Поставщик</th>
              <th style={th(COL.STATUS)}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((row) => {
              const job = jobs.find((j) => j.id === row.job_id);
              if (!job || !SHOW_STATUSES.has(normalizeStatusForDb(job.status))) return null;

              // для селекта техника: текущее значение как строка
              const jobTechVal = job.technician_id == null ? '' : String(job.technician_id);
              const techExists = jobTechVal === '' || technicians.some((t) => String(t.id) === jobTechVal);

              return (
                <tr key={row.id} {...rowClickableProps(job)}>
                  <td style={td(COL.JOB)}>
                    <span style={linkNumStyle}>№{job.job_number || job.id}</span>
                  </td>

                  {/* Техник: ИНЛАЙН-СЕЛЕКТ */}
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
                      {/* если в БД стоит техник, которого нет в списке (неактивен) — показываем как фиксированное значение */}
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

                  {/* Статус: ИНЛАЙН-СЕЛЕКТ */}
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
                      {/* если вдруг статус нестандартный — добавим опцию, чтобы не терять значение */}
                      {!STATUS_VALUES.includes(normalizeStatusForDb(job.status) || '') && (
                        <option value={normalizeStatusForDb(job.status) || ''}>
                          {STATUS_LABEL(normalizeStatusForDb(job.status) || '')}
                        </option>
                      )}
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

            {/* если пусто */}
            {materials.filter((r) => {
              const j = jobs.find((x) => x.id === r.job_id);
              return j && SHOW_STATUSES.has(normalizeStatusForDb(j.status));
            }).length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 8, border: '1px solid #ccc' }}>
                  Нет строк
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Модальное редактирование материалов */}
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
            Заявка №{modalJob.job_number || modalJob.id}
          </h3>

          <div style={{ marginBottom: 8, fontSize: 14 }}>
            <strong>Комментарий:</strong> {getCommentByJob(modalJob.id)?.text || '—'}
          </div>

          <div style={{ marginBottom: 10, fontSize: 14 }}>
            <strong>Фото:</strong>{' '}
            {getCommentByJob(modalJob.id)?.technician_photos ? (
              <img
                src={`data:image/jpeg;base64,${getCommentByJob(modalJob.id).technician_photos}`}
                width="150"
                alt="фото техника"
                style={{ borderRadius: 4, border: '1px solid #ddd' }}
              />
            ) : (
              '—'
            )}
          </div>

          <div style={{ marginBottom: 10, display: 'flex', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Техник</label>
              <select
                value={modalTechnician ?? ''}
                onChange={(e) => setModalTechnician(e.target.value)}
                style={input}
              >
                <option value="">—</option>
                {/* подстрахуемся, если текущий техник неактивен и не в списке */}
                {modalTechnician &&
                  !technicians.some((t) => String(t.id) === String(modalTechnician)) && (
                    <option value={String(modalTechnician)}>
                      {techName(modalTechnician) || `ID ${modalTechnician}`}
                    </option>
                  )}
                {technicians.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Статус</label>
              <select
                value={normalizeStatusForDb(modalStatus) || ''}
                onChange={(e) => setModalStatus(e.target.value)}
                style={input}
              >
                {/* нестандартный статус */}
                {!STATUS_VALUES.includes(normalizeStatusForDb(modalStatus) || '') && (
                  <option value={normalizeStatusForDb(modalStatus) || ''}>
                    {STATUS_LABEL(normalizeStatusForDb(modalStatus) || '')}
                  </option>
                )}
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
                  <th style={mth(MCOL.NAME)}>Название</th>
                  <th style={mth(MCOL.QTY, 'right')}>Кол-во</th>
                  <th style={mth(MCOL.PRICE, 'right')}>Цена</th>
                  <th style={mth(MCOL.SUP)}>Поставщик</th>
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
                        placeholder="Название"
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
                        placeholder="Поставщик"
                      />
                    </td>
                    <td style={mtd(MCOL.ACT, 'center')}>
                      <button onClick={() => removeModalRow(i)} title="Удалить строку" style={btn}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}

                {modalRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 8, border: '1px solid #ccc' }}>
                      Нет строк
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={addModalRow} style={{ ...btn, border: '1px solid #ddd' }}>
              + Добавить ещё
            </button>
            <div style={{ flex: 1 }} />
            <button
              onClick={handleModalSave}
              style={{ ...btn, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6 }}
            >
              Сохранить
            </button>
            <button onClick={() => setModalJob(null)} style={{ ...btn, border: '1px solid #ddd' }}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialsPage;
