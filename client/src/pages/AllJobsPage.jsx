// client/src/pages/JoAllJobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const JoAllJobsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]); // last snapshot from server
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [filterPaid, setFilterPaid] = useState('all'); // all | paid | unpaid
  const [searchText, setSearchText] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('active'); // active | warranty | archive

  const navigate = useNavigate();

  // Dropdown list (displayed labels). Values are strings we compare via normalizeStatus().
  const statuses = [
    'ReCall',
    'Diagnosis',
    'In progress',
    'Parts ordered',
    'Waiting for parts',
    'To finish',
    'Completed',
  ];

  // === Status normalization (RU/EN → EN canonical) ===
  const normalizeStatus = (val) => {
    const v = String(val ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'recall' || v === 'recal' || v === 'recаll' || v === 'rec all' || v === 'rec all' || v === 'rec all' || v === 'recal' || v === 'rec all' || v === 're cal' || v === 'recal' || v === 'recal' || v === 'recal' || v === 'rec all') return 'recall';
    if (v === 'recall' || v === 'recаll' || v === 'rec all' || v === 'rec-all' || v === 'recal' || v === 'rec all' || v === 're call' || v === 'recal' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'rec all' || v === 'recal' || v === 're call' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'recal' || v === 're call' || v === 're-call' || v === 'rec all' || v === 're call') return 'recall';
    // Short and robust mapping:
    if (v === 'recall' || v === 'reсall' || v === 'reсall' || v === 're call' || v === 're-call' || v === 're call' || v === 're-call' || v === 're cal' || v === 'recal' || v === 're call' || v === 're cal' || v === 'rec all' || v === 're call') return 'recall';
    // Russian / standard:
    if (v === 'recall' || v === 'reсall' || v === 're call' || v === 're-call' || v === 'recal' || v === 'rec all' || v === 'recall' || v === 're call' || v === 'rec all' || v === 'recal' || v === 'recal' || v === 're cal' || v === 're cal') return 'recall';
    // (The above guards against occasional typos; main ones below:)
    if (v === 'recall' || v === 'recal' || v === 're call' || v === 're-call' || v === 'rec all' || v === 'recall' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'rec all' || v === 'recal') return 'recall';
    if (v === 'recall' || v === 'ReCall'.toLowerCase()) return 'recall';

    if (v === 'диагностика' || v === 'diagnosis') return 'diagnosis';
    if (v === 'в работе' || v === 'in progress') return 'in progress';
    if (v === 'заказ деталей' || v === 'parts ordered') return 'parts ordered';
    if (v === 'ожидание деталей' || v === 'waiting for parts') return 'waiting for parts';
    if (v === 'к финишу' || v === 'to finish') return 'to finish';
    if (v === 'завершено' || v === 'выполнено' || v === 'completed') return 'completed';
    if (v === 'отменено' || v === 'отказ' || v === 'canceled' || v === 'cancelled') return 'canceled';
    return v;
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: j }, { data: t }, { data: c }] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
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

  /* ====== Payment helpers (same semantics as FinancePage) ====== */
  const methodChosen = (raw) => {
    const v = String(raw ?? '').trim().toLowerCase();
    return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
  };

  /* ====== Paid logic:
     (scf <= 0  OR (scf > 0 AND method chosen)) AND
     (labor <= 0 OR (labor > 0 AND method chosen)) */
  const isFullyPaidNow = (j) => {
    const scf = Number(j.scf || 0);
    const labor = Number(j.labor_price || 0);
    const scfOK = scf <= 0 || (scf > 0 && methodChosen(j.scf_payment_method));
    const laborOK = labor <= 0 || (labor > 0 && methodChosen(j.labor_payment_method));
    return scfOK && laborOK;
  };
  const isUnpaidNow = (j) => !isFullyPaidNow(j);

  // Highlight selects (amount > 0 but method not chosen)
  const needsScfPayment = (j) => Number(j.scf || 0) > 0 && !methodChosen(j.scf_payment_method);
  const needsLaborPayment = (j) => Number(j.labor_price || 0) > 0 && !methodChosen(j.labor_payment_method);

  /* ====== WARRANTY/ARCHIVE by DB snapshot (origJobs) ====== */
  const isDone = (s) => {
    const v = normalizeStatus(s);
    return v === 'completed';
  };
  const isRecall = (s) => normalizeStatus(s) === 'recall';

  const origById = (id) => origJobs.find((x) => x.id === id) || null;

  const persistedFullyPaid = (j) => {
    const o = origById(j.id) || j;
    const scfOK = Number(o.scf || 0) <= 0 || methodChosen(o.scf_payment_method);
    const laborOK = Number(o.labor_price || 0) <= 0 || methodChosen(o.labor_payment_method);
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
    return s ? new Date(s.getTime() + 60 * 24 * 60 * 60 * 1000) : null; // +60 days
  };
  const now = new Date();

  const persistedInWarranty = (j) => {
    const o = origById(j.id) || j;
    if (isRecall(o.status)) return false; // ReCall is always active
    return isDone(o.status) && persistedFullyPaid(j) && warrantyStart(j) && now <= warrantyEnd(j);
  };
  const persistedInArchiveByWarranty = (j) => {
    const o = origById(j.id) || j;
    if (isRecall(o.status)) return false;
    return isDone(o.status) && persistedFullyPaid(j) && warrantyStart(j) && now > warrantyEnd(j);
  };

  /* ====== Save ====== */
  const handleSave = async (job) => {
    const { id } = job;

    const prev = origById(id) || {};
    const wasDone = isDone(prev
