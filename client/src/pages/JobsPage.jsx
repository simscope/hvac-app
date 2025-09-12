// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import { supabase } from '../supabaseClient';

const STATUS_ORDER = [
  'recall',
  'диагностика',
  'в работе',
  'заказ деталей',
  'ожидание деталей',
  'к финишу',
  'завершено',
];

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);
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
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
      d.getMinutes()
    )}`;
  };

  // Подмешаем имя клиента, телефон и т.п. для таблицы
  const jobsView = useMemo(() => {
    return (jobs || []).map((j) => {
      const c = clients.find((x) => x.id === j.client_id);
      return {
        ...j,
        client_name: c?.full_name || c?.name || '—',
        client_phone: c?.phone || '',
        created_at_fmt: fmtDate(j.created_at),
      };
    });
  }, [jobs, clients]);

  // сортировка: по статусу (по приоритету) + новее сверху
  const orderMap = useMemo(() => new Map(STATUS_ORDER.map((s, i) => [s, i])), []);
  const sortedJobs = useMemo(() => {
    return [...jobsView].sort((a, b) => {
      const ar = orderMap.has(String(a.status).toLowerCase())
        ? orderMap.get(String(a.status).toLowerCase())
        : 999;
      const br = orderMap.has(String(b.status).toLowerCase())
        ? orderMap.get(String(b.status).toLowerCase())
        : 999;
      if (ar !== br) return ar - br;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [jobsView, orderMap]);

  const openJob = (jobId) => navigate(`/job/${jobId}`);

  return (
    <div className="p-4">
      {/* Стили совпадают с «Все заявки», плюс адаптивные скрытия колонок на телефоне */}
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .row-click { cursor:pointer; }
        .row-click:hover { background:#f9fafb; }

        /* Адаптивность:
           - скрываем менее важные колонки на небольших экранах
           - сделано классами, чтобы было прозрачно и управляемо
        */
        @media (max-width: 1024px) {
          .col-system, .col-date { display:none; }
        }
        @media (max-width: 820px) {
          .col-scf, .col-status { display:none; }
        }
        @media (max-width: 640px) {
          .col-tech { display:none; }
        }
      `}</style>

      {/* форма добавления заявки оставляем как есть */}
      <CreateJob onCreated={fetchAll} />

      <div className="overflow-x-auto" style={{ marginTop: 16 }}>
        <table className="jobs-table">
          <colgroup>
            <col style={{ width: 70 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 120 }} className="col-system" />
            <col style={{ width: 300 }} />
            <col style={{ width: 90 }} className="col-scf" />
            <col style={{ width: 150 }} className="col-tech" />
            <col style={{ width: 160 }} className="col-date" />
            <col style={{ width: 140 }} className="col-status" />
            <col style={{ width: 120 }} />
          </colgroup>

          <thead>
            <tr>
              <th>Job #</th>
              <th>Клиент</th>
              <th className="col-system">Система</th>
              <th>Проблема</th>
              <th className="col-scf">SCF</th>
              <th className="col-tech">Техник</th>
              <th className="col-date">Дата</th>
              <th className="col-status">Статус</th>
              <th>Действия</th>
            </tr>
          </thead>

          <tbody>
            {sortedJobs.map((job) => {
              const tech = technicians.find((t) => String(t.id) === String(job.technician_id));
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

                  <td>
                    <div className="cell-wrap">
                      {job.client_name}
                      {job.client_phone ? ` — ${job.client_phone}` : ''}
                    </div>
                  </td>

                  <td className="col-system">
                    <div className="cell-wrap">{job.system_type || '—'}</div>
                  </td>

                  <td>
                    <div className="cell-wrap">{job.issue || '—'}</div>
                  </td>

                  <td className="col-scf">
                    <div className="cell-wrap">{job.scf ?? '—'}</div>
                  </td>

                  <td className="col-tech">
                    <div className="cell-wrap">{tech?.name || '—'}</div>
                  </td>

                  <td className="col-date">
                    <div className="cell-wrap">{job.created_at_fmt}</div>
                  </td>

                  <td className="col-status">
                    <div className="cell-wrap">{job.status || '—'}</div>
                  </td>

                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        title="Редактировать"
                        onClick={(e) => {
                          e.stopPropagation();
                          openJob(job.id);
                        }}
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
