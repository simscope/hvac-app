// client/src/pages/FinancePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

const FinancePage = () => {
  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [materialsSum, setMaterialsSum] = useState({}); // job_id -> sum(price*quantity)

  // Фильтры
  const [filterTech, setFilterTech] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('month');
  const [filterPaid, setFilterPaid] = useState('all'); // all | unpaid | paid

  // Массовая отметка
  const [selected, setSelected] = useState(new Set());

  // ----- стили -----
  const COL = {
    SEL: 36,
    JOB: 80,
    TECH: 190,
    STATUS: 160,
    SCF: 90,
    SCF_PAY: 120,
    LABOR: 100,
    LABOR_PAY: 120,
    MATERIALS: 100,
    TOTAL: 120,
    SALARY: 190,
    PAID: 130,
    ACTION: 150,
  };
  const TABLE_WIDTH =
    COL.SEL + COL.JOB + COL.TECH + COL.STATUS + COL.SCF + COL.SCF_PAY + COL.LABOR + COL.LABOR_PAY +
    COL.MATERIALS + COL.TOTAL + COL.SALARY + COL.PAID + COL.ACTION;

  const tableStyle = { tableLayout: 'fixed', borderCollapse: 'collapse', width: `${TABLE_WIDTH}px` };
  const thStyle = (w, align = 'left') => ({
    width: w, border: '1px solid #ccc', padding: '6px 8px', textAlign: align,
    background: '#f5f5f5', fontWeight: 600,
  });
  const tdStyle = (w, align = 'left') => ({
    width: w, border: '1px solid #ccc', padding: '6px 8px', textAlign: align,
    verticalAlign: 'top', whiteSpace: 'normal', wordBreak: 'break-word',
  });
  const selectStyle = { width: '100%', padding: '6px 8px' };
  const btn = { padding: '8px 12px', cursor: 'pointer', borderRadius: 6, border: 'none' };

  const periodOptions = [
    { label: 'Сегодня', value: 'day' },
    { label: 'Неделя', value: 'week' },
    { label: 'Месяц', value: 'month' },
    { label: 'Все', value: 'all' },
  ];
  const paidOptions = [
    { label: 'Все', value: 'all' },
    { label: 'Только невыплаченные', value: 'unpaid' },
    { label: 'Только выплаченные', value: 'paid' },
  ];

  // ===== helpers =====
  const normalizePaymentLabel = (raw) => {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v) return '—';
    if (['cash', 'наличные'].includes(v)) return 'Наличные';
    if (['zelle'].includes(v)) return 'Zelle';
    if (['card', 'карта'].includes(v)) return 'Карта';
    if (['check', 'чек'].includes(v)) return 'Чек';
    return String(raw);
  };
  const methodChosen = (raw) => String(raw ?? '').trim() !== '';
  const formatMoney = (n) => `$${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)}`;
  const getTechnicianName = (id) => {
    const tech = technicians.find((t) => String(t.id) === String(id));
    return tech ? tech.name : '—';
  };
  const collectStatuses = (j) => {
    const keys = ['status', 'job_status', 'state', 'stage', 'payment_status', 'warranty_status'];
    const vals = keys.map((k) => (j?.[k] ? String(j[k]).trim() : '')).filter(Boolean);
    return vals.length ? [...new Set(vals)].join(' • ') : '—';
  };

  // ===== load =====
  useEffect(() => { fetchAll(); }, []);
  const fetchAll = async () => {
    await Promise.all([fetchJobs(), fetchTechnicians(), fetchMaterialsSum()]);
    setSelected(new Set());
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

  const fetchMaterialsSum = async () => {
    const { data, error } = await supabase.from('materials').select('job_id, price, quantity');
    if (error) { console.error('Ошибка загрузки материалов:', error); setMaterialsSum({}); return; }
    const acc = {};
    (data || []).forEach((m) => {
      const jid = m.job_id;
      const price = Number(m.price || 0);
      const qty = Number(m.quantity || 0);
      acc[jid] = (acc[jid] || 0) + price * qty;
    });
    setMaterialsSum(acc);
  };

  // ===== filters =====
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

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const byTech = filterTech === 'all' || String(job.technician_id) === String(filterTech);
      const byPeriod = inPeriod(job.created_at);
      const byPaid =
        filterPaid === 'all' ||
        (filterPaid === 'paid' && job.salary_paid) ||
        (filterPaid === 'unpaid' && !job.salary_paid);
      return byTech && byPeriod && byPaid;
    });
  }, [jobs, filterTech, filterPeriod, filterPaid]);

 // ===== row math =====
