// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ---------------- helpers (оставил твоими) ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    o.address, o.address_line1, o.address_line2, o.street, o.street1, o.street2,
    o.city, o.state, o.region, o.zip, o.postal_code,
  ].map(clean).filter(Boolean);
  return [...new Set(parts)].join(', ');
}
const nowMinusSecISO = (sec = 45) => new Date(Date.now() - sec * 1000).toISOString();

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

/* ---------------- ВНЕШНИЙ ВИД ---------------- */
const S = {
  page: { maxWidth: 1000, margin: '24px auto 80px', padding: '0 16px' },
  bar: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 },
  primary: {
    padding: '10px 16px', borderRadius: 10, border: '1px solid #2563eb',
    background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600,
  },
  ghost: {
    padding: '9px 14px', borderRadius: 10, border: '1px solid #e5e7eb',
    background: '#f8fafc', cursor: 'pointer',
  },

  // «Открытка» инвойса
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 2px 24px rgba(0,0,0,0.04)',
  },

  header: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 16 },
  brandStack: { display: 'flex', flexDirection: 'column' },
  brandName: { fontWeight: 700, fontSize: 16 },
  invoiceTitle: { fontWeight: 800, fontSize: 30, color: '#444', letterSpacing: 1 },
  invoiceNo: { textAlign: 'right', color: '#6b7280' },

  sep: { height: 1, background: '#eef2f7', margin: '16px 0' },

  metaRow: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center' },
  metaLabel: { color: '#6b7280', fontWeight: 600 },
  pillWrap: { width: 280, justifySelf: 'end' },
  pill: {
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #e5e7eb',
  },
  pillRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: '#f6f7fb',
  },
  pillCellLeft: { padding: '10px 12px', fontWeight: 700, color: '#333', textAlign: 'right' },
  pillCellRight: { padding: '10px 12px', fontWeight: 700, textAlign: 'right' },

  cols2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 },
  subCard: { border: '1px solid #eef2f7', borderRadius: 12, padding: 14 },
  subTitle: { fontWeight: 700, marginBottom: 8 },
  muted: { color: '#6b7280' },

  // Таблица
  tableWrap: { marginTop: 16, border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { background: '#3c3c3c', color: '#fff', textAlign: 'left', padding: '10px 12px', fontWeight: 700 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' },

  input: {
    border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px',
    width: '100%', height: 36, boxSizing: 'border-box',
  },
  select: {
    border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px',
    width: '100%', height: 36, boxSizing: 'border-box',
  },

  // Итоги справа
  totalsRow: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginTop: 18 },
  totalsCard: { border: '1px solid #eef2f7', borderRadius: 12, padding: 14 },
  totalsLine: { display: 'flex', justifyContent: 'space-between', padding: '6px 0' },
  totalsStrong: { fontWeight: 800, fontSize: 18 },

  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '6px 10px', borderRadius: 999, background: '#eef2ff', color: '#1d4ed8', fontWeight: 600,
  },

  // Выравнивание чисел
  taCenter: { textAlign: 'center' },
  taRight: { textAlign: 'right' },
};

