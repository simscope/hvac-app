// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ---------------- helpers ---------------- */
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

/* ---------------- styles (UI) ---------------- */
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
  pill: { borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' },
  pillRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#f6f7fb' },
  pillCellLeft: { padding: '10px 12px', fontWeight: 700, color: '#333', textAlign: 'right' },
  pillCellRight: { padding: '10px 12px', fontWeight: 700, textAlign: 'right' },

  cols2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 },
  subCard: { border: '1px solid #eef2f7', borderRadius: 12, padding: 14 },
  subTitle: { fontWeight: 700, marginBottom: 8 },
  muted: { color: '#6b7280' },

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

  totalsRow: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginTop: 18 },
  totalsCard: { border: '1px solid #eef2f7', borderRadius: 12, padding: 14 },
  totalsLine: { display: 'flex', justifyContent: 'space-between', padding: '6px 0' },
  totalsStrong: { fontWeight: 800, fontSize: 18 },

  taCenter: { textAlign: 'center' },
  taRight: { textAlign: 'right' },
};

/* ---------------- компонент ---------------- */
export default function InvoicePage() {
  const { id } = useParams(); // job id (uuid)

  const [logoDataURL, setLogoDataURL] = useState(null);
  const [job, setJob] = useState(null);

  // Bill To
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  // строки
  const [rows, setRows] = useState([
    { type: 'service', name: 'Labor', qty: 1, price: 0 },
    { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
  ]);
  const [discount, setDiscount] = useState(0);

  // мета
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  const [saving, setSaving] = useState(false);

  /* ----------- init ----------- */
  useEffect(() => { loadLogoDataURL().then((d) => setLogoDataURL(d || null)); }, []);

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

  /* ----------- PDF (обновлённая верстка) ----------- */
  async function saveAndDownload() {
    if (saving) return;
    setSaving(true);
    try {
      // номер/антидубль
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

      const PAGE_W = 612;
      const MARGIN = 40;

      // 1) Заголовок справа
      doc.setFontSize(30);
      doc.setFont(undefined, 'bold');
      doc.text('INVOICE', PAGE_W - MARGIN, 48, { align: 'right' });
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(100);
      doc.text(`# ${thisInvoiceNo}`, PAGE_W - MARGIN, 66, { align: 'right' });

      // 2) Логотип слева
      let logoBottom = 24;
      try {
        const logo = logoDataURL || (await loadLogoDataURL());
        if (logo) {
          const LOGO_W = 120, LOGO_H = 120;
          doc.addImage(logo, 'PNG', MARGIN, 24, LOGO_W, LOGO_H);
          logoBottom = 24 + LOGO_H;             // <-- корректно считаем низ логотипа
        }
      } catch {}

      // 3) Справа — ДАТА (над капсулой), затем капсула Balance Due
      const PILL_W = 240, PILL_H = 40;
      const rightColX = PAGE_W - MARGIN - PILL_W;
      let rightY = 110;

      // Дата
      doc.setFont(undefined, 'bold');
      doc.setTextColor(80);
      doc.text('Date:', rightColX, rightY);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0);
      doc.text(human(invoiceDate), rightColX + 40, rightY);
      rightY += 16;

      // Капсула
      doc.setDrawColor(229, 231, 235);
      doc.setFillColor(246, 247, 251);
      doc.roundedRect(PAGE_W - MARGIN - PILL_W, rightY, PILL_W, PILL_H, 8, 8, 'FD');
      doc.setFont(undefined, 'bold');
      doc.setTextColor(70);
      doc.text('Balance Due:', PAGE_W - MARGIN - PILL_W + 12, rightY + 26);
      doc.setTextColor(0);
      doc.text(`$${N(total).toFixed(2)}`, PAGE_W - MARGIN - 12, rightY + 26, { align: 'right' });
      rightY += PILL_H + 18;

      // 4) ВЫРАВНИВАНИЕ: компания слева и Bill To справа – на ОДНОЙ линии
      const yAligned = Math.max(logoBottom + 8, rightY); // не залезаем на логотип
      let compY = yAligned; // левый блок = компания
      rightY = yAligned;    // правый блок = Bill To

      // Company (слева)
      doc.setTextColor(0);
      doc.setFont(undefined, 'bold');
      doc.text('Sim Scope Inc.', MARGIN, compY);
      compY += 14;
      doc.setFont(undefined, 'normal');
      ['1587 E 19th St', 'Brooklyn, NY 11230', '(929) 412-9042', 'simscopeinc@gmail.com'].forEach((t) => {
        doc.text(t, MARGIN, compY);
        compY += 12;
      });

      // Bill To (справа) — плотные интервалы
      const billX = PAGE_W - MARGIN - PILL_W;
      const GAP_AFTER_TITLE = 13;
      const LINE = 11;

      doc.setFont(undefined, 'bold');
      doc.text('Bill To:', billX, rightY);
      rightY += GAP_AFTER_TITLE;

      doc.setFont(undefined, 'normal');
      const billLines = [billName, billAddress, billPhone, billEmail]
        .map(v => (v ?? '').toString().trim())
        .filter(v => v.length > 0);

      billLines.forEach((line, idx) => {
        doc.text(line, billX, rightY + idx * LINE);
      });
      rightY += billLines.length * LINE;

      // 5) Таблица
      const tableStartY = Math.max(compY, rightY) + 16;
      const body = rows.map((r) => [
        r.name || (r.type === 'service' ? 'Service' : 'Item'),
        String(N(r.qty)),
        `$${N(r.price).toFixed(2)}`,
        `$${(N(r.qty) * N(r.price)).toFixed(2)}`,
      ]);

      autoTable(doc, {
        startY: tableStartY,
        head: [['Description', 'Qty', 'Unit Price', 'Amount']],
        body,
        styles: { fontSize: 10, cellPadding: 6, lineWidth: 0.1, textColor: [60, 60, 60] },
        headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: MARGIN, right: MARGIN },
        columnStyles: {
          0: { cellWidth: 360 },
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 80, halign: 'right' },
          3: { cellWidth: 80, halign: 'right' },
        },
      });

      // 6) Итоги справа
      let endY = doc.lastAutoTable.finalY + 10;
      const totalsRightX = PAGE_W - MARGIN;
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: $${N(subtotal).toFixed(2)}`, totalsRightX, endY, { align: 'right' });
      endY += 16;
      doc.text(`Discount: -$${N(discount).toFixed(2)}`, totalsRightX, endY, { align: 'right' });
      endY += 18;
      doc.setFontSize(12);
      doc.text(`Total: $${N(total).toFixed(2)}`, totalsRightX, endY, { align: 'right' });
      endY += 22;

      // 7) Warranty
      if (includeWarranty && Number(warrantyDays) > 0) {
        const maxW = PAGE_W - MARGIN * 2;
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`Warranty (${Number(warrantyDays)} days):`, MARGIN, endY);
        endY += 12;

        doc.setFont(undefined, 'normal');
        const txt =
          `A ${Number(
            warrantyDays
          )}-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. `
          + `The warranty does not cover other components or the appliance as a whole, normal wear, consumables, `
          + `damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. `
          + `The warranty starts on the job completion date and is valid only when the invoice is paid in full.`;
        const lines = doc.splitTextToSize(txt, maxW);
        doc.text(lines, MARGIN, endY + 2);
      }

      // Низ страницы
      doc.setFontSize(10);
      doc.text('Thank you for your business!', PAGE_W - MARGIN, 760, { align: 'right' });

      const filename = `invoice_${thisInvoiceNo}.pdf`;
      doc.save(filename);

      // upload storage
      try {
        const pdfBlob = doc.output('blob');
        const storageKey = `${id}/${filename}`;
        const up = await supabase.storage.from('invoices').upload(storageKey, pdfBlob, {
          cacheControl: '3600', contentType: 'application/pdf', upsert: true,
        });
        if (up.error) console.warn('Upload invoice PDF failed:', up.error);
      } catch (e) {
        console.warn('PDF upload error:', e);
      }

      setInvoiceNo(String((Number(thisInvoiceNo) || 0) + 1));
    } catch (e) {
      console.error('saveAndDownload error:', e);
      alert(`Failed to save or download invoice: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- таблица UI ---------------- */
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
      </div>

      <div style={S.card}>
        {/* Превью совпадает по структуре с PDF */}
        <div style={S.header}>
          <div>
            {logoDataURL ? (
              <img src={logoDataURL} alt="logo" style={{ width: 80, height: 80, objectFit: 'contain' }} />
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: 12, background: '#f3f4f6' }} />
            )}
            <div style={{ marginTop: 8, fontWeight: 700 }}>Sim Scope Inc.</div>
            <div style={{ color: '#6b7280', lineHeight: 1.4 }}>
              1587 E 19th St<br />
              Brooklyn, NY 11230<br />
              (929) 412-9042<br />
              simscopeinc@gmail.com
            </div>
          </div>

          <div />

          <div style={{ textAlign: 'right' }}>
            <div style={S.invoiceTitle}>INVOICE</div>
            <div style={S.invoiceNo}># {invoiceNo || '—'}</div>

            <div style={{ marginTop: 10, color: '#6b7280', fontWeight: 600 }}>
              Date:&nbsp;
              <input
                type="date"
                style={{ ...S.input, width: 180, display: 'inline-block' }}
                value={toInputDate(invoiceDate)}
                onChange={(e) => setInvoiceDate(fromInputDate(e.target.value))}
              />
            </div>

            <div style={{ ...S.pill, marginTop: 8 }}>
              <div style={S.pillRow}>
                <div style={S.pillCellLeft}>Balance Due:</div>
                <div style={S.pillCellRight}>${N(total).toFixed(2)}</div>
              </div>
            </div>

            <div style={{ marginTop: 12, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Bill To</div>
              <div style={{ color: '#111' }}>
                <div>{billName}</div>
                <div>{billAddress}</div>
                <div>{billPhone}</div>
                <div>{billEmail}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={S.sep} />

        {/* Таблица */}
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

        {/* Итоги */}
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

        {/* Warranty toggle */}
        <div style={{ marginTop: 16, color: '#6b7280' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={includeWarranty} onChange={(e) => setIncludeWarranty(e.target.checked)} />
            Include warranty
          </label>
          <span style={{ marginLeft: 10 }}>Days:&nbsp;</span>
          <input type="number" min={0} style={{ ...S.input, width: 90, display: 'inline-block' }}
                 value={warrantyDays} onChange={(e) => setWarrantyDays(Number(e.target.value || 0))} />
        </div>
      </div>
    </div>
  );
}