// Учитываем только суммы с выбранным способом оплаты.
// Зарплата =
//   если payLabor == 0 и payScf > 0 -> 50
//   иначе 50% * max(0, (payLabor + payScf - materials))
const calcRow = (j) => {
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);
  const materials = Number(materialsSum[j.id] || 0);

  const payLabor = String(j.labor_payment_method || '').trim() ? labor : 0;
  const payScf   = String(j.scf_payment_method || '').trim()   ? scf   : 0;

  const onlyScf = payLabor === 0 && payScf > 0;

  const base = payLabor + payScf - materials;
  const salary = onlyScf ? 50 : 0.5 * Math.max(0, base);

  // "Итого (только с оплатой)" по строке — без деталей
  const totalCounted = payLabor + payScf;

  return { scf, labor, materials, total: totalCounted, salary, scfPart: onlyScf ? 50 : payScf };
};

  // ===== money report =====
  // Учитываем только суммы, где выбран способ оплаты.
  const moneyReport = useMemo(() => {
    const buckets = { 'Наличные': 0, 'Zelle': 0, 'Чек': 0, 'Карта': 0, 'Другое': 0 };
    filteredJobs.forEach((j) => {
      const { scf, labor } = calcRow(j);
      if (methodChosen(j.scf_payment_method) && scf > 0) {
        const label = normalizePaymentLabel(j.scf_payment_method);
        if (buckets[label] !== undefined) buckets[label] += scf; else buckets['Другое'] += scf;
      }
      if (methodChosen(j.labor_payment_method) && labor > 0) {
        const label = normalizePaymentLabel(j.labor_payment_method);
        if (buckets[label] !== undefined) buckets[label] += labor; else buckets['Другое'] += labor;
      }
    });
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    return { buckets, total };
  }, [filteredJobs]);

  // ===== export =====
  const handleExport = () => {
    const rows = filteredJobs.map((j) => {
      const { scf, labor, materials, total, salary, scfPart } = calcRow(j);
      return {
        'Job #': j.job_number || j.id,
        'Техник': getTechnicianName(j.technician_id),
        'Статусы': collectStatuses(j),
        'SCF': scf,
        'Оплата SCF': normalizePaymentLabel(j.scf_payment_method),
        'Работа': labor,
        'Оплата работы': normalizePaymentLabel(j.labor_payment_method),
        'Детали (сумма)': materials,
        'Итого (SCF+Работа)': total,
        'Зарплата (0.5*Раб + SCF|50 - Детали)': salary,
        'Счётная часть SCF для ЗП': scfPart,
        'Выплачено': j.salary_paid ? 'Да' : 'Нет',
        'Дата выплаты': j.salary_paid_at || '',
        'Кто выплатил': j.salary_paid_by || '',
        'Сумма выплаты (снапшот)': Number(j.salary_paid_amount || 0),
        'Создано': j.created_at || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Финансы');
    XLSX.writeFile(wb, 'finance_export.xlsx');
  };

  // ===== pay flow =====
  const getCurrentUserName = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.email || user?.user_metadata?.name || 'system';
    } catch {
      return 'system';
    }
  };

  const markPaid = async (job) => {
    const { salary } = calcRow(job);
    const paid_by = await getCurrentUserName();
    const patch = {
      salary_paid: true,
      salary_paid_at: new Date().toISOString(),
      salary_paid_by: paid_by,
      salary_paid_amount: salary,
    };
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
    if (error) { console.error('Не удалось пометить как выплаченное:', error); return; }
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...patch } : j)));
  };

  const unmarkPaid = async (job) => {
    const patch = {
      salary_paid: false,
      salary_paid_at: null,
      salary_paid_by: null,
      salary_paid_amount: null,
    };
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
    if (error) { console.error('Не удалось отменить выплату:', error); return; }
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...patch } : j)));
  };

  const bulkPay = async (ids) => {
    const paid_by = await getCurrentUserName();
    const patches = {};
    filteredJobs.forEach((j) => {
      if (!ids.has(j.id)) return;
      const { salary } = calcRow(j);
      patches[j.id] = {
        salary_paid: true,
        salary_paid_at: new Date().toISOString(),
        salary_paid_by: paid_by,
        salary_paid_amount: salary,
      };
    });
    for (const id of ids) {
      const patch = patches[id];
      if (!patch) continue;
      const { error } = await supabase.from('jobs').update(patch).eq('id', id);
      if (error) console.error('Ошибка массовой выплаты id=', id, error);
    }
    setJobs((prev) => prev.map((j) => (ids.has(j.id) ? { ...j, ...patches[j.id] } : j)));
    setSelected(new Set());
  };

  const bulkUnpay = async (ids) => {
    const patch = {
      salary_paid: false,
      salary_paid_at: null,
      salary_paid_by: null,
      salary_paid_amount: null,
    };
    for (const id of ids) {
      const { error } = await supabase.from('jobs').update(patch).eq('id', id);
      if (error) console.error('Ошибка отмены выплаты id=', id, error);
    }
    setJobs((prev) => prev.map((j) => (ids.has(j.id) ? { ...j, ...patch } : j)));
    setSelected(new Set());
  };

  // ===== selection =====
  const allVisibleIds = useMemo(() => new Set(filteredJobs.map((j) => j.id)), [filteredJobs]);
  const allVisibleSelected = useMemo(
    () => filteredJobs.length > 0 && filteredJobs.every((j) => selected.has(j.id)),
    [filteredJobs, selected]
  );
  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      const next = new Set(selected);
      filteredJobs.forEach((j) => next.delete(j.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filteredJobs.forEach((j) => next.add(j.id));
      setSelected(next);
    }
  };
  const toggleRow = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  // ===== totals =====
  // Общая сумма «денег» учитывает только строки с выбранным способом оплаты
  const overallTotal = useMemo(() => {
    return filteredJobs.reduce((acc, j) => {
      const { scf, labor } = calcRow(j);
      const scfAdd = methodChosen(j.scf_payment_method) ? scf : 0;
      const laborAdd = methodChosen(j.labor_payment_method) ? labor : 0;
      return acc + scfAdd + laborAdd;
    }, 0);
  }, [filteredJobs]);

  const selectedSalarySum = useMemo(() => {
    return filteredJobs.reduce((acc, j) => {
      if (!selected.has(j.id)) return acc;
      const { salary } = calcRow(j);
      return acc + salary;
    }, 0);
  }, [filteredJobs, selected]);

  const selectedPaidCount = useMemo(() => {
    let paid = 0, unpaid = 0;
    filteredJobs.forEach((j) => {
      if (!selected.has(j.id)) return;
      if (j.salary_paid) paid++; else unpaid++;
    });
    return { paid, unpaid, total: paid + unpaid };
  }, [filteredJobs, selected]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>💰 Финансовый отчёт</h1>

      {/* Панель фильтров */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 12,
          maxWidth: TABLE_WIDTH,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Отчёт за период</label>
          <select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} style={selectStyle}>
            {periodOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Фильтр по технику</label>
          <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)} style={selectStyle}>
            <option value="all">Все</option>
            {technicians.map((tech) => <option key={tech.id} value={String(tech.id)}>{tech.name}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Статус выплат</label>
          <select value={filterPaid} onChange={(e) => setFilterPaid(e.target.value)} style={selectStyle}>
            {paidOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {/* Управление + Экспорт */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: TABLE_WIDTH, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => bulkPay(selected)}
            disabled={[...selected].filter((id) => allVisibleIds.has(id)).length === 0}
            style={{ ...btn, background: '#2563eb', color: '#fff' }}
          >
            Выплатить выбранным
          </button>
        </div>

        <button onClick={handleExport} style={{ ...btn, background: '#16a34a', color: '#fff' }}>
          📤 Экспорт в Excel
        </button>
      </div>

      {/* Таблица */}
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: COL.SEL }} />
            <col style={{ width: COL.JOB }} />
            <col style={{ width: COL.TECH }} />
            <col style={{ width: COL.STATUS }} />
            <col style={{ width: COL.SCF }} />
            <col style={{ width: COL.SCF_PAY }} />
            <col style={{ width: COL.LABOR }} />
            <col style={{ width: COL.LABOR_PAY }} />
            <col style={{ width: COL.MATERIALS }} />
            <col style={{ width: COL.TOTAL }} />
            <col style={{ width: COL.SALARY }} />
            <col style={{ width: COL.PAID }} />
            <col style={{ width: COL.ACTION }} />
          </colgroup>

          <thead>
            <tr>
              <th style={thStyle(COL.SEL, 'center')}>
                <input
                  type="checkbox"
                  checked={filteredJobs.length > 0 && filteredJobs.every((j) => selected.has(j.id))}
                  onChange={() => {
                    if (filteredJobs.length > 0 && filteredJobs.every((j) => selected.has(j.id))) {
                      const next = new Set(selected);
                      filteredJobs.forEach((j) => next.delete(j.id));
                      setSelected(next);
                    } else {
                      const next = new Set(selected);
                      filteredJobs.forEach((j) => next.add(j.id));
                      setSelected(next);
                    }
                  }}
                />
              </th>
              <th style={thStyle(COL.JOB)}>Job #</th>
              <th style={thStyle(COL.TECH)}>Техник</th>
              <th style={thStyle(COL.STATUS)}>Статусы</th>
              <th style={thStyle(COL.SCF, 'right')}>SCF</th>
              <th style={thStyle(COL.SCF_PAY)}>Оплата SCF</th>
              <th style={thStyle(COL.LABOR, 'right')}>Работа</th>
              <th style={thStyle(COL.LABOR_PAY)}>Оплата работы</th>
              <th style={thStyle(COL.MATERIALS, 'right')}>Детали</th>
              <th style={thStyle(COL.TOTAL, 'right')}>Итого (только с оплатой)</th>
              <th style={thStyle(COL.SALARY, 'right')}>Зарплата (0.5*Раб + SCF|50 − Детали)</th>
              <th style={thStyle(COL.PAID, 'center')}>Выплачено</th>
              <th style={thStyle(COL.ACTION, 'center')}>Действие</th>
            </tr>
          </thead>

          <tbody>
            {filteredJobs.map((j) => {
              const { scf, labor, materials, salary } = calcRow(j);
              const paid = !!j.salary_paid;

              const totalCounted =
                (methodChosen(j.scf_payment_method) ? scf : 0) +
                (methodChosen(j.labor_payment_method) ? labor : 0);

              return (
                <tr key={j.id} style={{ background: paid ? '#ecfdf5' : 'transparent' }}>
                  <td style={{ ...tdStyle(COL.SEL, 'center') }}>
                    <input type="checkbox" checked={selected.has(j.id)} onChange={() => {
                      const next = new Set(selected);
                      if (next.has(j.id)) next.delete(j.id); else next.add(j.id);
                      setSelected(next);
                    }} />
                  </td>
                  <td style={tdStyle(COL.JOB)}>{j.job_number || j.id}</td>
                  <td style={tdStyle(COL.TECH)}>{getTechnicianName(j.technician_id)}</td>
                  <td style={tdStyle(COL.STATUS)}>{collectStatuses(j)}</td>

                  <td style={tdStyle(COL.SCF, 'right')}>{formatMoney(scf)}</td>
                  <td style={tdStyle(COL.SCF_PAY)}>{normalizePaymentLabel(j.scf_payment_method)}</td>

                  <td style={tdStyle(COL.LABOR, 'right')}>{formatMoney(labor)}</td>
                  <td style={tdStyle(COL.LABOR_PAY)}>{normalizePaymentLabel(j.labor_payment_method)}</td>

                  <td style={tdStyle(COL.MATERIALS, 'right')}>{formatMoney(materials)}</td>
                  <td style={{ ...tdStyle(COL.TOTAL, 'right'), fontWeight: 600 }}>
                    {formatMoney(totalCounted)}
                  </td>
                  <td style={tdStyle(COL.SALARY, 'right')}>
                    {paid && Number(j.salary_paid_amount) > 0
                      ? `${formatMoney(j.salary_paid_amount)} (снапшот)`
                      : formatMoney(salary)}
                  </td>
                  <td style={{ ...tdStyle(COL.PAID, 'center') }}>
                    {paid ? (
                      <div style={{ display: 'grid', gap: 2 }}>
                        <strong>Да</strong>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>
                          {j.salary_paid_at ? dayjs(j.salary_paid_at).format('YYYY-MM-DD HH:mm') : ''}
                        </span>
                        {j.salary_paid_by && (
                          <span style={{ fontSize: 12, color: '#6b7280' }}>{j.salary_paid_by}</span>
                        )}
                      </div>
                    ) : (
                      'Нет'
                    )}
                  </td>
                  <td style={{ ...tdStyle(COL.ACTION, 'center') }}>
                    {!paid ? (
                      <button
                        onClick={() => markPaid(j)}
                        style={{ ...btn, background: '#2563eb', color: '#fff' }}
                      >
                        Выплатил зарплату
                      </button>
                    ) : (
                      <button
                        onClick={() => unmarkPaid(j)}
                        style={{ ...btn, background: '#f59e0b', color: '#111827' }}
                      >
                        Отменить выплату
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {filteredJobs.length === 0 && (
              <tr>
                <td style={tdStyle(TABLE_WIDTH)} colSpan={13}>Нет данных для выбранных фильтров</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Отчёт по деньгам */}
      <div style={{ maxWidth: TABLE_WIDTH, marginTop: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Отчёт по деньгам (учитываются только строки с выбранным способом оплаты):</h2>
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
        Общая сумма (SCF + Работа, только где выбран способ оплаты): {formatMoney(moneyReport.total)}
      </div>

      {/* Сумма зарплат по отмеченным */}
      <div style={{ textAlign: 'right', maxWidth: TABLE_WIDTH, fontSize: 18, marginTop: 12 }}>
        <strong>Зарплата техника (отмеченные): {formatMoney(selectedSalarySum)}</strong>
      </div>
    </div>
  );
};

export default FinancePage;

