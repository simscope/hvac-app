// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromInputDate = (s) => {
  if (!s) return new Date();
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const formatHuman = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const N = (v) => Number(v || 0);
const T = (v) => String(v ?? '').trim();
const clean = (v) => {
  const s = T(v);
  return s && s.toLowerCase() !== 'empty' ? s : '';
};
const pick = (o = {}, keys = []) => {
  for (const k of keys) {
    const v = clean(o[k]);
    if (v) return v;
  }
  return '';
};
function composeAddress(o = {}) {
  const parts = [
    o.address,
    o.address_line1,
    o.address_line2,
    o.street,
    o.street1,
    o.street2,
    o.city,
    o.state,
    o.region,
    o.zip,
    o.postal_code,
  ]
    .map(clean)
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}
async function loadLogoDataURL(timeoutMs = 2500) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch('/logo_invoice_header.png', { cache: 'force-cache', signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('logo fetch failed');
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ---------- inline styles ---------- */
const S = {
  page: { maxWidth: 920, margin: '0 auto', padding: 16 },
  h1: { fontWeight: 800, fontSize: 24, margin: '4px 0 14px' },
  input: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' },
  select: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%', height: 36 },
  card: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  muted: { color: '#6b7280' },
  btn: { padding: '9px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' },
  primary: { padding: '10px 16px', borderRadius: 10, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer' },
  ghost: { padding: '9px 14px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#f8fafc', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', padding: 8 },
  td: { borderBottom: '1px solid #f1f5f9', padding: 6 },
};

export default function InvoicePage() {
  const { id } = useParams(); // job id (может быть undefined)

  // Общие состояния
  const [saving, setSaving] = useState(false);
  const [logoDataURL, setLogoDataURL] = useState(null);

  // Заявка/клиент
  const [job, setJob] = useState(null);

  // Bill To
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  // Строки/итоги
  const [rows, setRows] = useState([
    { type: 'service', name: 'Labor', qty: 1, price: 0 },
    { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
  ]);
  const [discount, setDiscount] = useState(0);

  // Номер/дата/гарантия
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  /* ---------- фоновые подгрузки ---------- */
  useEffect(() => {
    loadLogoDataURL().then((d) => setLogoDataURL(d || null));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 1) Заявка
      let j = null;
      if (id) {
        try {
          const { data } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
          if (!alive) return;
          j = data || null;
          setJob(j);
        } catch {
          /* ignore */
        }
      }

      // 2) Подставляем базовые строки из заявки (не блокирует)
      if (j) {
        setRows([
          { type: 'service', name: 'Labor', qty: 1, price: N(j?.labor_price) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: N(j?.scf) },
        ]);
      }

      // 3) Bill To — сначала из заявки (чтобы форма не была пустой)
    let clientData = null;
        if (j.client_id) {
          const { data: c, error: ec } = await supabase
            .from('clients')
            .select('*')
            .eq('id', j.client_id)
            .maybeSingle();
          if (!ec && c) clientData = c;
        }
        if (!clientData) {
          clientData = {
            full_name: j.client_name || j.full_name || '',
            phone: j.client_phone || j.phone || '',
            email: j.client_email || j.email || '',
            address: j.client_address || j.address || '',
          };
        }
        if (!alive) return;
        setClient(clientData);
      );

      // 4) Если у заявки есть client_id — пробуем забрать настоящего клиента и ПЕРЕЗАПИСАТЬ Bill To
      if (j?.client_id) {
        try {
          const { data: c } = await supabase
            .from('clients')
            .select('full_name,name,phone,email,address,address_line1,address_line2,street,city,state,zip,postal_code')
            .eq('id', j.client_id)
            .maybeSingle();

          if (!alive) return;

          if (c) {
            setBillName(pick(c, ['full_name', 'name']) || billName);
            setBillPhone(pick(c, ['phone']) || billPhone);
            setBillEmail(pick(c, ['email']) || billEmail);
            const addr = composeAddress(c);
            if (addr) setBillAddress(addr);
          }
        } catch {
          /* ignore */
        }
      } else if (!billName || !billPhone || !billEmail) {
        // 5) Мягкий поиск клиента по полям заявки (на всякий случай)
        try {
          const filters = [];
          const n = pick(j, ['client_name', 'full_name', 'name']);
          const p = pick(j, ['client_phone', 'phone']);
          const e = pick(j, ['client_email', 'email']);
          if (n) filters.push(`full_name.eq.${encodeURIComponent(n)}`);
          if (p) filters.push(`phone.eq.${encodeURIComponent(p)}`);
          if (e) filters.push(`email.eq.${encodeURIComponent(e)}`);
          if (filters.length) {
            const { data: guess } = await supabase
              .from('clients')
              .select('full_name,name,phone,email,address,address_line1,address_line2,street,city,state,zip,postal_code,created_at')
              .or(filters.join(','))
              .order('created_at', { ascending: false })
              .limit(1);
            if (!alive) return;
            if (guess?.[0]) {
              const c = guess[0];
              setBillName(pick(c, ['full_name', 'name']) || billName);
              setBillPhone(pick(c, ['phone']) || billPhone);
              setBillEmail(pick(c, ['email']) || billEmail);
              const addr = composeAddress(c);
              if (addr) setBillAddress(addr);
            }
          }
        } catch {
          /* ignore */
        }
      }

      // 6) Авто-номер инвойса — сперва пробуем max(invoice_no), если RLS/ошибка — делаем предсказуемый fallback
      try {
        const { data } = await supabase
          .from('invoices')
          .select('invoice_no')
          .order('invoice_no', { ascending: false })
          .limit(1);
        if (!alive) return;
        const next = (N(data?.[0]?.invoice_no) || 0) + 1;
        setInvoiceNo(String(next));
      } catch {
        // fallback: job_number / job id / короткий timestamp
        const ts = Date.now().toString().slice(-6);
        const fallback = j?.job_number || id || ts;
        setInvoiceNo(String(fallback));
      }

      // 7) Текущая дата по умолчанию
      setInvoiceDate(new Date());
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  /* ---------- вычисления ---------- */
  const subtotal = useMemo(() => rows.reduce((s, r) => s + N(r.qty) * N(r.price), 0), [rows]);
  const total = useMemo(() => Math.max(0, N(subtotal) - N(discount)), [subtotal, discount]);

  /* ---------- редактирование строк ---------- */
  const changeRow = (i, key, val) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[i] = { ...cp[i], [key]: key === 'name' || key === 'type' ? val : Number(val || 0) };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  /* ---------- сохранение ---------- */
  async function persistInvoice() {
    const payload = {
      job_id: id ?? null,
      invoice_no: invoiceNo ? Number(invoiceNo) : null,
      issued_on: toInputDate(invoiceDate),
      subtotal,
      discount: N(discount),
      total_due: total,
      rows_json: rows,
      bill_to_name: billName || null,
      bill_to_address: billAddress || null,
      bill_to_phone: billPhone || null,
      bill_to_email: billEmail || null,
      include_warranty: includeWarranty,
      warranty_days: Number(warrantyDays || 0),
    };
    try {
      const { error } = await supabase.from('invoices').insert(payload);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[invoices] save skipped:', e?.message || e);
      return false;
    }
  }

  async function saveAndDownload() {
    setSaving(true);
    try {
      const saved = await persistInvoice();

      // PDF
      const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true });

      // Заголовок
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${invoiceNo || 'DRAFT'}`, 306, 52, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Date: ${formatHuman(invoiceDate)}`, 306, 68, { align: 'center' });

      // Company + logo справа
      const rightX = 612 - 40;
      let rightY = 100;
      let logoBottom = 0;
      try {
        const logo = logoDataURL || (await loadLogoDataURL());
        if (logo) {
          const top = 30;
          const w = 90, h = 90;
          doc.addImage(logo, 'PNG', rightX - w, top, w, h);
          logoBottom = top + h; // 120
        }
      } catch { /* ignore */ }

      doc.setFont(undefined, 'bold'); doc.text('Sim Scope Inc.', rightX, rightY, { align: 'right' }); rightY += 14;
      doc.setFont(undefined, 'normal');
      ['1587 E 19th St', 'Brooklyn, NY 11230', '(929) 412-9042', 'simscopeinc@gmail.com'].forEach((line) => {
        doc.text(line, rightX, rightY, { align: 'right' });
        rightY += 12;
      });

      // Bill To слева
      const leftX = 40; let leftY = 100;
      doc.setFont(undefined, 'bold'); doc.text('Bill To:', leftX, leftY); leftY += 14;
      doc.setFont(undefined, 'normal');
      [billName, billAddress, billPhone, billEmail].filter(Boolean).forEach((line) => { doc.text(String(line), leftX, leftY); leftY += 12; });

      // Старт таблицы: ЧЁТКО НИЖЕ шапки и логотипа
      const headerBottom = Math.max(leftY, rightY, logoBottom) + 16;

      const body = rows.map((r) => [
        r.name || (r.type === 'service' ? 'Service' : 'Item'),
        String(N(r.qty)),
        `$${N(r.price).toFixed(2)}`,
        `$${(N(r.qty) * N(r.price)).toFixed(2)}`,
      ]);

      autoTable(doc, {
        startY: headerBottom,
        head: [['Description', 'Qty', 'Unit Price', 'Amount']],
        body,
        styles: { fontSize: 10, cellPadding: 6, lineWidth: 0.1 },
        headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
        margin: { left: 40, right: 40 },
        columnStyles: {
          0: { cellWidth: 372 },
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 60, halign: 'right' },
          3: { cellWidth: 60, halign: 'right' },
        },
      });

      let endY = doc.lastAutoTable.finalY + 10;
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: $${N(subtotal).toFixed(2)}`, rightX, endY, { align: 'right' }); endY += 14;
      doc.text(`Discount: -$${N(discount).toFixed(2)}`, rightX, endY, { align: 'right' }); endY += 14;
      doc.text(`Total Due: $${N(total).toFixed(2)}`, rightX, endY, { align: 'right' }); endY += 18;

      if (includeWarranty && Number(warrantyDays) > 0) {
        doc.setFont(undefined, 'bold'); doc.text(`Warranty (${Number(warrantyDays)} days):`, 40, endY); endY += 12;
        doc.setFont(undefined, 'normal'); doc.setFontSize(9);
        const txt =
          `A ${Number(
            warrantyDays
          )}-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ` +
          `The warranty does not cover other components or the appliance as a whole, normal wear, consumables, damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ` +
          `The warranty starts on the job completion date and is valid only when the invoice is paid in full.`;
        const lines = doc.splitTextToSize(txt, 612 - 80);
        doc.text(lines, 40, endY);
      }

      doc.setFontSize(10);
      doc.text('Thank you for your business!', rightX, 760, { align: 'right' });

      const filename = `invoice_${invoiceNo || (id ? `job_${id}` : 'draft')}.pdf`;
      doc.save(filename);

      if (!saved) alert('PDF downloaded. Saving to DB was skipped (RLS/schema).');
    } catch (e) {
      console.error(e);
      alert('Failed to save or download invoice');
    } finally {
      setSaving(false);
    }
  }

  /* ---------- UI ---------- */
  return (
    <div style={S.page}>
      <div style={S.h1}>Invoice</div>

      {/* настройки */}
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Invoice #</div>
          <input
            style={{ ...S.input, width: 140 }}
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="auto"
          />
          <div style={{ fontWeight: 600, marginLeft: 6 }}>Date</div>
          <input
            type="date"
            style={S.input}
            value={toInputDate(invoiceDate)}
            onChange={(e) => setInvoiceDate(fromInputDate(e.target.value))}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 10 }}>
            <input type="checkbox" checked={includeWarranty} onChange={(e) => setIncludeWarranty(e.target.checked)} />
            Include warranty
          </label>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Days:
            <input
              type="number"
              min={0}
              style={{ ...S.input, width: 80 }}
              value={warrantyDays}
              onChange={(e) => setWarrantyDays(Number(e.target.value || 0))}
            />
          </div>
        </div>
      </div>

      {/* Bill To + Job */}
      <div style={{ ...S.grid2, marginBottom: 12 }}>
        <div style={S.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Bill To</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input style={S.input} placeholder="Full name / Company" value={billName} onChange={(e) => setBillName(e.target.value)} />
            <input style={S.input} placeholder="Address" value={billAddress} onChange={(e) => setBillAddress(e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input style={S.input} placeholder="Phone" value={billPhone} onChange={(e) => setBillPhone(e.target.value)} />
              <input style={S.input} placeholder="Email" value={billEmail} onChange={(e) => setBillEmail(e.target.value)} />
            </div>
          </div>
        </div>

        <div style={S.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Job</div>
          <div style={S.muted}>
            {job
              ? [
                  job?.job_number ? `Job #${job.job_number}` : '',
                  job?.system_type ? `System: ${job.system_type}` : '',
                  job?.issue ? `Issue: ${job.issue}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No job linked'}
          </div>
        </div>
      </div>

      {/* таблица позиций */}
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Type</th>
              <th style={S.th}>Name</th>
              <th style={{ ...S.th, textAlign: 'center', width: 80 }}>Qty</th>
              <th style={{ ...S.th, textAlign: 'right', width: 120 }}>Price</th>
              <th style={{ ...S.th, textAlign: 'right', width: 120 }}>Amount</th>
              <th style={{ ...S.th, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={S.td}>
                  <select style={S.select} value={r.type} onChange={(e) => changeRow(i, 'type', e.target.value)}>
                    <option value="service">service</option>
                    <option value="material">material</option>
                  </select>
                </td>
                <td style={S.td}>
                  <input
                    style={S.input}
                    value={r.name}
                    onChange={(e) => changeRow(i, 'name', e.target.value)}
                    placeholder={r.type === 'service' ? 'Service' : 'Item'}
                  />
                </td>
                <td style={{ ...S.td, textAlign: 'center' }}>
                  <input
                    type="number"
                    style={{ ...S.input, width: 80, textAlign: 'center' }}
                    value={r.qty}
                    onChange={(e) => changeRow(i, 'qty', e.target.value)}
                  />
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  <input
                    type="number"
                    style={{ ...S.input, width: 120, textAlign: 'right' }}
                    value={r.price}
                    onChange={(e) => changeRow(i, 'price', e.target.value)}
                  />
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>${(N(r.qty) * N(r.price)).toFixed(2)}</td>
                <td style={{ ...S.td, textAlign: 'center' }}>
                  <button
                    style={{ ...S.btn, color: '#ef4444', borderColor: '#ef4444' }}
                    onClick={() => delRow(i)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button style={S.ghost} onClick={addRow}>
            + Add row
          </button>
        </div>
      </div>

      {/* итоги */}
      <div style={{ ...S.card, marginTop: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div>Subtotal: ${N(subtotal).toFixed(2)}</div>
          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Discount $:</div>
            <input
              type="number"
              style={{ ...S.input, width: 120, textAlign: 'right' }}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value || 0))}
            />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, marginTop: 8 }}>Total Due: ${N(total).toFixed(2)}</div>
        </div>
      </div>

      {/* действие */}
      <div style={{ marginTop: 12 }}>
        <button onClick={saveAndDownload} disabled={saving} style={S.primary}>
          {saving ? 'Please wait…' : 'Сохранить и скачать PDF'}
        </button>
      </div>
    </div>
  );
}

