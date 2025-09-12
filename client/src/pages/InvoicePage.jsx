import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/** Загрузка логотипа из /public как dataURL для вставки в jsPDF */
async function loadLogoDataURL() {
  try {
    const res = await fetch('/logo_invoice_header.png', { cache: 'no-store' });
    if (!res.ok) throw new Error('Logo fetch error');
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return dataUrl;
  } catch {
    return null; // логотип необязателен
  }
}

/** Утилиты */
const n2 = (v) => Number(v || 0);
const toCurrency = (v) => `$${Number(v || 0).toFixed(2)}`;
const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function InvoicePage() {
  const { id: jobIdParam } = useParams(); // job id опциональный
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Шапка/клиент
  const [invoiceNumber, setInvoiceNumber] = useState(''); // оставить пустым => автонумерация БД
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Строки инвойса
  const [rows, setRows] = useState([
    { type: 'service', name: 'Labor', qty: 1, price: 0 },
    { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
  ]);
  const [discount, setDiscount] = useState(0);

  // Гарантия
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  // Служебные
  const [logoDataURL, setLogoDataURL] = useState(null);
  const [jobId, setJobId] = useState(null); // если пришёл :id

  /** Подтянуть логотип и (если нужно) заявку/клиента/материалы */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const dataUrl = await loadLogoDataURL();
      setLogoDataURL(dataUrl || null);

      const id = jobIdParam || null;
      setJobId(id);

      if (id) {
        // Подтягиваем заявку
        const { data: job, error: jobErr } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (jobErr) {
          console.error('job fetch error:', jobErr);
        }

        // Клиент
        if (job?.client_id) {
          const { data: c } = await supabase
            .from('clients')
            .select('full_name, address, phone, email')
            .eq('id', job.client_id)
            .maybeSingle();
          if (c) {
            setCustomerName(c.full_name || '');
            setCustomerAddress(c.address || '');
            setCustomerPhone(c.phone || '');
            setCustomerEmail(c.email || '');
          }
        } else {
          // fallback из самой заявки (если есть поля)
          setCustomerName(job?.client_name || job?.full_name || '');
          setCustomerAddress(job?.client_address || job?.address || '');
          setCustomerPhone(job?.client_phone || job?.phone || '');
          setCustomerEmail(job?.client_email || job?.email || '');
        }

        // SCF/Labor
        const scf = n2(job?.scf);
        const labor = n2(job?.labor_price);

        setRows((prev) => {
          const base = [...prev];
          // Labor
          base[0] = { type: 'service', name: 'Labor', qty: 1, price: labor };
          // SCF
          base[1] = { type: 'service', name: 'Service Call Fee', qty: 1, price: scf };
          return base;
        });

        // Материалы
        const { data: mats } = await supabase
          .from('materials')
          .select('name, qty, price')
          .eq('job_id', id);
        if (mats && mats.length) {
          setRows((prev) => {
            const base = [...prev];
            mats.forEach((m) =>
              base.push({
                type: 'material',
                name: m.name || '',
                qty: n2(m.qty) || 1,
                price: n2(m.price),
              })
            );
            return base;
          });
        }
      }

      setLoading(false);
    })();
  }, [jobIdParam]);

  /** Суммы */
  const subtotal = useMemo(
    () =>
      rows.reduce((sum, r) => sum + n2(r.qty) * n2(r.price), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, subtotal - n2(discount)), [subtotal, discount]);

  /** Работа со строками */
  const changeRow = (idx, field, value) => {
    setRows((prev) => {
      const cp = [...prev];
      const v =
        field === 'qty' || field === 'price'
          ? Number(value || 0)
          : value;
      cp[idx] = { ...cp[idx], [field]: v };
      return cp;
    });
  };
  const addRow = () => setRows((prev) => [...prev, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (idx) => setRows((prev) => prev.filter((_, i) => i !== idx));

  /** Сохранение в БД + скачивание PDF */
  const onSaveAndDownload = async () => {
    setSaving(true);
    try {
      // нужен автор для created_by
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) throw new Error('Auth required');
      const userId = authData.user.id;

      // Формируем payload
      const payload = {
        // invoice_number: если пусто — БД поставит default (sequence)
        ...(String(invoiceNumber).trim()
          ? { invoice_number: Number(invoiceNumber) }
          : {}),
        job_id: jobId ?? null,
        invoice_date: invoiceDate || todayISO(),

        customer_name: customerName || '',
        customer_address: customerAddress || '',
        customer_phone: customerPhone || '',
        customer_email: customerEmail || '',

        rows, // jsonb
        subtotal,
        discount: n2(discount),
        total,

        include_warranty: !!includeWarranty,
        warranty_days: Number(warrantyDays || 60),

        created_by: userId,
      };

      // INSERT -> вернёт готовый номер (если auto) и id
      const { data: rec, error: insErr } = await supabase
        .from('invoices')
        .insert(payload)
        .select('*')
        .single();

      if (insErr) {
        console.error(insErr);
        alert(insErr.message || 'Failed to save invoice');
        setSaving(false);
        return;
      }

      // Если номер был автогенерируемый — покажем его в UI
      if (!String(invoiceNumber).trim() && rec?.invoice_number != null) {
        setInvoiceNumber(String(rec.invoice_number));
      }

      // Генерация PDF
      const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // компактнее в pt
      const marginX = 40;
      let y = 40;

      // Логотип (не сжимаем дополнительно)
      if (logoDataURL) {
        doc.addImage(logoDataURL, 'PNG', doc.internal.pageSize.getWidth() - 110, y, 70, 70);
      }

      // Заголовок
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${rec?.invoice_number ?? invoiceNumber || '—'}`, doc.internal.pageSize.getWidth() / 2, y + 20, {
        align: 'center',
      });
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Date: ${new Date(invoiceDate || todayISO()).toLocaleDateString()}`, doc.internal.pageSize.getWidth() / 2, y + 36, {
        align: 'center',
      });

      // Bill To
      y += 80;
      doc.setFont(undefined, 'bold');
      doc.text('Bill To:', marginX, y);
      doc.setFont(undefined, 'normal');
      y += 14;
      if (customerName) { doc.text(String(customerName), marginX, y); y += 14; }
      if (customerAddress) { doc.text(String(customerAddress), marginX, y); y += 14; }
      if (customerPhone) { doc.text(String(customerPhone), marginX, y); y += 14; }
      if (customerEmail) { doc.text(String(customerEmail), marginX, y); y += 14; }

      // Company (справа)
      const rightX = doc.internal.pageSize.getWidth() - marginX;
      let yR = 120;
      doc.setFont(undefined, 'bold');
      doc.text('Sim Scope Inc.', rightX, yR, { align: 'right' });
      doc.setFont(undefined, 'normal');
      yR += 14; doc.text('1587 E 19th St', rightX, yR, { align: 'right' });
      yR += 14; doc.text('Brooklyn, NY 11230', rightX, yR, { align: 'right' });
      yR += 14; doc.text('(929) 412-9042', rightX, yR, { align: 'right' });
      yR += 14; doc.text('simscopeinc@gmail.com', rightX, yR, { align: 'right' });

      // Подготовим таблицу
      const serviceRows = rows.filter((r) => r.type === 'service');
      const materialRows = rows.filter((r) => r.type === 'material');

      const body = [
        ...serviceRows.map((r) => [r.name, String(r.qty), toCurrency(r.price), toCurrency(n2(r.qty) * n2(r.price))]),
      ];

      if (materialRows.length) {
        body.push([{ content: 'MATERIALS', colSpan: 4, styles: { halign: 'left', fillColor: [238, 238, 238], fontStyle: 'bold' } }]);
        materialRows.forEach((r) =>
          body.push([r.name, String(r.qty), toCurrency(r.price), toCurrency(n2(r.qty) * n2(r.price))])
        );
      }

      autoTable(doc, {
        startY: Math.max(y, yR) + 10,
        head: [['Description', 'Qty', 'Unit Price', 'Amount']],
        body,
        styles: { fontSize: 10, lineWidth: 0.1, cellPadding: 6 },
        headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
        margin: { left: marginX, right: marginX },
        columnStyles: {
          0: { cellWidth: doc.internal.pageSize.getWidth() - marginX * 2 - 150 }, // Description
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 55, halign: 'right' },
          3: { cellWidth: 55, halign: 'right' },
        },
      });

      let endY = doc.lastAutoTable.finalY + 10;

      // Итоги справа
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: ${toCurrency(subtotal)}`, rightX, endY, { align: 'right' }); endY += 14;
      doc.text(`Discount: -${toCurrency(discount)}`, rightX, endY, { align: 'right' }); endY += 14;
      doc.text(`Total Due: ${toCurrency(total)}`, rightX, endY, { align: 'right' });

      // Гарантия
      endY += 24;
      if (includeWarranty) {
        doc.setFont(undefined, 'bold');
        doc.text(`Warranty (${Number(warrantyDays || 60)} days):`, marginX, endY);
        doc.setFont(undefined, 'normal');
        endY += 14;

        const warrantyText =
          'A limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ' +
          'The warranty does not cover other components or the appliance as a whole, normal wear, consumables, ' +
          'damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ' +
          'The warranty starts on the job completion date and is valid only when the invoice is paid in full.';

        const split = doc.splitTextToSize(warrantyText, doc.internal.pageSize.getWidth() - marginX * 2);
        doc.text(split, marginX, endY);
        endY += split.length * 12;
      }

      endY += 24;
      doc.setFont(undefined, 'italic');
      doc.text('Thank you for your business!', marginX, endY);

      // Скачивание
      const fileName = `invoice_${rec?.invoice_number ?? invoiceNumber || 'new'}.pdf`;
      doc.save(fileName);
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-sm font-semibold">Invoice #</label>
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="авто (оставьте пустым)"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value.replace(/[^\d]/g, ''))}
          />
          <div className="text-xs text-gray-500 mt-1">Можно переопределить вручную; если пусто — БД выдаст номер автоматически.</div>
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

        <div className="md:col-span-2 border rounded p-3">
          <div className="font-semibold mb-2">Bill To</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="border rounded px-3 py-2" placeholder="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Address" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={includeWarranty} onChange={(e) => setIncludeWarranty(e.target.checked)} />
          Include warranty block
        </label>

        <div className="flex items-center gap-2">
          <span className="text-sm">Days:</span>
          <input
            type="number"
            className="border rounded px-2 py-1 w-20 text-right"
            value={warrantyDays}
            onChange={(e) => setWarrantyDays(Number(e.target.value || 0))}
          />
        </div>
      </div>

      {/* Таблица строк */}
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
                  <select
                    className="border rounded px-2 py-1"
                    value={r.type}
                    onChange={(e) => changeRow(i, 'type', e.target.value)}
                  >
                    <option value="service">service</option>
                    <option value="material">material</option>
                  </select>
                </td>
                <td className="border px-2 py-1">
                  <input
                    className="border rounded px-2 py-1 w-full"
                    value={r.name}
                    onChange={(e) => changeRow(i, 'name', e.target.value)}
                  />
                </td>
                <td className="border px-2 py-1 text-center">
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-16 text-center"
                    value={r.qty}
                    onChange={(e) => changeRow(i, 'qty', e.target.value)}
                  />
                </td>
                <td className="border px-2 py-1 text-right">
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-24 text-right"
                    value={r.price}
                    onChange={(e) => changeRow(i, 'price', e.target.value)}
                  />
                </td>
                <td className="border px-2 py-1 text-right">{toCurrency(n2(r.qty) * n2(r.price))}</td>
                <td className="border px-2 py-1 text-center">
                  <button className="text-red-600" onClick={() => delRow(i)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2">
        <button className="bg-gray-200 px-3 py-1 rounded" onClick={addRow}>+ Add row</button>
      </div>

      <div className="mt-4 text-right">
        <div>Subtotal: <strong>{toCurrency(subtotal)}</strong></div>
        <div className="inline-flex items-center gap-2 mt-2">
          <span className="font-semibold">Discount $:</span>
          <input
            type="number"
            className="border px-2 py-1 w-24 text-right"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value || 0))}
          />
        </div>
        <div className="font-bold text-lg mt-2">Total Due: {toCurrency(total)}</div>
      </div>

      <div className="mt-5">
        <button
          disabled={saving}
          onClick={onSaveAndDownload}
          className={`px-4 py-2 rounded text-white ${saving ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
          title="Сохраняет инвойс в БД и сразу скачивает PDF"
        >
          {saving ? 'Сохраняю…' : 'Сохранить и скачать PDF'}
        </button>
      </div>
    </div>
  );
}
