// client/src/pages/FinancePage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

const FinancePage = () => {
  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [filterSCF, setFilterSCF] = useState('all');
  const [filterLabor, setFilterLabor] = useState('all');
  const [filterTech, setFilterTech] = useState('all'); // храним как строку
  const [filterPeriod, setFilterPeriod] = useState('month');

  // ----- стили и фиксированные ширины -----
  const COL = {
    JOB: 80,
    TECH: 220,
    SCF: 100,
    SCF_PAY: 140,
    LABOR: 110,
    LABOR_PAY: 150,
    TOTAL: 120,
    SALARY: 140,
  };
  const TABLE_WIDTH =
    COL.JOB +
    COL.TECH +
    COL.SCF +
    COL.SCF_PAY +
    COL.LABOR +
    COL.LABOR_PAY +
    COL.TOTAL +
    COL.SALARY;

  const tableStyle = {
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    width: `${TABLE_WIDTH}px`,
  };
  const thStyle = (w, align = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: align,
    background: '#f5f5f5',
    fontWeight: 600,
  });
  const tdStyle = (w, align = 'left') => ({
    width: w,
    border: '1px solid #ccc',
    padding: '6px 8px',
    textAlign: align,
    verticalAlign: 'top',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  });
  const selectStyle = { width: '100%', padding: '6px 8px' };
  const inputStyle = { width: '100%', padding: '6px 8px' };
  const btn = { padding: '8px 12px', cursor: 'pointer' };

  const paymentOptions = ['Наличные', 'Zelle', 'Карта'];
  const periodOptions = [
    { label: 'Сегодня', value: 'day' },
    { label: 'Неделя', value: 'week' },
    { label: 'Месяц', value: 'month' },
    { label: 'Все', value: 'all' },
  ];

  useEffect(() => {
    fetchJobs();
    fetchTechnicians();
  }, []);

  const fetchJobs = async () => {
    const { data, error } = await supabase.from('jobs').select('*');
    if (error) console.error('Ошибка загрузки заявок:', error);
    else setJobs(data || []);
  };

  const fetchTechnicians = async () => {
    const { data, error } = await supabase.from('technicians').select('*');
    if (error) console.error('Ошибка загрузки техников:', error);
    else setTechnicians(data || []);
  };

  const getTechnicianName = (id) => {
    const tech = technicians.find((t) => String(t.id) === String(id));
    return tech ? tech.name : '—';
  };

  const now = dayjs();

  const inPeriod = (createdAt) => {
    if (!createdAt) return filterPeriod === 'all';
    const created = dayjs(createdAt);
    if (!created.isValid()) return filterPeriod === 'all';
    if (filterPeriod === 'all') return true;
    if (filterPeriod === 'day') return created.isAfter(now.subtract(1, 'day'));
    if (filterPeriod === 'week') return created.isAfter(now.subtract(7, 'day'));
    if (filterPeriod === 'month') return created.isAfter(now.subtract(1, 'month'));
    return true;
  };

  const filteredJobs = jobs.filter((job) => {
    const matchSCF = filterSCF === 'all' || job.scf_payment_method === filterSCF;
    const matchLabor = filterLabor === 'all' || job.labor_payment_method === filterLabor;
    const matchTech = filterTech === 'all' || String(job.technician_id) === String(filterTech);
    const matchPeriod = inPeriod(job.created_at);

    return matchSCF && matchLabor && matchTech && matchPeriod;
  });

  const formatMoney = (n) =>
    `$${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)}`;

  const handleExport = () => {
    const rows = filteredJobs.map((j) => ({
      'Job #': j.job_number || j.id,
      Техник: getTechnicianName(j.technician_id),
      SCF: Number(j.scf || 0),
      'Оплата SCF': j.scf_payment_method || '',
      'Стоимость работ': Number(j.labor_price || 0),
      'Оплата работы': j.labor_payment_method || '',
      Итого: Number(j.scf || 0) + Number(j.labor_price || 0),
      'Зарплата (50%)': Number(j.labor_price || 0) * 0.5,
      'Создано': j.created_at || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Финансы');
    XLSX.writeFile(wb, 'finance_export.xlsx');
  };

  const total = filteredJobs.reduce(
    (acc, j) => acc + Number(j.scf || 0) + Number(j.labor_price || 0),
    0
  );

  const technicianSalaries = technicians.map((tech) => {
    const jobsForTech = filteredJobs.filter(
      (j) => String(j.technician_id) === String(tech.id)
    );
    const salary = jobsForTech.reduce(
      (sum, j) => sum + Number(j.labor_price || 0) * 0.5,
      0
    );
    return { name: tech.name, total: salary };
  });

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>💰 Финансовый отчёт</h1>

      {/* Панель фильтров */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 16,
          maxWidth: TABLE_WIDTH,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
            Фильтр по SCF оплате
          </label>
          <select
            value={filterSCF}
            onChange={(e) => setFilterSCF(e.target.value)}
            style={selectStyle}
          >
            <option value="all">Все</option>
            {paymentOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
            Фильтр по оплате работы
          </label>
          <select
            value={filterLabor}
            onChange={(e) => setFilterLabor(e.target.value)}
            style={selectStyle}
          >
            <option value="all">Все</option>
            {paymentOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
            Отчёт за период
          </label>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            style={selectStyle}
          >
            {periodOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
            Фильтр по технику
          </label>
          <select
            value={filterTech}
            onChange={(e) => setFilterTech(e.target.value)}
            style={selectStyle}
          >
            <option value="all">Все</option>
            {technicians.map((tech) => (
              <option key={tech.id} value={String(tech.id)}>
                {tech.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Экспорт */}
      <div style={{ textAlign: 'right', maxWidth: TABLE_WIDTH, marginBottom: 10 }}>
        <button
          onClick={handleExport}
          style={{
            ...btn,
            background: '#16a34a',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
          }}
        >
          📤 Экспорт в Excel
        </button>
      </div>

      {/* Таблица с фиксированными колонками */}
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: COL.JOB }} />
            <col style={{ width: COL.TECH }} />
            <col style={{ width: COL.SCF }} />
            <col style={{ width: COL.SCF_PAY }} />
            <col style={{ width: COL.LABOR }} />
            <col style={{ width: COL.LABOR_PAY }} />
            <col style={{ width: COL.TOTAL }} />
            <col style={{ width: COL.SALARY }} />
          </colgroup>

          <thead>
            <tr>
              <th style={thStyle(COL.JOB)}>Job #</th>
              <th style={thStyle(COL.TECH)}>Техник</th>
              <th style={thStyle(COL.SCF, 'right')}>SCF</th>
              <th style={thStyle(COL.SCF_PAY)}>Оплата SCF</th>
              <th style={thStyle(COL.LABOR, 'right')}>Работа</th>
              <th style={thStyle(COL.LABOR_PAY)}>Оплата работы</th>
              <th style={thStyle(COL.TOTAL, 'right')}>Итого</th>
              <th style={thStyle(COL.SALARY, 'right')}>Зарплата (50%)</th>
            </tr>
          </thead>

          <tbody>
            {filteredJobs.map((j) => (
              <tr key={j.id}>
                <td style={tdStyle(COL.JOB)}>{j.job_number || j.id}</td>
                <td style={tdStyle(COL.TECH)}>{getTechnicianName(j.technician_id)}</td>
                <td style={tdStyle(COL.SCF, 'right')}>{formatMoney(j.scf || 0)}</td>
                <td style={tdStyle(COL.SCF_PAY)}>{j.scf_payment_method || '—'}</td>
                <td style={tdStyle(COL.LABOR, 'right')}>{formatMoney(j.labor_price || 0)}</td>
                <td style={tdStyle(COL.LABOR_PAY)}>{j.labor_payment_method || '—'}</td>
                <td style={{ ...tdStyle(COL.TOTAL, 'right'), fontWeight: 600 }}>
                  {formatMoney(Number(j.scf || 0) + Number(j.labor_price || 0))}
                </td>
                <td style={tdStyle(COL.SALARY, 'right')}>
                  {formatMoney(Number(j.labor_price || 0) * 0.5)}
                </td>
              </tr>
            ))}

            {filteredJobs.length === 0 && (
              <tr>
                <td style={tdStyle(TABLE_WIDTH)} colSpan={8}>
                  Нет данных для выбранных фильтров
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Итоги */}
      <div style={{ maxWidth: TABLE_WIDTH, marginTop: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Зарплата по техникам:
        </h2>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {technicianSalaries.map((t) => (
            <li key={t.name} style={{ fontSize: 14, marginBottom: 4 }}>
              {t.name}: <strong>{formatMoney(t.total)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ textAlign: 'right', maxWidth: TABLE_WIDTH, fontSize: 18, fontWeight: 700, marginTop: 8 }}>
        Общая сумма: {formatMoney(total)}
      </div>
    </div>
  );
};

export default FinancePage;

