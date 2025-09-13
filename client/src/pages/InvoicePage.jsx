// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ---------------- helpers ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const toInputDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromInputDate = (s) => {
  if (!s) return new Date();
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const human = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const N = (v) => Number(v || 0);

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'empty' ? s : '';
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
    const res = await fetch('/logo_invoice_header.png', {
      cache: 'force-cache',
      signal: ac.signal,
    });
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

/* ---------------- styles ---------------- */
const S = {
  page: { maxWidth: 920, margin: '0 auto', padding: 16 },
  h1: { fontWeight: 800, fontSize: 24, margin: '4px 0 14px' },
  input: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '8px 10px',
    width: '100%',
    height: 36,
    boxSizing: 'border-box',
  },
  select: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '8px 10px',
    width: '100%',
    height: 36,
    boxSizing: 'border-box',
  },
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
  const { id } = useParams(); // job id (uuid)

  // logo
  const [logoDataURL, setLogoDataURL] = useState(null);

  // job
  const [job, setJob] = useState(null);

  // Bill To (только для PDF/печати)
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  // таблица позиций
  const [rows, setRows] = useState([
    { type: 'service', name: 'Labor', qty: 1, price: 0 },
    { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
  ]);
  const [discount, setDiscount] = useState(0); // в БД не пишем, только в PDF

  // реквизиты инвойса (дата; номер отображаем «ожидаемый», реальный берём после insert)
  const [invoiceNo, setInvoiceNo] = useState(''); // показываем предполагаемый next
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  const [saving, setSaving] = useState(false);

  /* ----------- load logo ----------- */
  useEffect(() => {
    loadLogoDataURL().then((d) => setLogoDataURL(d || null));
  }, []);

  /* ----------- load job + client + materials + suggest next invoice no ----------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      // Job
      let j = null;
      if (id) {
        const { data } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
        if (!alive) return;
        j = data || null;
        setJob(j);
      }

      // Client (лучшее из jobs/clients)
      let clientData = null;
      if (j?.client_id) {
        const { data: c, error: ec } = await supabase
          .from('clients')
          .select('*')
          .eq('id', j.client_id)
          .maybeSingle();
        if (!ec && c) clientData = c;
      }
      if (!clientData) {
        clientData = {
          full_name: j?.client_name || j?.full_name || '',
          phone: j?.client_phone || j?.phone || '',
          email: j?.client_email || j?.email || '',
          address: j?.client_address || j?.address || '',
          city: j?.city,
          state: j?.state,
          zip: j?.zip,
        };
      }
      if (!alive) return;
      setBillName(clean(clientData.full_name));
      setBillPhone(clean(clientData.phone));
      setBillEmail(clean(clientData.email));
      const addr = composeAddress(clientData) || clean(clientData.address);
      setBillAddress(addr);

      // Материалы -> строки таблицы
      if (id) {
        const { data: mlist } = await supabase
          .from('materials')
          .select('name, price, qty, quantity')
          .eq('job_id', id);

        const mats = (mlist || []).map((m) => ({
          type: 'material',
          name: clean(m.name) || 'Item',
          qty: N(m.qty ?? m.quantity ?? 1),
          price: N(m.price),
        }));

        setRows([
          { type: 'service', name: 'Labor', qty: 1, price: N(j?.labor_price) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: N(j?.scf) },
          ...mats,
        ]);
      }

      // Предполагаемый следующий номер (если RLS разрешает чтение)
      try {
        const { data: last } = await supabase
          .from('invoices')
          .select('invoice_no')
          .order('invoice_no', { ascending: false })
          .limit(1);
        if (!alive) return;
        const next = (N(last?.[0]?.invoice_no) || 0) + 1;
        setInvoiceNo(String(next));
      } catch {
        // Фоллбек
        const ts = Date.now().toString().slice(-6);
        setInvoiceNo(ts);
      }

      setInvoiceDate(new Date());
    })();
    return () => { alive = false; };
  }, [id]);

  /* ----------- computed ----------- */
  const subtotal = useMemo(
    () => rows.reduce((s, r) => s + N(r.qty) * N(r.price), 0),
    [rows]
  );
  const laborTotal = useMemo(
    () => rows.filter(r => r.type === 'service')
              .reduce((s, r) => s + N(r.qty) * N(r.price), 0),
    [rows]
  );
  const partsTotal = useMemo(
    () => rows.filter(r => r.type === 'material')
              .reduce((s, r) => s + N(r.qty) * N(r.price), 0),
    [rows]
  );
  const total = useMemo(
    () => Math.max(0, N(subtotal) - N(discount)),
    [subtotal, discount]
  );

  /* ----------- rows edit ----------- */
  const changeRow = (i, key, val) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[i] = { ...cp[i], [key]: key === 'name' || key === 'type' ? val : Number(val || 0) };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  /* ----------- save + pdf (вставляем только имеющиеся поля) ----------- */
  async function saveAndDownload() {
    setSaving(true);
    try {
      // 1) INSERT только существующих колонок
      const payload = {
        job_id: id ?? null,
        labor_cost: N(laborTotal),
        parts_cost: N(partsTotal),
        // technician_percent / technician_total оставляем пустыми (0/NULL)
      };

      const { data: inserted, error } = await supabase
        .from('invoices')
        .insert(payload)
        .select('id, invoice_no')
        .single();

      if (error) {
        console.error('Insert invoice failed:', error);
        alert('Ошибка сохранения инвойса: ' + (error.message || 'unknown'));
        return;
      }

      const thisInvoiceNo = inserted?.invoice_no ?? (invoiceNo || 'DRAFT');

      // 2) PDF с реальным номером
      const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true });

      // header center
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${thisInvoiceNo}`, 306, 52, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Date: ${human(invoiceDate)}`, 306, 68, { align: 'center' });

      // right: company + logo (увеличено, с отступом)
      const rightX = 612 - 80;
      let rightY = 100;
      let logoBottom = 0;
      try {
        const logo = logoDataURL || (await loadLogoDataURL());
        if (logo) {
          const top = 24;
          const w = 130, h = 130; // увеличенный логотип
          doc.addImage(logo, 'PNG', rightX - w, top, w, h);
          logoBottom = top + h;
        }
      } catch { /* ignore */ }

      const PAD = 18; // отступ от лого
      rightY = Math.max(100, logoBottom + PAD);

      doc.setFont(undefined, 'bold'); doc.text('Sim Scope Inc.', rightX, rightY, { align: 'right' }); rightY += 14;
      doc.setFont(undefined, 'normal');
      ['1587 E 19th St', 'Brooklyn, NY 11230', '(929) 412-9042', 'simscopeinc@gmail.com'].forEach((line) => {
        doc.text(line, rightX, rightY, { align: 'right' }); rightY += 12;
      });

      // left: Bill To — опускаем не выше правого
      const leftX = 40;
      let leftY = Math.max(170, rightY);
      doc.setFont(undefined, 'bold'); doc.text('Bill To:', leftX, leftY); leftY += 14;
      doc.setFont(undefined, 'normal');
      [billName, billAddress, billPhone, billEmail].filter(Boolean).forEach((line) => {
        doc.text(String(line), leftX, leftY); leftY += 12;
      });

      // таблица
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

      const filename = `invoice_${thisInvoiceNo}.pdf`;
      doc.save(filename);

      // 3) показать «следующий номер» в поле формы (для информации)
      if (inserted?.invoice_no) {
        setInvoiceNo(String(Number(inserted.invoice_no) + 1));
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save or download invoice');
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- UI ---------------- */
  const tableRow = (r, i) => (
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
  );

  return (
    <div style={S.page}>
      <div style={S.h1}>Invoice</div>

      {/* meta */}
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Invoice #</div>
          <input
            style={{ ...S.input, width: 160, background: '#f9fafb' }}
            value={invoiceNo}
            readOnly
            title="Автонумерация из БД. Номер будет присвоен при сохранении."
          />
          <div style={{ fontWeight: 600, marginLeft: 6 }}>Date</div>
          <input
            type="date"
            style={{ ...S.input, width: 170 }}
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

      {/* bill + job */}
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

      {/* table */}
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
          <tbody>{rows.map(tableRow)}</tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button style={S.ghost} onClick={addRow}>
            + Add row
          </button>
        </div>
      </div>

      {/* totals */}
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

      {/* action */}
      <div style={{ marginTop: 12 }}>
        <button onClick={saveAndDownload} disabled={saving} style={S.primary}>
          {saving ? 'Please wait…' : 'Сохранить и скачать PDF'}
        </button>
      </div>
    </div>
  );
}

