// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* -------------------------- small utils -------------------------- */

const CURRENCY = (n) => `$${Number(n || 0).toFixed(2)}`;
const useQuery = () => new URLSearchParams(useLocation().search);

async function loadLogoOriginalDataURL() {
  const res = await fetch('/logo_invoice_header.png');
  if (!res.ok) throw new Error('Logo not found');
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onloadend = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
  const fmt = (dataUrl || '').slice(5, 14).toUpperCase().includes('PNG') ? 'PNG' : 'JPEG';
  return { dataUrl, format: fmt };
}

function createPdf() {
  return new jsPDF({
    unit: 'mm',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
    precision: 2,
  });
}

/* ----------------------------- component ----------------------------- */

export default function InvoicePage() {
  const { id } = useParams();                // "new" | <jobId>
  const q = useQuery();                      // optional ?invoice=<uuid> для редактирования
  const invoiceIdFromQuery = q.get('invoice'); // режим редактирования сохранённого инвойса
  const jobIdFromQuery = q.get('jobId');       // для /invoice/new?jobId=...

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // данные инвойса
  const [invoiceId, setInvoiceId] = useState(null); // uuid в таблице invoices
  const [number, setNumber] = useState('');          // номер (int/строка)
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);
  const [discount, setDiscount] = useState(0);

  // данные клиента/позиций
  const [client, setClient] = useState({ full_name: '', address: '', phone: '', email: '' });
  const [rows, setRows] = useState([]); // [{type:'service'|'material', name, qty, price}]

  const warrantyText = useMemo(() => {
    const days = Number(warrantyDays || 0);
    const plural = days === 1 ? 'day' : 'days';
    return (
      `A ${days}-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ` +
      `The warranty does not cover other components or the appliance as a whole, normal wear, consumables, ` +
      `damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ` +
      `The warranty starts on the job completion date and is valid only when the invoice is paid in full.`
    );
  }, [warrantyDays]);

  const subtotal = useMemo(
    () => rows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.price || 0), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, subtotal - Number(discount || 0)), [subtotal, discount]);

  /* -------------------------- loaders -------------------------- */

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr('');

        // 1) Режим редактирования сохранённого инвойса
        if (invoiceIdFromQuery) {
          const { data, error } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', invoiceIdFromQuery)
            .maybeSingle();
          if (error || !data) throw new Error('Invoice not found');

          if (!alive) return;
          setInvoiceId(data.id);
          setNumber(String(data.number ?? ''));
          setIncludeWarranty(!!data.include_warranty);
          setWarrantyDays(Number(data.warranty_days ?? 60));
          setDiscount(Number(data.discount ?? 0));
          setClient({
            full_name: data.client_name || '',
            address: data.client_address || '',
            phone: data.client_phone || '',
            email: data.client_email || '',
          });
          setRows(Array.isArray(data.rows) ? data.rows : []);
          setLoading(false);
          return;
        }

        // 2) Автонумерация — берём следующий номер из таблицы invoices
        const nextNum = await getNextInvoiceNumber();

        // 3) Режим "создать по заявке"
        const jobId = id === 'new' ? (jobIdFromQuery || null) : id;
        if (jobId) {
          const { data: j } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
          let c = null;
          if (j?.client_id) {
            const { data: cdb } = await supabase
              .from('clients')
              .select('*')
              .eq('id', j.client_id)
              .maybeSingle();
            if (cdb) c = cdb;
          }
          setClient({
            full_name: c?.full_name || j?.client_name || j?.full_name || '',
            address: c?.address || j?.client_address || j?.address || '',
            phone:   c?.phone   || j?.client_phone   || j?.phone   || '',
            email:   c?.email   || j?.client_email   || j?.email   || '',
          });
          setRows([
            { type: 'service', name: 'Labor',           qty: 1, price: Number(j?.labor_price || 0) },
            { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(j?.scf || 0) },
          ]);
        } else {
          // 4) Пустой инвойс
          setRows([{ type: 'service', name: 'Labor', qty: 1, price: 0 }]);
        }

        setNumber(String(nextNum));
      } catch (e) {
        console.error(e);
        if (alive) setErr(e.message || 'Load error');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [id, invoiceIdFromQuery, jobIdFromQuery]);

  async function getNextInvoiceNumber() {
    const { data, error } = await supabase
      .from('invoices')
      .select('number')
      .order('number', { ascending: false })
      .limit(1);
    if (error) return 1;
    const last = data?.[0]?.number ?? 0;
    const n = Number(last || 0);
    return Number.isFinite(n) ? n + 1 : 1;
  }

  /* -------------------------- edits -------------------------- */

  const changeRow = (i, k, v) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[i] = { ...cp[i], [k]: k === 'name' || k === 'type' ? v : Number(v || 0) };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  /* -------------------------- save / pdf -------------------------- */

  async function handleSave(alsoGeneratePdf = false) {
    try {
      setErr('');
      const payload = {
        // core
        number: Number(number || 0) || null,
        include_warranty: includeWarranty,
        warranty_days: Number(warrantyDays || 0) || null,
        discount: Number(discount || 0) || 0,
        subtotal,
        total,

        // client
        client_name: client.full_name || '',
        client_address: client.address || '',
        client_phone: client.phone || '',
        client_email: client.email || '',

        rows,
        // если страница открыта по заявке — сохраним связь
        job_id: id && id !== 'new' ? id : (jobIdFromQuery || null),
      };

      let savedId = invoiceId;

      if (invoiceId) {
        const { error } = await supabase.from('invoices').update(payload).eq('id', invoiceId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('invoices').insert(payload).select('id').single();
        if (error) throw error;
        savedId = data.id;
        setInvoiceId(savedId);
        // если мы создавали из /invoice/new — полезно обновить URL с ?invoice=...
        if (id === 'new' && typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('invoice', savedId);
          window.history.replaceState({}, '', url.toString());
        }
      }

      // PDF в хранилище (bucket "invoices")
      if (alsoGeneratePdf) {
        const fileName = `${number || savedId}.pdf`;
        const pdfBlob = await buildPdfBlob();
        const { error: upErr } = await supabase.storage
          .from('invoices')
          .upload(fileName, pdfBlob, { upsert: true, contentType: 'application/pdf' });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from('invoices').getPublicUrl(fileName);
        const pdfUrl = pub?.publicUrl || null;
        if (pdfUrl) {
          await supabase.from('invoices').update({ pdf_url: pdfUrl }).eq('id', savedId);
        }
        // скачать локально
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pdfBlob);
        a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
      }

      alert('Invoice saved');
    } catch (e) {
      console.error(e);
      setErr(e.message || 'Save error');
      alert('Failed to save invoice');
    }
  }

  async function buildPdfBlob() {
    const doc = createPdf();

    // ЛОГО (всегда оригинал, без ужатия)
    try {
      const { dataUrl, format } = await loadLogoOriginalDataURL();
      doc.addImage(dataUrl, format, 170, 10, 28, 28, undefined, 'FAST');
    } catch {}

    // Шапка
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(`INVOICE #${number || '—'}`, 100, 50, { align: 'center' });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 57, { align: 'center' });

    // Клиент
    let yL = 68;
    doc.setFont('helvetica', 'bold'); doc.text('Bill To:', 14, yL); yL += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (client?.full_name) { doc.text(String(client.full_name), 14, yL); yL += 5; }
    if (client?.address)   { doc.text(String(client.address),   14, yL); yL += 5; }
    if (client?.phone)     { doc.text(String(client.phone),     14, yL); yL += 5; }
    if (client?.email)     { doc.text(String(client.email),     14, yL); yL += 5; }

    // Компания
    let yR = 68;
    doc.setFont('helvetica', 'bold'); doc.text('Sim Scope Inc.', 200, yR, { align: 'right' }); yR += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('1587 E 19th St', 200, yR, { align: 'right' }); yR += 5;
    doc.text('Brooklyn, NY 11230', 200, yR, { align: 'right' }); yR += 5;
    doc.text('(929) 412-9042', 200, yR, { align: 'right' }); yR += 5;
    doc.text('simscopeinc@gmail.com', 200, yR, { align: 'right' });

    // Таблица
    const serviceRows = rows
      .filter(r => r.type === 'service')
      .map(r => [r.name, r.qty, CURRENCY(r.price), CURRENCY(r.qty * r.price)]);

    const materialRows = rows
      .filter(r => r.type === 'material')
      .map(r => [r.name, r.qty, CURRENCY(r.price), CURRENCY(r.qty * r.price)]);

    autoTable(doc, {
      startY: Math.max(yL, yR) + 8,
      head: [['Description', 'Qty', 'Unit Price', 'Amount']],
      body: [
        ...serviceRows,
        [{ content: 'MATERIALS', colSpan: 4, styles: { halign: 'left', fillColor: [230,230,230], fontStyle: 'bold' } }],
        ...materialRows,
      ],
      styles: { fontSize: 9, halign: 'left', lineWidth: 0.1 },
      headStyles: { fillColor: [245,245,245], textColor: 0, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255,255,255] },
      margin: { left: 14, right: 20 }, // небольшой отступ справа
      columnStyles: { 0: { cellWidth: 122 }, 1: { cellWidth: 18 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 } },
    });

    let y = doc.lastAutoTable.finalY + 6;

    // Итого
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`Subtotal: ${CURRENCY(subtotal)}`, 200, y, { align: 'right' }); y += 5;
    doc.text(`Discount: -${CURRENCY(discount)}`, 200, y, { align: 'right' }); y += 5;
    doc.text(`Total Due: ${CURRENCY(total)}`, 200, y, { align: 'right' }); y += 7;

    // Гарантия
    if (includeWarranty) {
      const days = Number(warrantyDays || 0);
      const plural = days === 1 ? 'day' : 'days';
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(`Warranty (${days} ${plural}):`, 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(warrantyText, 182);
      doc.text(wrapped, 14, y); y += wrapped.length * 4 + 5;
    }

    doc.setFont('helvetica', 'italic'); doc.setFontSize(10);
    doc.text('Thank you for your business!', 200, y, { align: 'right' });

    // -> Blob
    return doc.output('blob');
  }

  /* -------------------------- render -------------------------- */

  if (loading) return <div className="p-4">Loading…</div>;
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-4 items-center">
        <img src="/logo_invoice_header.png" alt="Logo" style={{ width: 60, height: 60, objectFit: 'contain' }} />
        <div className="text-right text-sm">
          <p><strong>Sim Scope Inc.</strong></p>
          <p>1587 E 19th St, Brooklyn, NY 11230</p>
          <p>(929) 412-9042</p>
          <p>simscopeinc@gmail.com</p>
        </div>
      </div>

      {err && <div className="text-red-600 mb-3">{err}</div>}

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-semibold">Invoice #</label>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="border rounded px-3 py-2 w-48"
            placeholder="auto"
          />
          <div className="text-xs text-gray-500 mt-1">Можно переопределить вручную</div>
        </div>

        <div className="grow" />

        <div className="flex flex-col gap-2 text-sm items-start">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="scale-110"
              checked={includeWarranty}
              onChange={(e) => setIncludeWarranty(e.target.checked)}
            />
            Include warranty block
          </label>

          {includeWarranty && (
            <label className="inline-flex items-center gap-2">
              Days:
              <input
                type="number"
                min={1}
                className="border rounded px-2 py-1 w-24 text-right"
                value={warrantyDays}
                onChange={(e) => setWarrantyDays(Math.max(1, Number(e.target.value || 60)))}
              />
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        <div className="font-semibold">Bill To:</div>
        <input
          className="border rounded px-2 py-1"
          placeholder="Full name"
          value={client.full_name}
          onChange={(e) => setClient({ ...client, full_name: e.target.value })}
        />
        <input
          className="border rounded px-2 py-1"
          placeholder="Address"
          value={client.address}
          onChange={(e) => setClient({ ...client, address: e.target.value })}
        />
        <div className="flex gap-2">
          <input
            className="border rounded px-2 py-1 grow"
            placeholder="Phone"
            value={client.phone}
            onChange={(e) => setClient({ ...client, phone: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1 grow"
            placeholder="Email"
            value={client.email}
            onChange={(e) => setClient({ ...client, email: e.target.value })}
          />
        </div>
      </div>

      <table className="w-full text-sm mt-4 border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">Type</th>
            <th className="text-left">Name</th>
            <th className="w-20">Qty</th>
            <th className="w-24">Price</th>
            <th className="w-28">Amount</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">
                <select value={r.type} onChange={(e) => changeRow(i, 'type', e.target.value)} className="border rounded px-2 py-1">
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td>
                <input value={r.name} onChange={(e) => changeRow(i, 'name', e.target.value)} className="border rounded px-2 py-1 w-full" />
              </td>
              <td className="text-center">
                <input type="number" value={r.qty} onChange={(e) => changeRow(i, 'qty', e.target.value)} className="border rounded px-2 py-1 w-20 text-center" />
              </td>
              <td className="text-right">
                <input type="number" value={r.price} onChange={(e) => changeRow(i, 'price', e.target.value)} className="border rounded px-2 py-1 w-24 text-right" />
              </td>
              <td className="text-right">{CURRENCY(r.qty * r.price)}</td>
              <td className="text-center">
                <button onClick={() => delRow(i)} className="text-red-600 px-2" title="Delete">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3">
        <button onClick={addRow} className="bg-gray-200 text-black px-3 py-1 rounded">➕ Add row</button>
      </div>

      <div className="mt-6 text-right">
        <div className="text-sm">Subtotal: {CURRENCY(subtotal)}</div>
        <div className="inline-flex items-center gap-2 mt-2">
          <label className="font-semibold">Discount $:</label>
          <input
            type="number"
            className="border rounded px-2 py-1 w-24 text-right"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value || 0))}
          />
        </div>
        <div className="font-bold text-lg mt-2">Total Due: {CURRENCY(total)}</div>
      </div>

      {includeWarranty && (
        <div className="mt-6 p-3 border rounded bg-gray-50 text-sm leading-5">
          <div className="font-semibold mb-1">Warranty ({warrantyDays} {Number(warrantyDays) === 1 ? 'day' : 'days'}):</div>
          <div>{warrantyText}</div>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <button onClick={() => handleSave(false)} className="bg-gray-800 text-white px-4 py-2 rounded">
          💾 Save
        </button>
        <button onClick={() => handleSave(true)} className="bg-blue-600 text-white px-4 py-2 rounded">
          💾 Save & Download PDF
        </button>
      </div>
    </div>
  );
}
