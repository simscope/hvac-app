import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ------ helpers ------
const n = (v) => Number(v || 0);
const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const todayISO = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function loadLogo() {
  try {
    const res = await fetch('/logo_invoice_header.png', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    return await new Promise((r) => {
      const fr = new FileReader();
      fr.onloadend = () => r(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function InvoicePage() {
  const { id: jobIdParam } = useParams(); // job id (опционален)

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoDataURL, setLogoDataURL] = useState(null);
  const [jobId, setJobId] = useState(null);

  // Шапка
  const [invoiceNumber, setInvoiceNumber] = useState(''); // печатаем в PDF (в БД номера нет)
  const [invoiceDate, setInvoiceDate] = useState(todayISO());

  // Клиент (в БД нет — только для PDF)
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Строки
  const [rows, setRows] = useState([
    { type: 'service', name: 'Labor', qty: 1, price: 0 },
    { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
  ]);

  // Скидка и тех %
  const [discount, setDiscount] = useState(0);
  const [techPercent, setTechPercent] = useState(0);

  // Гарантия
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  // ----- загрузка лого + (опционально) подтянуть заявку -----
  useEffect(() => {
    (async () => {
      setLoading(true);
      setLogoDataURL(await loadLogo());

      const id = jobIdParam || null;
      setJobId(id);

      if (id) {
        const { data: job } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        // клиент из clients (если есть), иначе — fallback из jobs
        if (job?.client_id) {
          const { data: c } = await supabase
            .from('clients')
            .select('full_name,address,phone,email')
            .eq('id', job.client_id)
            .maybeSingle();
          if (c) {
            setCustomerName(c.full_name || '');
            setCustomerAddress(c.address || '');
            setCustomerPhone(c.phone || '');
            setCustomerEmail(c.email || '');
          }
        } else {
          setCustomerName(job?.client_name || job?.full_name || '');
          setCustomerAddress(job?.client_address || job?.address || '');
          setCustomerPhone(job?.client_phone || job?.phone || '');
          setCustomerEmail(job?.client_email || job?.email || '');
        }

        // Проставим Labor/SCF из заявки
        const labor = n(job?.labor_price);
        const scf = n(job?.scf);
        setRows((p) => {
          const cp = [...p];
          cp[0] = { type: 'service', name: 'Labor', qty: 1, price: labor };
          cp[1] = { type: 'service', name: 'Service Call Fee', qty: 1, price: scf };
          return cp;
        });

        // Материалы
        const { data: mats } = await supabase
          .from('materials')
          .select('name,qty,price')
          .eq('job_id', id);

        if (mats?.length) {
          setRows((p) => [
            ...p,
            ...mats.map((m) => ({
              type: 'material',
              name: m.name || '',
              qty: n(m.qty) || 1,
              price: n(m.price),
            })),
          ]);
        }
      }

      setLoading(false);
    })();
  }, [jobIdParam]);

  // ----- суммы -----
  const laborCost = useMemo(
    () => rows.filter((r) => r.type === 'service').reduce((s, r) => s + n(r.qty) * n(r.price), 0),
    [rows]
  );
  const partsCost = useMemo(
    () => rows.filter((r) => r.type === 'material').reduce((s, r) => s + n(r.qty) * n(r.price), 0),
    [rows]
  );
  const subtotal = useMemo(() => laborCost + partsCost, [laborCost, partsCost]);
  const total = useMemo(() => Math.max(0, subtotal - n(discount)), [subtotal, discount]);
  const techTotal = useMemo(() => (laborCost * n(techPercent)) / 100, [laborCost, techPercent]);

  // ----- строки -----
  const changeRow = (idx, field, value) => {
    setRows((p) => {
      const cp = [...p];
      cp[idx] = {
        ...cp[idx],
        [field]: field === 'qty' || field === 'price' ? Number(value || 0) : value,
      };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  // ----- save + PDF -----
  const onSaveAndDownload = async () => {
    try {
      setSaving(true);

      // 1) вставляем только те колонки, что есть в твоей таблице
      const insertPayload = {
        job_id: jobId ?? null,
        labor_cost: laborCost,
        parts_cost: partsCost,
        technician_percent: n(techPercent),
        technician_total: techTotal, // если нужна другая формула — скажи
        created_at: invoiceDate || todayISO(),
      };

      const { error: insErr } = await supabase.from('invoices').insert(insertPayload);
      if (insErr) {
        console.error(insErr);
        alert(insErr.message || 'Не удалось сохранить инвойс');
        setSaving(false);
        return;
      }

      // 2) генерируем PDF
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const W = doc.internal.pageSize.getWidth();
      const margin = 40;
      let y = 40;

      if (logoDataURL) doc.addImage(logoDataURL, 'PNG', W - 110, y, 70, 70);

      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${invoiceNumber || '—'}`, W / 2, y + 20, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Date: ${new Date(invoiceDate).toLocaleDateString()}`, W / 2, y + 36, { align: 'center' });

      y += 80;
      doc.setFont(undefined, 'bold');
      doc.text('Bill To:', margin, y);
      doc.setFont(undefined, 'normal'); y += 14;
      if (customerName) { doc.text(String(customerName), margin, y); y += 14; }
      if (customerAddress) { doc.text(String(customerAddress), margin, y); y += 14; }
      if (customerPhone) { doc.text(String(customerPhone), margin, y); y += 14; }
      if (customerEmail) { doc.text(String(customerEmail), margin, y); y += 14; }

      const rx = W - margin; let yR = 120;
      doc.setFont(undefined, 'bold'); doc.text('Sim Scope Inc.', rx, yR, { align: 'right' });
      doc.setFont(undefined, 'normal'); yR += 14; doc.text('1587 E 19th St', rx, yR, { align: 'right' });
      yR += 14; doc.text('Brooklyn, NY 11230', rx, yR, { align: 'right' });
      yR += 14; doc.text('(929) 412-9042', rx, yR, { align: 'right' });
      yR += 14; doc.text('simscopeinc@gmail.com', rx, yR, { align: 'right' });

      const serviceRows = rows.filter((r) => r.type === 'service');
      const materialRows = rows.filter((r) => r.type === 'material');

      const body = [
        ...serviceRows.map((r) => [r.name, String(r.qty), money(r.price), money(n(r.qty) * n(r.price))]),
      ];
      if (materialRows.length) {
        body.push([{ content: 'MATERIALS', colSpan: 4, styles: { fillColor: [238,238,238], halign: 'left', fontStyle: 'bold' } }]);
        materialRows.forEach((r) => body.push([r.name, String(r.qty), money(r.price), money(n(r.qty) * n(r.price))]));
      }

      autoTable(doc, {
        startY: Math.max(y, yR) + 10,
        head: [['Description', 'Qty', 'Unit Price', 'Amount']],
        body,
        styles: { fontSize: 10, cellPadding: 6, lineWidth: 0.1 },
        headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
        margin: { left: margin, right: margin },
        columnStyles: {
          0: { cellWidth: W - margin*2 - 150 },
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 55, halign: 'right' },
          3: { cellWidth: 55, halign: 'right' },
        },
      });

      let endY = doc.lastAutoTable.finalY + 12;
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: ${money(subtotal)}`, rx, endY, { align: 'right' }); endY += 14;
      doc.text(`Discount: -${money(discount)}`, rx, endY, { align: 'right' }); endY += 14;
      doc.text(`Total Due: ${money(total)}`, rx, endY, { align: 'right' }); endY += 14;
      doc.setFont(undefined, 'normal');
      doc.text(`Tech %: ${n(techPercent)}%  •  Tech Total: ${money(techTotal)}`, rx, endY, { align: 'right' });

      endY += 20;
      if (includeWarranty) {
        doc.setFont(undefined, 'bold');
        doc.text(`Warranty (${Number(warrantyDays || 60)} days):`, margin, endY);
        doc.setFont(undefined, 'normal'); endY += 14;
        const t =
          'A limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ' +
          'The warranty does not cover other components or the appliance as a whole, normal wear, consumables, ' +
          'damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ' +
          'The warranty starts on the job completion date and is valid only when the invoice is paid in full.';
        const lines = doc.splitTextToSize(t, W - margin*2);
        doc.text(lines, margin, endY); endY += lines.length * 12;
      }

      endY += 20;
      doc.setFont(undefined, 'italic');
      doc.text('Thank you for your business!', margin, endY);

      doc.save(`invoice_${invoiceNumber || 'new'}.pdf`);
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Failed to save or download invoice');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4">Загрузка…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-3">Invoice</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-sm font-semibold">Invoice #</label>
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="печатается только в PDF"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Date</label>
          <input
            type="date"
            className="border rounded px-3 py-2 w-full"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Tech %</label>
          <input
            type="number"
            className="border rounded px-3 py-2 w-full text-right"
            value={techPercent}
            onChange={(e) => setTechPercent(Number(e.target.value || 0))}
          />
        </div>
      </div>

      <div className="md:grid md:grid-cols-2 md:gap-3 mb-4">
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">Bill To</div>
          <div className="grid grid-cols-1 gap-2">
            <input className="border rounded px-3 py-2" placeholder="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Address" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
          </div>
        </div>

        <div className="border rounded p-3 mt-3 md:mt-0">
          <div className="font-semibold mb-2">Warranty</div>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeWarranty} onChange={(e) => setIncludeWarranty(e.target.checked)} />
            Include warranty block
          </label>
          <div className="mt-2 flex items-center gap-2">
            <span>Days:</span>
            <input
              type="number"
              className="border rounded px-2 py-1 w-24 text-right"
              value={warrantyDays}
              onChange={(e) => setWarrantyDays(Number(e.target.value || 0))}
            />
          </div>
        </div>
      </div>

      {/* таблица строк */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left border px-2 py-2">Type</th>
              <th className="text-left border px-2 py-2">Name</th>
              <th className="text-center border px-2 py-2" style={{ width: 70 }}>Qty</th>
              <th className="text-right border px-2 py-2" style={{ width: 120 }}>Price</th>
              <th className="text-right border px-2 py-2" style={{ width: 120 }}>Amount</th>
              <th className="border px-2 py-2" style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">
                  <select className="border rounded px-2 py-1" value={r.type} onChange={(e) => changeRow(i, 'type', e.target.value)}>
                    <option value="service">service</option>
                    <option value="material">material</option>
                  </select>
                </td>
                <td className="border px-2 py-1">
                  <input className="border rounded px-2 py-1 w-full" value={r.name} onChange={(e) => changeRow(i, 'name', e.target.value)} />
                </td>
                <td className="border px-2 py-1 text-center">
                  <input type="number" className="border rounded px-2 py-1 w-16 text-center" value={r.qty} onChange={(e) => changeRow(i, 'qty', e.target.value)} />
                </td>
                <td className="border px-2 py-1 text-right">
                  <input type="number" className="border rounded px-2 py-1 w-24 text-right" value={r.price} onChange={(e) => changeRow(i, 'price', e.target.value)} />
                </td>
                <td className="border px-2 py-1 text-right">{money(n(r.qty) * n(r.price))}</td>
                <td className="border px-2 py-1 text-center"><button className="text-red-600" onClick={() => delRow(i)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2">
        <button className="bg-gray-200 px-3 py-1 rounded" onClick={addRow}>+ Add row</button>
      </div>

      <div className="mt-4 text-right">
        <div>Labor: <strong>{money(laborCost)}</strong></div>
        <div>Materials: <strong>{money(partsCost)}</strong></div>
        <div className="mt-1">Subtotal: <strong>{money(subtotal)}</strong></div>
        <div className="inline-flex items-center gap-2 mt-2">
          <span className="font-semibold">Discount $:</span>
          <input
            type="number"
            className="border px-2 py-1 w-24 text-right"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value || 0))}
          />
        </div>
        <div className="font-bold text-lg mt-2">Total Due: {money(total)}</div>
      </div>

      <div className="mt-5">
        <button
          disabled={saving}
          onClick={onSaveAndDownload}
          className={`px-4 py-2 rounded text-white ${saving ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
          title="Сохраняет в public.invoices и скачивает PDF"
        >
          {saving ? 'Сохраняю…' : 'Сохранить и скачать PDF'}
        </button>
      </div>
    </div>
  );
}
