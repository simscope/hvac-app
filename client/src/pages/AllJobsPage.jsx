// client/src/pages/JoAllJobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const JoAllJobsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]); // последний снимок с сервера
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [filterPaid, setFilterPaid] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('active'); // active | warranty | archive

  const navigate = useNavigate();

  const statuses = [
    'ReCall',
    'диагностика',
    'в работе',
    'заказ деталей',
    'ожидание деталей',
    'к финишу',
    'завершено',
  ];

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: j }, { data: t }, { data: c }] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('technicians').select('id, name, role').eq('role', 'tech'),
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
      c.address, c.address_line1, c.address_line2, c.street,
      c.city, c.state, c.region, c.zip, c.postal_code,
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

  /* ====== ОПЛАТЫ ====== */
  const needsScfPayment   = (j) => Number(j.scf || 0) > 0 && !j.payment_method;
  const needsLaborPayment = (j) => Number(j.labor_price || 0) > 0 && !j.labor_payment_method;
  const scfPaidOk         = (j) => Number(j.scf || 0) <= 0 || !!j.payment_method;
  const laborPaidOk       = (j) => Number(j.labor_price || 0) <= 0 || !!j.labor_payment_method;

  /* ====== ГАРАНТИЯ/АРХИВ считаем по СОХРАНЁННОМУ состоянию (origJobs) ====== */
  const isDone = (s) => {
    const v = String(s || '').toLowerCase().trim();
    return v === 'завершено' || v === 'выполнено';
  };
  const isRecall = (s) =>
    String(s || '').trim().toLowerCase() === 'recall' ||
    String(s || '').trim() === 'ReCall';

  const origById = (id) => origJobs.find((x) => x.id === id) || null;

  const persistedFullyPaid = (j) => {
    const o = origById(j.id) || j;
    const scfOK   = Number(o.scf || 0) <= 0 || !!o.payment_method;
    const laborOK = Number(o.labor_price || 0) <= 0 || !!o.labor_payment_method;
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
    return s ? new Date(s.getTime() + 60 * 24 * 60 * 60 * 1000) : null;
  };
  const now = new Date();

  const persistedInWarranty = (j) => {
    const o = origById(j.id) || j;
    if (isRecall(o.status)) return false; // ReCall всегда активный
    return isDone(o.status) && persistedFullyPaid(j) && warrantyStart(j) && now <= warrantyEnd(j);
  };
  const persistedInArchive = (j) => {
    const o = origById(j.id) || j;
    if (isRecall(o.status)) return false;
    return isDone(o.status) && persistedFullyPaid(j) && warrantyStart(j) && now > warrantyEnd(j);
  };

  const handleSave = async (job) => {
    const { id } = job;

    const prev = origById(id) || {};
    const wasDone    = isDone(prev.status);
    const willBeDone = isDone(job.status);

    const payload = {
      scf: job.scf !== '' && job.scf != null ? parseFloat(job.scf) : null,
      status: job.status ?? null,
      appointment_time: toISO(job.appointment_time),
      labor_price: job.labor_price !== '' && job.labor_price != null ? parseFloat(job.labor_price) : null,
      payment_method: job.payment_method ?? null,             // SCF
      labor_payment_method: job.labor_payment_method ?? null, // Работа
      system_type: job.system_type ?? null,
      issue: job.issue ?? null,
    };

    // при переходе в "завершено" фиксируем новую дату
    if (!wasDone && willBeDone) {
      payload.completed_at = new Date().toISOString();
    }

    let { error } = await supabase.from('jobs').update(payload).eq('id', id);

    if (error && String(error.message || '').toLowerCase().includes('completed_at')) {
      const { completed_at, ...withoutCompleted } = payload;
      ({ error } = await supabase.from('jobs').update(withoutCompleted).eq('id', id));
    }

    if (error) {
      console.error('Ошибка сохранения jobs:', error, payload);
      alert('Ошибка при сохранении');
      return;
    }
    await fetchAll();
    alert('Сохранено');
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
        Клиент: client?.name || client?.full_name || '',
        Телефон: client?.phone || '',
        Адрес: formatAddress(client),
        SCF: job.scf,
        'Оплата SCF': job.payment_method,
        Работа: job.labor_price,
        'Оплата работы': job.labor_payment_method,
        Статус: job.status,
        'Дата завершения': job.completed_at || '',
        Техник: tech?.name || '',
        Система: job.system_type,
        Проблема: job.issue,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jobs');
    XLSX.writeFile(wb, 'jobs.xlsx');
  };

  /* ====== Фильтрация/группировка ====== */
  const filteredJobs = useMemo(() => {
    return (jobs || [])
      .filter((j) => {
        const o = origById(j.id) || j;
        const recall = isRecall(o.status);
        if (viewMode === 'warranty') return !recall && persistedInWarranty(j);
        if (viewMode === 'archive')  return !recall && persistedInArchive(j);
        return recall || !(persistedInWarranty(j) || persistedInArchive(j));
      })
      .filter((j) =>
        filterStatus === 'all'
          ? true
          : (filterStatus === 'ReCall'
              ? isRecall(j.status)
              : j.status === filterStatus)
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
        if (filterPaid === 'paid')
          return (Number(j.scf || 0) <= 0 || !!j.payment_method) &&
                 (Number(j.labor_price || 0) <= 0 || !!j.labor_payment_method);
        if (filterPaid === 'unpaid')
          return (Number(j.scf || 0) > 0 && !j.payment_method) ||
                 (Number(j.labor_price || 0) > 0 && !j.labor_payment_method);
        return true;
      })
      .sort((a, b) => {
        const A = (a.job_number || a.id).toString();
        const B = (b.job_number || b.id).toString();
        return sortAsc ? A.localeCompare(B) : B.localeCompare(A);
      });
  }, [jobs, technicians, clients, filterStatus, filterTech, filterPaid, searchText, sortAsc, viewMode, origJobs]);

  const grouped = useMemo(() => {
    const g = {};
    filteredJobs.forEach((j) => {
      const key = j.technician_id || 'Без техника';
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
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }
      `}</style>

      <h1 className="text-2xl font-bold mb-4">📋 Все заявки</h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">Все статусы</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="all">Все техники</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <select value={filterPaid} onChange={(e) => setFilterPaid(e.target.value)}>
          <option value="all">Все оплаты</option>
          <option value="paid">Оплаченные</option>
          <option value="unpaid">Не оплаченные</option>
        </select>

        <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
          <option value="active">Активные</option>
          <option value="warranty">Гарантия</option>
          <option value="archive">Архив</option>
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Имя, телефон или адрес"
        />
        <button onClick={resetFilters}>🔄 Сбросить</button>
        <button onClick={handleExport}>📤 Экспорт в Excel</button>
        <button onClick={() => setSortAsc(!sortAsc)}>
          Сортировать Job # {sortAsc ? '↑' : '↓'}
        </button>
      </div>

      {loading && <p>Загрузка...</p>}

      {Object.entries(grouped).map(([techId, groupJobs]) => (
        <div key={techId} className="mb-6">
          <h2 className="text-lg font-semibold mb-1">
            {techId === 'Без техника'
              ? '🧾 Без техника'
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
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th>Адрес</th>
                  <th>Система</th>
                  <th>Проблема</th>
                  <th>SCF</th>
                  <th>Оплата SCF</th>
                  <th>Работа</th>
                  <th>Оплата работы</th>
                  <th>Статус</th>
                  <th className="center">✔</th>
                  <th className="center">💾</th>
                  <th className="center">✏️</th>
                  <th className="center">📄</th>
                </tr>
              </thead>

              <tbody>
                {groupJobs.map((job) => {
                  const client = getClient(job.client_id);

                  const scfError   = needsScfPayment(job);
                  const laborError = needsLaborPayment(job);

                  const rowClass = persistedInWarranty(job) ? 'warranty' : '';

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
                      })}
                      title="Открыть редактирование заявки"
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

                      <td><div className="cell-wrap">{client?.full_name || client?.name || '—'}</div></td>
                      <td><div className="cell-wrap">{client?.phone || '—'}</div></td>
                      <td><div className="cell-wrap">{formatAddress(client) || '—'}</div></td>
                      <td><div className="cell-wrap">{job.system_type || '—'}</div></td>
                      <td><div className="cell-wrap">{job.issue || '—'}</div></td>

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
                          value={job.payment_method || ''} // SCF
                          onChange={(e) => handleChange(job.id, 'payment_method', e.target.value || null)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">—</option>
                          <option value="Наличные">Наличные</option>
                          <option value="Zelle">Zelle</option>
                          <option value="Карта">Карта</option>
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
                          <option value="Наличные">Наличные</option>
                          <option value="Zelle">Zelle</option>
                          <option value="Карта">Карта</option>
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
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>

                      <td className="center">
                        {(scfPaidOk(job) && laborPaidOk(job)) ? '✔️' : ''}
                      </td>

                      <td className="center">
                        <button
                          title="Сохранить"
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
                          title="Редактировать"
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
                          title="Инвойс"
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