/* ---------------- компонент ---------------- */
export default function InvoicePage() {
  const { id } = useParams(); // job id (uuid)

  // logo
  const [logoDataURL, setLogoDataURL] = useState(null);
  // job
  const [job, setJob] = useState(null);

  // Bill To
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  // строки таблицы
  const [rows, setRows] = useState([
    { type: 'service', name: 'Labor', qty: 1, price: 0 },
    { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
  ]);
  const [discount, setDiscount] = useState(0);

  // инвойс meta
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  const [saving, setSaving] = useState(false);

  /* ----------- load logo ----------- */
  useEffect(() => { loadLogoDataURL().then((d) => setLogoDataURL(d || null)); }, []);

  /* ----------- load job + client + materials + suggest next invoice no ----------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      let j = null;
      if (id) {
        const { data } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
        if (!alive) return;
        j = data || null;
        setJob(j);
      }

      // Client
      let clientData = null;
      if (j && j.client_id) {
        const q = await supabase.from('clients').select('*').eq('id', j.client_id).maybeSingle();
        if (!q.error && q.data) clientData = q.data;
      }
      if (!clientData) {
        clientData = {
          full_name: (j && (j.client_name || j.full_name)) || '',
          phone: (j && (j.client_phone || j.phone)) || '',
          email: (j && (j.client_email || j.email)) || '',
          address: (j && (j.client_address || j.address)) || '',
          city: j?.city, state: j?.state, zip: j?.zip,
        };
      }
      if (!alive) return;
      setBillName(clean(clientData.full_name));
      setBillPhone(clean(clientData.phone));
      setBillEmail(clean(clientData.email));
      setBillAddress(composeAddress(clientData) || clean(clientData.address));

      // Materials
      if (id) {
        const { data: mlist } = await supabase
          .from('materials').select('name, price, qty, quantity').eq('job_id', id);
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

      // Next invoice no
      try {
        const { data: last } = await supabase
          .from('invoices')
          .select('invoice_no')
          .order('invoice_no', { ascending: false })
          .limit(1);
        if (!alive) return;
        const next = (N(last && last[0] && last[0].invoice_no) || 0) + 1;
        setInvoiceNo(String(next));
      } catch {
        const ts = Date.now().toString().slice(-6);
        setInvoiceNo(ts);
      }

      setInvoiceDate(new Date());
    })();
    return () => { alive = false; };
  }, [id]);

  /* ----------- computed ----------- */
  const subtotal = useMemo(() => rows.reduce((s, r) => s + N(r.qty) * N(r.price), 0), [rows]);
  const laborTotal = useMemo(
    () => rows.filter((r) => r.type === 'service').reduce((s, r) => s + N(r.qty) * N(r.price), 0),
    [rows]
  );
  const partsTotal = useMemo(
    () => rows.filter((r) => r.type === 'material').reduce((s, r) => s + N(r.qty) * N(r.price), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, N(subtotal) - N(discount)), [subtotal, discount]);

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

  /* ----------- save + pdf (твоя логика, без изменений) ----------- */
  async function saveAndDownload() {
    if (saving) return;
    setSaving(true);
    try {
      let thisInvoiceNo = null;
      const recentFrom = nowMinusSecISO(45);
      const recentQ = await supabase
        .from('invoices')
        .select('invoice_no, created_at')
        .eq('job_id', id || null)
        .gte('created_at', recentFrom)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!recentQ.error && recentQ.data && recentQ.data.length > 0) {
        const n = Number(recentQ.data[0].invoice_no);
        if (!Number.isNaN(n) && n > 0) thisInvoiceNo = n;
      }
      if (thisInvoiceNo == null) {
        const payload = { job_id: id || null, labor_cost: Number(laborTotal) || 0, parts_cost: Number(partsTotal) || 0 };
        const { data: inserted, error } = await supabase
          .from('invoices')
          .insert(payload)
          .select('id, invoice_no, created_at')
          .single();
        if (error) throw error;
        thisInvoiceNo = Number(inserted.invoice_no);
      }

      // PDF
      const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true });
      doc.setFontSize(14); doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${thisInvoiceNo}`, 306, 52, { align: 'center' });
      doc.setFontSize(10); doc.setFont(undefined, 'normal');
      doc.text(`Date: ${human(invoiceDate)}`, 306, 68, { align: 'center' });

      const rightX = 612 - 80;
      let rightY = 100;
      let logoBottom = 0;
      try {
        const logo = logoDataURL || (await loadLogoDataURL());
        if (logo) {
          const top = 24; const w = 130, h = 130;
          doc.addImage(logo, 'PNG', rightX - w, top, w, h);
          logoBottom = top + h;
        }
      } catch {}
      const PAD = 18; const LEFT_TOP = 170; const RIGHT_SHIFT = 0;
      const rightStartY = Math.max(logoBottom + PAD, LEFT_TOP + RIGHT_SHIFT);
      rightY = rightStartY;

      doc.setFont(undefined, 'bold');
      doc.text('Sim Scope Inc.', rightX, rightY, { align: 'right' });
      rightY += 14;
      doc.setFont(undefined, 'normal');
      ['1587 E 19th St', 'Brooklyn, NY 11230', '(929) 412-9042', 'simscopeinc@gmail.com'].forEach((line) => {
        doc.text(line, rightX, rightY, { align: 'right' }); rightY += 12;
      });

      const leftX = 40; let leftY = LEFT_TOP;
      doc.setFont(undefined, 'bold'); doc.text('Bill To:', leftX, leftY);
      leftY += 14; doc.setFont(undefined, 'normal');
      [billName, billAddress, billPhone, billEmail].filter(Boolean).forEach((line) => {
        doc.text(String(line), leftX, leftY); leftY += 12;
      });

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
        columnStyles: { 0: { cellWidth: 372 }, 1: { cellWidth: 40, halign: 'center' }, 2: { cellWidth: 60, halign: 'right' }, 3: { cellWidth: 60, halign: 'right' } },
      });

      let endY = doc.lastAutoTable.finalY + 10;
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: $${N(rows.reduce((s,r)=>s+N(r.qty)*N(r.price),0)).toFixed(2)}`, rightX, endY, { align: 'right' });
      endY += 14;
      doc.text(`Discount: -$${N(discount).toFixed(2)}`, rightX, endY, { align: 'right' });
      endY += 14;
      doc.text(`Total Due: $${N(Math.max(0, rows.reduce((s,r)=>s+N(r.qty)*N(r.price),0)-N(discount))).toFixed(2)}`, rightX, endY, { align: 'right' });
      endY += 18;

      if (includeWarranty && Number(warrantyDays) > 0) {
        doc.setFont(undefined, 'bold'); doc.text(`Warranty (${Number(warrantyDays)} days):`, 40, endY);
        endY += 12; doc.setFont(undefined, 'normal'); doc.setFontSize(9);
        const txt =
          `A ${Number(warrantyDays)}-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ` +
          `The warranty does not cover other components or the appliance as a whole, normal wear, consumables, damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ` +
          `The warranty starts on the job completion date and is valid only when the invoice is paid in full.`;
        const lines = doc.splitTextToSize(txt, 612 - 80); doc.text(lines, 40, endY);
      }
      doc.setFontSize(10); doc.text('Thank you for your business!', rightX, 760, { align: 'right' });

      const filename = `invoice_${thisInvoiceNo}.pdf`;
      doc.save(filename);

      try {
        const pdfBlob = doc.output('blob');
        const storageKey = `${id}/${filename}`;
        const up = await supabase.storage.from('invoices').upload(storageKey, pdfBlob, {
          cacheControl: '3600', contentType: 'application/pdf', upsert: true,
        });
        if (up.error) console.warn('Upload invoice PDF failed:', up.error);
      } catch (e) { console.warn('PDF upload error:', e); }

      setInvoiceNo(String((Number(thisInvoiceNo) || 0) + 1));
    } catch (e) {
      console.error('saveAndDownload error:', e);
      alert(`Failed to save or download invoice: ${e.message || e}`);
    } finally { setSaving(false); }
  }

  /* ---------------- таблица (только UI обновлён) ---------------- */
  const tableRow = (r, i) => (
    <tr key={i}>
      <td style={S.td}>
        <select style={S.select} value={r.type} onChange={(e) => changeRow(i, 'type', e.target.value)}>
          <option value="service">service</option>
          <option value="material">material</option>
        </select>
      </td>
      <td style={S.td}>
        <input style={S.input} value={r.name} onChange={(e) => changeRow(i, 'name', e.target.value)}
          placeholder={r.type === 'service' ? 'Service' : 'Item'} />
      </td>
      <td style={{ ...S.td, ...S.taCenter }}>
        <input type="number" style={{ ...S.input, width: 84, textAlign: 'center' }}
          value={r.qty} onChange={(e) => changeRow(i, 'qty', e.target.value)} />
      </td>
      <td style={{ ...S.td, ...S.taRight }}>
        <input type="number" style={{ ...S.input, width: 120, textAlign: 'right' }}
          value={r.price} onChange={(e) => changeRow(i, 'price', e.target.value)} />
      </td>
      <td style={{ ...S.td, ...S.taRight }}>
        ${((N(r.qty) || 0) * (N(r.price) || 0)).toFixed(2)}
      </td>
      <td style={{ ...S.td, ...S.taCenter }}>
        <button
          style={{ ...S.ghost, color: '#ef4444', borderColor: '#ef4444', background: '#fff' }}
          onClick={() => delRow(i)} title="Remove"
        >
          ✕
        </button>
      </td>
    </tr>
  );

  /* ---------------- UI ---------------- */
  return (
    <div style={S.page}>
      <div style={S.bar}>
        <button onClick={saveAndDownload} disabled={saving} style={S.primary}>
          {saving ? 'Please wait…' : 'Сохранить и скачать PDF'}
        </button>
        <span style={S.badge}>Editor • Live preview</span>
      </div>

      <div style={S.card}>
        {/* ШАПКА */}
        <div style={S.header}>
          <div className="logo">
            {logoDataURL ? (
              <img src={logoDataURL} alt="logo" style={{ width: 80, height: 80, objectFit: 'contain' }} />
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: 12, background: '#f3f4f6' }} />
            )}
          </div>

          <div style={S.brandStack}>
            <div style={S.brandName}>Sim HVAC & Appliance repair</div>
            <div style={{ ...S.muted, marginTop: 4 }}>
              1587 E 19th St, Brooklyn, NY 11230 · (929) 412-9042 · simscopeinc@gmail.com
            </div>
          </div>

          <div>
            <div style={S.invoiceTitle}>INVOICE</div>
            <div style={S.invoiceNo}># {invoiceNo || '—'}</div>
          </div>
        </div>

        <div style={S.sep} />

        {/* МЕТА + PILL */}
        <div style={S.metaRow}>
          <div style={S.metaLabel}>Date:</div>
          <div>
            <input
              type="date"
              style={{ ...S.input, width: 180 }}
              value={toInputDate(invoiceDate)}
              onChange={(e) => setInvoiceDate(fromInputDate(e.target.value))}
            />
          </div>

          <div style={S.pillWrap}>
            <div style={S.pill}>
              <div style={S.pillRow}>
                <div style={S.pillCellLeft}>Balance Due:</div>
                <div style={S.pillCellRight}>${N(total).toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* BILL TO + JOB */}
        <div style={S.cols2}>
          <div style={S.subCard}>
            <div style={S.subTitle}>Bill To</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <input style={S.input} placeholder="Full name / Company" value={billName} onChange={(e) => setBillName(e.target.value)} />
              <input style={S.input} placeholder="Address" value={billAddress} onChange={(e) => setBillAddress(e.target.value)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input style={S.input} placeholder="Phone" value={billPhone} onChange={(e) => setBillPhone(e.target.value)} />
                <input style={S.input} placeholder="Email" value={billEmail} onChange={(e) => setBillEmail(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={S.subCard}>
            <div style={S.subTitle}>Job</div>
            <div style={S.muted}>
              {job
                ? [
                    job?.job_number ? `Job #${job.job_number}` : '',
                    job?.system_type ? `System: ${job.system_type}` : '',
                    job?.issue ? `Issue: ${job.issue}` : '',
                  ].filter(Boolean).join(' · ')
                : 'No job linked'}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={includeWarranty} onChange={(e) => setIncludeWarranty(e.target.checked)} />
                Include warranty
              </label>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Days:
                <input type="number" min={0} style={{ ...S.input, width: 90 }} value={warrantyDays}
                  onChange={(e) => setWarrantyDays(Number(e.target.value || 0))} />
              </div>
            </div>
          </div>
        </div>

        {/* ТАБЛИЦА */}
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 140 }}>Type</th>
                <th style={S.th}>Name</th>
                <th style={{ ...S.th, textAlign: 'center', width: 90 }}>Qty</th>
                <th style={{ ...S.th, textAlign: 'right', width: 120 }}>Price</th>
                <th style={{ ...S.th, textAlign: 'right', width: 120 }}>Amount</th>
                <th style={{ ...S.th, width: 56 }} />
              </tr>
            </thead>
            <tbody>{rows.map(tableRow)}</tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button style={S.ghost} onClick={addRow}>+ Add row</button>
        </div>

        {/* ИТОГИ */}
        <div style={S.totalsRow}>
          <div />
          <div style={S.totalsCard}>
            <div style={S.totalsLine}><div>Subtotal:</div><div>${N(subtotal).toFixed(2)}</div></div>
            <div style={S.totalsLine}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Discount $:
                <input
                  type="number"
                  style={{ ...S.input, width: 120, textAlign: 'right' }}
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value || 0))}
                />
              </div>
              <div>- ${N(discount).toFixed(2)}</div>
            </div>
            <div style={{ ...S.totalsLine, marginTop: 4 }}>
              <div style={S.totalsStrong}>Total:</div>
              <div style={S.totalsStrong}>${N(total).toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
