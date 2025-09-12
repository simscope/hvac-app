// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ------------------------ Helpers & settings ------------------------ */

const CURRENCY = (n) => `$${Number(n || 0).toFixed(2)}`;

function createPdf() {
  return new jsPDF({
    unit: 'mm',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
    precision: 2,
  });
}

// keep logo crisp; compress but don't degrade too much
async function loadSmallLogoDataURL(maxWidth = 260) {
  const res = await fetch('/logo_invoice_header.png');
  if (!res.ok) throw new Error('Logo not found');
  const blob = await res.blob();

  const img = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.src = URL.createObjectURL(blob);
  });

  const scale = Math.min(1, maxWidth / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const webp = canvas.toDataURL('image/webp', 0.72);
  const isWebp = webp.startsWith('data:image/webp');
  const dataUrl = isWebp ? webp : canvas.toDataURL('image/jpeg', 0.72);

  URL.revokeObjectURL(img.src);
  return { dataUrl, format: isWebp ? 'WEBP' : 'JPEG' };
}

/* ----------------------------- Component ----------------------------- */

export default function InvoicePage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [includeWarranty, setIncludeWarranty] = useState(true); // ← NEW
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // English warranty text
  const warrantyText =
    'A 60-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ' +
    'The warranty does not cover other components or the appliance as a whole, normal wear, consumables, ' +
    'damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ' +
    'The warranty starts on the job completion date and is valid only when the invoice is paid in full.';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr('');
        if (!id) throw new Error('Job ID is missing');

        const { data: j, error: ej } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (ej || !j) throw new Error('Failed to load job');
        if (!alive) return;
        setJob(j);

        let c = null;
        if (j.client_id) {
          const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('id', j.client_id)
            .maybeSingle();
          if (!error && data) c = data;
        }
        if (!c) {
          c = {
            full_name: j.client_name || j.full_name || '',
            phone: j.client_phone || j.phone || '',
            email: j.client_email || j.email || '',
            address: j.client_address || j.address || '',
          };
        }
        if (!alive) return;
        setClient(c);

        const { data: mats } = await supabase
          .from('materials')
          .select('*')
          .eq('job_id', id);

        const materialRows = (mats || []).map((m) => ({
          type: 'material',
          name: m.name || '',
          qty: Number(m.quantity ?? m.qty ?? 0),
          price: Number(m.price ?? 0),
        }));

        const initial = [
          { type: 'service', name: 'Labor', qty: 1, price: Number(j.labor_price || 0) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(j.scf || 0) },
          ...materialRows,
        ];
        if (!alive) return;
        setRows(initial);
      } catch (e) {
        console.error(e);
        if (alive) setErr(e.message || 'Load error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const subtotal = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.qty || 0) * Number(r.price || 0), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, subtotal - Number(discount || 0)), [subtotal, discount]);

  const handleChange = (i, k, v) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[i] = { ...cp[i], [k]: k === 'name' || k === 'type' ? v : Number(v || 0) };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  const downloadPdf = async () => {
    try {
      const doc = createPdf();

      // logo
      try {
        const { dataUrl, format } = await loadSmallLogoDataURL(260);
        doc.addImage(dataUrl, format, 170, 10, 28, 28, undefined, 'FAST');
      } catch {}

      // header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(`INVOICE #${job?.job_number || id}`, 100, 50, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 57, { align: 'center' });

      // client (left)
      let yL = 68;
      doc.setFont('helvetica', 'bold'); doc.text('Bill To:', 14, yL); yL += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      if (client?.full_name) { doc.text(String(client.full_name), 14, yL); yL += 5; }
      if (client?.address)   { doc.text(String(client.address),   14, yL); yL += 5; }
      if (client?.phone)     { doc.text(String(client.phone),     14, yL); yL += 5; }
      if (client?.email)     { doc.text(String(client.email),     14, yL); yL += 5; }

      // company (right)
      let yR = 68;
      doc.setFont('helvetica', 'bold'); doc.text('Sim Scope Inc.', 200, yR, { align: 'right' }); yR += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text('1587 E 19th St', 200, yR, { align: 'right' }); yR += 5;
      doc.text('Brooklyn, NY 11230', 200, yR, { align: 'right' }); yR += 5;
      doc.text('(929) 412-9042', 200, yR, { align: 'right' }); yR += 5;
      doc.text('simscopeinc@gmail.com', 200, yR, { align: 'right' });

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
        margin: { left: 14, right: 20 },       // extra right gutter
        columnStyles: { 0: { cellWidth: 122 }, 1: { cellWidth: 18 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 } },
      });

      let y = doc.lastAutoTable.finalY + 6;

      // totals
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(`Subtotal: ${CURRENCY(subtotal)}`, 200, y, { align: 'right' }); y += 5;
      doc.text(`Discount: -${CURRENCY(discount)}`, 200, y, { align: 'right' }); y += 5;
      doc.text(`Total Due: ${CURRENCY(total)}`, 200, y, { align: 'right' }); y += 7;

      // warranty — only if enabled
      if (includeWarranty) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text('Warranty (60 days):', 14, y); y += 5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const wrapped = doc.splitTextToSize(warrantyText, 182);
        doc.text(wrapped, 14, y); y += wrapped.length * 4 + 5;
      }

      doc.setFont('helvetica', 'italic'); doc.setFontSize(10);
      doc.text('Thank you for your business!', 200, y, { align: 'right' });

      doc.save(`invoice_${job?.job_number || id}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Failed to generate PDF');
    }
  };

  if (loading) return <div className="p-4">Loading…</div>;
  if (err) return <div className="p-4 text-red-600">Error: {err}</div>;

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

      <hr className="my-4" />

      <div className="flex flex-wrap gap-6 items-end">
        <div>
          <h2 className="text-xl font-bold mb-1">Invoice #{job?.job_number || id}</h2>
          <div className="text-sm text-gray-700">Date: {new Date().toLocaleDateString()}</div>
        </div>

        <div className="grow" />

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="scale-110"
            checked={includeWarranty}
            onChange={(e) => setIncludeWarranty(e.target.checked)}
          />
          Include 60-day warranty in invoice
        </label>
      </div>

      <div className="mt-3 text-sm">
        <div className="font-semibold mb-1">Bill To:</div>
        <div>{client?.full_name || '—'}</div>
        <div>{client?.address || '—'}</div>
        <div>{client?.phone || '—'}</div>
        <div>{client?.email || '—'}</div>
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
                <select value={r.type} onChange={(e) => handleChange(i, 'type', e.target.value)} className="border rounded px-2 py-1">
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td>
                <input value={r.name} onChange={(e) => handleChange(i, 'name', e.target.value)} className="border rounded px-2 py-1 w-full" />
              </td>
              <td className="text-center">
                <input type="number" value={r.qty} onChange={(e) => handleChange(i, 'qty', e.target.value)} className="border rounded px-2 py-1 w-20 text-center" />
              </td>
              <td className="text-right">
                <input type="number" value={r.price} onChange={(e) => handleChange(i, 'price', e.target.value)} className="border rounded px-2 py-1 w-24 text-right" />
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
        <div className="font-bold text-lg mt-2">Total Due: {CURRENCY(subtotal - Number(discount || 0))}</div>
      </div>

      {includeWarranty && (
        <div className="mt-6 p-3 border rounded bg-gray-50 text-sm leading-5">
          <div className="font-semibold mb-1">Warranty (60 days):</div>
          <div>{warrantyText}</div>
        </div>
      )}

      <div className="mt-6">
        <button onClick={downloadPdf} className="bg-blue-600 text-white px-4 py-2 rounded">📄 Download PDF</button>
      </div>
    </div>
  );
}
