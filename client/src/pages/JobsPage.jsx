// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

const STATUS_ORDER = [
  'ReCall',
  'диагностика',
  'в работе',
  'заказ деталей',
  'ожидание деталей',
  'к финишу',
  'заверщено',
  ];

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    const [
      { data: jobData },
      { data: clientData },
      { data: techData },
    ] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('clients').select('*'),
      supabase.from('technicians').select('id,name,role').eq('role', 'tech'),
    ]);

    setJobs(jobData || []);
    setClients(clientData || []);
    setTechnicians(techData || []);
  }

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  };

  // представление для таблицы
  const jobsView = useMemo(
    () =>
      (jobs || []).map((j) => {
        const c = clients.find((x) => x.id === j.client_id);
        return {
          ...j,
          client_name: c?.full_name || c?.name || '—',
          client_phone: c?.phone || '',
          created_at_fmt: fmtDate(j.created_at),
        };
      }),
    [jobs, clients]
  );

  // сортировка: приоритет статуса + новее выше
  const orderMap = useMemo(
    () => new Map(STATUS_ORDER.map((s, i) => [s.toLowerCase(), i])),
    []
  );

  const sortedJobs = useMemo(() => {
    return [...jobsView].sort((a, b) => {
      const ar = orderMap.has(String(a.status || '').toLowerCase())
        ? orderMap.get(String(a.status || '').toLowerCase())
        : 999;
      const br = orderMap.has(String(b.status || '').toLowerCase())
        ? orderMap.get(String(b.status || '').toLowerCase())
        : 999;
      if (ar !== br) return ar - br;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [jobsView, orderMap]);

  // локальное редактирование ячеек
  const handleChange = (id, field, value) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, [field]: value } : j)));
  };

  // сохранение (минимально нужные поля)
  const handleSave = async (job) => {
    setSavingId(job.id);
    try {
      const payload = {
        technician_id:
          job.technician_id === '' || job.technician_id == null
            ? null
            : job.technician_id,
        status: job.status ?? null,
        scf:
          job.scf === '' || job.scf == null
            ? null
            : Number.isNaN(Number(job.scf))
            ? null
            : Number(job.scf),
      };
      const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
      if (error) throw error;
      await fetchAll();
      alert('Сохранено');
    } catch (e) {
      console.error(e);
      alert('Ошибка при сохранении');
    } finally {
      setSavingId(null);
    }
  };

  const openJob = (id) => navigate(`/job/${id}`);

  return (
    <div className="p-4">
      {/* Стили как у «Все заявки», адаптивность: скрываем только Систему и Дату */}
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .row-click { cursor:pointer; }
        .row-click:hover { background:#f9fafb; }

        .jobs-table input, .jobs-table select {
          width: 100%;
          height: 28px;
          font-size: 14px;
          padding: 2px 6px;
          box-sizing: border-box;
        }

        /* адаптив: оставляем колонки с редактированием видимыми */
        @media (max-width: 1024px) {
          .col-system, .col-date { display:none; }
        }
      `}</style>

      {/* форма создания заявки — без изменений */}
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
            <col style={{ width: 160 }} />
            <col style={{ width: 140 }} />
          </colgroup>

          <thead>
            <tr>
              <th>Job #</th>
              <th>Клиент</th>
              <th className="col-system">Система</th>
              <th>Проблема</th>
              <th>SCF</th>
              <th>Техник</th>
              <th className="col-date">Дата</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>

          <tbody>
            {sortedJobs.map((job) => {
              return (
                <tr
                  key={job.id}
                  className="row-click"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    const tag = e.target.tagName;
                    if (!['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
                      openJob(job.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openJob(job.id);
                      }
                    }
                  }}
                  title="Открыть заявку"
                >
                  {/* Job # */}
                  <td>
                    <div
                      className="cell-wrap num-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        openJob(job.id);
                      }}
                    >
                      {job.job_number || job.id}
                    </div>
                  </td>

                  {/* Клиент (имя + телефон) */}
                  <td>
                    <div className="cell-wrap">
                      {job.client_name}
                      {job.client_phone ? ` — ${job.client_phone}` : ''}
                    </div>
                  </td>

                  {/* Система (только просмотр) */}
                  <td className="col-system">
                    <div className="cell-wrap">{job.system_type || '—'}</div>
                  </td>

                  {/* Проблема (только просмотр) */}
                  <td>
                    <div className="cell-wrap">{job.issue || '—'}</div>
                  </td>

                  {/* SCF (editable) */}
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      value={job.scf ?? ''}
                      onChange={(e) => handleChange(job.id, 'scf', e.target.value)}
                      placeholder="—"
                    />
                  </td>

                  {/* Техник (editable select) */}
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      value={job.technician_id || ''}
                      onChange={(e) => handleChange(job.id, 'technician_id', e.target.value || null)}
                    >
                      <option value="">—</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Дата (только просмотр) */}
                  <td className="col-date">
                    <div className="cell-wrap">{job.created_at_fmt}</div>
                  </td>

                  {/* Статус (editable select) */}
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      value={job.status || ''}
                      onChange={(e) => handleChange(job.id, 'status', e.target.value)}
                    >
                      <option value="">—</option>
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Действия */}
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        title="Сохранить"
                        onClick={() => handleSave(job)}
                        disabled={savingId === job.id}
                      >
                        {savingId === job.id ? '…' : '💾'}
                      </button>
                      <button
                        title="Редактировать"
                        onClick={() => openJob(job.id)}
                      >
                        ✏️
                      </button>
                      <button
                        title="Инвойс"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/invoice/${job.id}`);
                        }}
                      >
                        📄
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {sortedJobs.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 10 }}>
                  Нет заявок
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

