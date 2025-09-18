// client/src/pages/FinancePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

const FinancePage = () => {
  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [materialsSum, setMaterialsSum] = useState({}); // job_id -> sum(price*quantity)

  const [filterTech, setFilterTech] = useState('all'); // строка
  const [filterPeriod, setFilterPeriod] = useState('month');

  // ----- стили и фиксированные ширины -----
  const COL = {
    JOB: 80,
    TECH: 220,
    SCF: 90,
    LABOR: 110,
    MATERIALS: 110,
    TOTAL: 120,
    SALARY: 160,
    PAID: 110,
    ACTION: 170,
  };
  const TABLE_WIDTH =
    COL.JOB +
    COL.TECH +
    COL.SCF +
    COL.LABOR +
    COL.MATERIALS +
    COL.TOTAL +
    COL.SALARY +
    COL.PAID +
    COL.ACTION;

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
  const btn = { padding: '8px 12px', cursor: 'pointer', borderRadius: 6, border: 'none' };

  const periodOptions = [
    { label: 'Сегодня', value: 'day' },
    { label: 'Неделя', value: 'week' },
    { label: 'Месяц', value: 'month' },
    { label: 'Все', value: 'all' },
  ];

  // ===== Загрузка =====
  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    await Promise.all([fetchJobs(), fetchTechnicians(), fetchMaterialsSum()]);
  };

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

  // Считаем сумму деталей по каждой заявке: sum(price * quantity)
  const fetchMaterialsSum = async () => {
    const { data, error } = await supabase
      .from('materials')
      .select('job_id, price, quantity');

    if (error) {
      console.error('Ошибка загрузки материалов:', error);
      setMaterialsSum({});
      return;
    }

    const acc = {};
    (data || []).forEach((m) => {
      const jid = m.job_id;
      const price = Number(m.price || 0);
      const qty = Number(m.quantity || 0);
      const total = price * qty;
      acc[jid] = (acc[jid] || 0) + total;
    });
    setMaterialsSum(acc);
  };

  // ===== Утилиты =====
  const getTechnicianName = (id) => {
    const tech = technicians.find((t) => String(t.id) === String(id));
    return tech ? tech.name : '—';
  };

  const formatMoney = (n) =>
    `$${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)}`;

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

  // ===== Фильтрация =====
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchTech = filterTech === 'all' || String(job.technician_id) === String(filterTech);
      const matchPeriod = inPeriod(job.created_at);
      return matchTech && matchPeriod;
    });
  }, [jobs, filterTech, filterPeriod]);

  // ===== Расчёты по строке =====
  const calcRow = (j) => {
    const scf = Number(j.scf || 0);
    const labor = Number(j.labor_price || 0);
    const materials = Number(materialsSum[j.id] || 0);
    const total = scf + labor;
    const salary = labor * 0.5 + 50 - materials; // Новая формула
    return { scf, labor, materials, total, salary };
  };

  // ===== Деньги по методам оплаты (SCF + Работа) =====
  const moneyReport = useMemo(() => {
    const buckets = {
      'Наличные': 0,
      'Zelle': 0,
      'Чек': 0,
      'Карта': 0,
      'Другое': 0,
    };

    filteredJobs.forEach((j) => {
      // SCF
      const scf = Number(j.scf || 0);
      const scfMethod = (j.scf_payment_method || '').trim();
      if (scf) {
        if (buckets.hasOwnProperty(scfMethod)) buckets[scfMethod] += scf;
        else buckets['Другое'] += scf;
      }
      // Работа
      const labor = Number(j.labor_price || 0);
      const laborMethod = (j.labor_payment_method || '').trim();
      if (labor) {
        if (buckets.hasOwnProperty(laborMethod)) buckets[laborMethod] += labor;
        else buckets['Другое'] += labor;
      }
    });

    const total =
      buckets['Наличные'] +
      buckets['Zelle'] +
      buckets['Чек'] +
      buckets['Карта'] +
      buckets['Другое'];

    return { buckets, total };
  }, [filteredJobs]);

  // ===== Экспорт =====
  const handleExport = () => {
    const rows = filteredJobs.map((j) => {
      const { scf, labor, materials, total, salary } = calcRow(j);
      return {
        'Job #': j.job_number || j.id,
        'Техник': getTechnicianName(j.technician_id),
        'SCF': scf,
        'Оплата SCF': j.scf_payment_method || '',
        'Работа': labor,
        'Оплата работы': j.labor_payment_method || '',
        'Детали (сумма)': materials,
        'Итого (SCF+Работа)': total,
        'Зарплата (0.5*Работа + 50 - Детали)': salary,
        'Выплачено': j.salary_paid ? 'Да' : 'Нет',
        'Создано': j.created_at || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Финансы');
    XLSX.writeFile(wb, 'finance_export.xlsx');
  };

  // ===== Маркировка «зарплата выплачена» =====
  const markSalaryPaid = async (jobId) => {
    const { error } = await supabase
      .from('jobs')
      .update({ salary_paid: true, salary_paid_at: new Date().toISOString() })
      .eq('id', jobId);

    if (error) {
      console.error('Не удалось пометить как выплаченное:', error);
      return;
    }
    // Оптимистично обновляем состояние
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, salary_paid: true, salary_paid_at: new Date().toISOString() } : j))
    );
  };

  // ===== Итог общих сумм (SCF + Работа) =====
  const overallTotal = useMemo(() => {
    return filteredJobs.reduce((acc, j) => {
      const { scf, labor } = calcRow(j);
      return acc + scf + labor;
    }, 0);
  }, [filteredJobs]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>💰 Финансовый отчёт</h1>

      {/* Панель фильтров (только период и техник) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 16,
          maxWidth: TABLE_WIDTH,
        }}
      >
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
          style={{ ...btn, background: '#16a34a', color: '#fff' }}
        >
          📤 Экспорт в Excel
        </button>
      </div>

      {/* Таблица */}
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: COL.JOB }} />
            <col style={{ width: COL.TECH }} />
            <col style={{ width: COL.SCF }} />
            <col style={{ width: COL.LABOR }} />
            <col style={{ width: COL.MATERIALS }} />
            <col style={{ width: COL.TOTAL }} />
            <col style={{ width: COL.SALARY }} />
            <col style={{ width: COL.PAID }} />
            <col style={{ width: COL.ACTION }} />
          </colgroup>

          <thead>
            <tr>
              <th style={thStyle(COL.JOB)}>Job #</th>
              <th style={thStyle(COL.TECH)}>Техник</th>
              <th style={thStyle(COL.SCF, 'right')}>SCF</th>
              <th style={thStyle(COL.LABOR, 'right')}>Работа</th>
              <th style={thStyle(COL.MATERIALS, 'right')}>Детали</th>
              <th style={thStyle(COL.TOTAL, 'right')}>Итого (SCF+Работа)</th>
              <th style={thStyle(COL.SALARY, 'right')}>Зарплата (0.5*Раб + 50 - Детали)</th>
              <th style={thStyle(COL.PAID, 'center')}>Выплачено</th>
              <th style={thStyle(COL.ACTION, 'center')}>Действие</th>
            </tr>
          </thead>

          <tbody>
            {filteredJobs.map((j) => {
              const { scf, labor, materials, total, salary } = calcRow(j);
              const paid = !!j.salary_paid;
              return (
                <tr
                  key={j.id}
                  style={{
                    background: paid ? '#ecfdf5' : 'transparent', // зелёный оттенок для выплаченных
                  }}
                >
                  <td style={tdStyle(COL.JOB)}>{j.job_number || j.id}</td>
                  <td style={tdStyle(COL.TECH)}>{getTechnicianName(j.technician_id)}</td>
                  <td style={tdStyle(COL.SCF, 'right')}>{formatMoney(scf)}</td>
                  <td style={tdStyle(COL.LABOR, 'right')}>{formatMoney(labor)}</td>
                  <td style={tdStyle(COL.MATERIALS, 'right')}>{formatMoney(materials)}</td>
                  <td style={{ ...tdStyle(COL.TOTAL, 'right'), fontWeight: 600 }}>
                    {formatMoney(total)}
                  </td>
                  <td style={tdStyle(COL.SALARY, 'right')}>
                    {formatMoney(salary)}
                  </td>
                  <td style={{ ...tdStyle(COL.PAID, 'center'), fontWeight: 600 }}>
                    {paid ? 'Да' : 'Нет'}
                  </td>
                  <td style={{ ...tdStyle(COL.ACTION, 'center') }}>
                    {!paid ? (
                      <button
                        onClick={() => markSalaryPaid(j.id)}
                        style={{ ...btn, background: '#2563eb', color: '#fff' }}
                        title="Пометить как выплаченное"
                      >
                        Выплатил зарплату
                      </button>
                    ) : (
                      <span style={{ color: '#16a34a' }}>✔ Выплачено</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {filteredJobs.length === 0 && (
              <tr>
                <td style={tdStyle(TABLE_WIDTH)} colSpan={9}>
                  Нет данных для выбранных фильтров
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Отчёт по деньгам */}
      <div style={{ maxWidth: TABLE_WIDTH, marginTop: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Отчёт по деньгам (SCF + Работа):
        </h2>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', lineHeight: '1.9' }}>
          <li>Наличные: <strong>{formatMoney(moneyReport.buckets['Наличные'])}</strong></li>
          <li>Zelle: <strong>{formatMoney(moneyReport.buckets['Zelle'])}</strong></li>
          <li>Чек: <strong>{formatMoney(moneyReport.buckets['Чек'])}</strong></li>
          <li>Карта: <strong>{formatMoney(moneyReport.buckets['Карта'])}</strong></li>
          {moneyReport.buckets['Другое'] > 0 && (
            <li>Другое: <strong>{formatMoney(moneyReport.buckets['Другое'])}</strong></li>
          )}
        </ul>
      </div>

      <div style={{ textAlign: 'right', maxWidth: TABLE_WIDTH, fontSize: 18, fontWeight: 700, marginTop: 8 }}>
        Общая сумма (SCF + Работа): {formatMoney(moneyReport.total)}
      </div>

      <div style={{ textAlign: 'right', maxWidth: TABLE_WIDTH, fontSize: 16, marginTop: 4, color: '#6b7280' }}>
        Для справки (та же сумма): {formatMoney(overallTotal)}
      </div>
    </div>
  );
};

export default FinancePage;
