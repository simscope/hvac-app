// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ========== helpers ========== */
const pad = (n) => String(n).padStart(2, '0');
const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromInputDate = (s) => {
  if (!s) return new Date();
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const formatHuman = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const num = (v) => Number(v || 0);
const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'empty' ? s : '';
};
async function loadLogoDataURL() {
  try {
    const res = await fetch('/logo_invoice_header.png', { cache: 'force-cache' });
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
function composeAddress(obj = {}) {
  const parts = [
    obj.address,
    obj.address_line1,
    obj.address_line2,
    obj.street,
    obj.street1,
    obj.street2,
    obj.city,
    obj.state,
    obj.region,
    obj.zip,
    obj.postal_code,
  ]
    .map(clean)
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}
function pick(obj = {}, keys = []) {
  for (const k of keys) {
    const v = clean(obj[k]);
    if (v) return v;
  }
  return '';
}

/* ========== inline styles (как на других страницах) ========== */
const S = {
  page: { maxWidth: 920, margin: '0 auto', padding: 16 },
  h1: { fontWeight: 800, fontSize: 24, margin: '4px 0 14px' },
  row: { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center' },
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

/* ========== component ========== */
export default function InvoicePage() {
  const { id } = useParams(); // job id

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [job, setJob] = useState(null);

  // Bill To
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  // строки
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);

  // номер/дата
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());

  // гарантия
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  const [logoDataURL, setLogoDataURL] = useState(null);

  /* ------ load ------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);

      const logo = await loadLogoDataURL();
      if (!alive) return;
      setLogoDataURL(logo);

      let j = null;
      if (id) {
        const { data } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
        if (!alive) return;
        j = data || null;
        setJob(j);
      }

      // клиент
      let c = null;
      if (j?.client_id) {
        const { data: cData } = await supabase
          .from('clients')
          .select('full_name,name,phone,email,address,address_line1,address_line2,street,city,state,zip,postal_code')
          .eq('id', j.client_id)
          .maybeSingle();
        if (!alive) return;
        c = cData || null;
      }
      if (!c && j) {
        const n = clean(pick(j, ['client_name', 'full_name', 'name']));
        const p = clean(pick(j, ['client_phone', 'phone']));
        const e = clean(pick(j, ['client_email', 'email']));
        const filters = [];
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
          c = guess?.[0] || null;
        }
      }

      setBillName(pick(c, ['full_name', 'name']) || pick(j, ['client_name', 'full_name', 'name']) || '');
      setBillAddress(
        composeAddress(c) ||
          composeAddress(j) ||
          composeAddress({
            address: pick(j, ['client_address', 'address']),
            address_line1: j?.address_line1,
            address_line2: j?.address_line2,
            city: j?.city,
            state: j?.state,
            zip: j?.zip || j?.postal_code,
          })
      );
      setBillPhone(pick(c, ['phone']) || pick(j, ['client_phone', 'phone']) || '');
      setBillEmail(pick(c, ['email']) || pick(j, ['client_email', 'email']) || '');

      // строки
      if (id) {
        const baseRows = [
          { type: 'service', name: 'Labor', qty: 1, price: num(j?.labor_price) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: num(j?.scf) },
        ];
        const { data: mats } = await supabase.from('materials').select('name,qty,price').eq('job_id', id);
        if (!alive) return;
        const matRows =
          (mats || []).map((m) => ({
            type: 'material',
            name: clean(m.name),
            qty: num(m.qty) || 1,
            price: num(m.price),
          })) || [];
        setRows([...baseRows, ...matRows]);
      } else {
        setRows([
          { type: 'service', name: 'Labor', qty: 1, price: 0 },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
        ]);
      }

      // авто номер
      if (!invoiceNo) {
        try {
          const { data } = await supabase.from('invoices').select('invoice_no').order('invoice_no', { ascending: false }).limit(1);
          if (!alive) return;
          const next = (data?.[0]?.invoice_no || 0) + 1;
          setInvoiceNo(String(next));
        } catch { /* noop */ }
      }
      setInvoiceDate(new Date());
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ------ calc ------ */
  const subtotal = useMemo(() => rows.reduce((s, r) => s + num(r.qty) * num(r.price), 0), [rows]);
  const total = useMemo(() => Math.max(0, num(subtotal) - num(discount)), [subtotal, discount]);

  const changeRow = (i, key, val) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[i] = { ...cp[i], [key]: key === 'name' || key === 'type' ? val : Number(val || 0) };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  async function persistInvoice() {
    const payload = {
      job_id: id ?? null,
      invoice_no: invoiceNo ? Number(invoiceNo) : null,
      issued_on: toInputDate(invoiceDate),
      subtotal,
      discount: num(discount),
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
    if (loading) return;
    setSaving(true);
    try {
      const saved = await persistInvoice();

      const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true });

      // заголовок/дата
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${invoiceNo || 'DRAFT'}`, 306, 52, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Date: ${formatHuman(invoiceDate)}`, 306, 68, { align: 'center' });

      // логотип
      const logo = logoDataURL || (await loadLogoDataURL());
      if (logo) doc.addImage(logo, 'PNG', 460, 30, 90, 90);

      // Bill To
      const left = 40;
      let y = 100;
      doc.setFont(undefined, 'bold');
      doc.text('Bill To:', left, y); y += 14;
      doc.setFont(undefined, 'normal');
      [billName, billAddress, billPhone, billEmail].filter(Boolean).forEach((line) => {
        doc.text(String(line), left, y); y += 12;
      });

      // Компания (справа)
      const right = 612 - 40;
      let ry = 100;
      doc.setFont(undefined, 'bold');
      doc.text('Sim Scope Inc.', right, ry, { align: 'right' }); ry += 14;
      doc.setFont(undefined, 'normal');
      ['1587 E 19th St', 'Brooklyn, NY 11230', '(929) 412-9042', 'simscopeinc@gmail.com'].forEach((line) => {
        doc.text(line, right, ry, { align: 'right' }); ry += 12;
      });

      // Таблица
      const startY = Math.max(y, ry) + 14;
      const body = rows.map((r) => [
        r.name || (r.type === 'service' ? 'Service' : 'Item'),
        String(num(r.qty)),
        `$${num(r.price).toFixed(2)}`,
        `$${(num(r.qty) * num(r.price)).toFixed(2)}`,
      ]);
      autoTable(doc, {
        startY,
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
      doc.text(`Subtotal: $${num(subtotal).toFixed(2)}`, right, endY, { align: 'right' }); endY += 14;
      doc.text(`Discount: -$${num(discount).toFixed(2)}`, right, endY, { align: 'right' }); endY += 14;
      doc.text(`Total Due: $${num(total).toFixed(2)}`, right, endY, { align: 'right' }); endY += 18;

      if (includeWarranty && Number(warrantyDays) > 0) {
        doc.setFont(undefined, 'bold');
        doc.text(`Warranty (${Number(warrantyDays)} days):`, 40, endY); endY += 12;
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
      doc.text('Thank you for your business!', right, 760, { align: 'right' });

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

  const busy = loading || saving;

  /* ------ UI (инлайн стили) ------ */
  return (
    <div style={S.page}>
      <div style={S.h1}>Invoice</div>

      {/* панель настроек */}
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Invoice #</div>
          <input
            style={{ ...S.input, width: 120 }}
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

      {/* таблица строк */}
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
                <td style={{ ...S.td, textAlign: 'right' }}>${(num(r.qty) * num(r.price)).toFixed(2)}</td>
                <td style={{ ...S.td, textAlign: 'center' }}>
                  <button style={{ ...S.btn, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => delRow(i)} title="Remove">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 8 }}>
          <button style={S.ghost} onClick={addRow}>+ Add row</button>
        </div>
      </div>

      {/* итоги */}
      <div style={{ ...S.card, marginTop: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div>Subtotal: ${num(subtotal).toFixed(2)}</div>
          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Discount $:</div>
            <input
              type="number"
              style={{ ...S.input, width: 120, textAlign: 'right' }}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value || 0))}
            />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, marginTop: 8 }}>Total Due: ${num(total).toFixed(2)}</div>
        </div>
      </div>

      {/* действия */}
      <div style={{ marginTop: 12 }}>
        <button onClick={saveAndDownload} disabled={busy} style={S.primary}>
          {busy ? 'Please wait…' : 'Сохранить и скачать PDF'}
        </button>
      </div>
    </div>
  );
}
