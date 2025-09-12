// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ───── helpers ───── */
const pad = (n) => String(n).padStart(2, '0');
const formatHuman = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; // DD.MM.YYYY
const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // YYYY-MM-DD
const fromInputDate = (s) => {
  if (!s) return new Date();
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const num = (v) => Number(v || 0);

/* ───── Логотип из /public без «сжатий» ───── */
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

export default function InvoicePage() {
  const { id } = useParams(); // job id (может быть пустым для «свободного» инвойса)

  const [job, setJob] = useState(null);
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);

  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());

  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  const [logoDataURL, setLogoDataURL] = useState(null);
  const [saving, setSaving] = useState(false);

  /* ───── загрузка данных ───── */
  useEffect(() => {
    (async () => {
      // логотип в стейт (для предпросмотра/устойчивости)
      const l = await loadLogoDataURL();
      setLogoDataURL(l);

      if (id) {
        const { data: j } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
        setJob(j || null);

        if (j?.client_id) {
          const { data: c } = await supabase
            .from('clients')
            .select('full_name,address,phone,email,street,city,state,zip')
            .eq('id', j.client_id)
            .maybeSingle();
          if (c) {
            setBillName(c.full_name || '');
            setBillAddress(
              c.address ||
                [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ') ||
                ''
            );
            setBillPhone(c.phone || '');
            setBillEmail(c.email || '');
          }
        } else {
          setBillName(j?.client_name || j?.full_name || '');
          setBillAddress(j?.client_address || j?.address || '');
          setBillPhone(j?.client_phone || j?.phone || '');
          setBillEmail(j?.client_email || j?.email || '');
        }

        // базовые сервисы
        const baseRows = [
          { type: 'service', name: 'Labor', qty: 1, price: num(j?.labor_price) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: num(j?.scf) },
        ];

        // материалы
        const { data: mats } = await supabase
          .from('materials')
          .select('name,qty,price')
          .eq('job_id', id);
        const matRows =
          (mats || []).map((m) => ({
            type: 'material',
            name: m.name || '',
            qty: num(m.qty) || 1,
            price: num(m.price),
          })) || [];

        setRows([...baseRows, ...matRows]);
      } else {
        // свободный инвойс (без связи с job)
        setRows([
          { type: 'service', name: 'Labor', qty: 1, price: 0 },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: 0 },
        ]);
      }

      // авто-номер (если возможно)
      if (!invoiceNo) {
        try {
          const { data } = await supabase
            .from('invoices')
            .select('invoice_no')
            .order('invoice_no', { ascending: false })
            .limit(1);
          const next = (data?.[0]?.invoice_no || 0) + 1;
          setInvoiceNo(String(next));
        } catch {
          setInvoiceNo(''); // оставим пустым, можно ввести вручную
        }
      }

      setInvoiceDate(new Date());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ───── суммы ───── */
  const subtotal = useMemo(
    () => rows.reduce((s, r) => s + num(r.qty) * num(r.price), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, num(subtotal) - num(discount)), [subtotal, discount]);

  /* ───── строки ───── */
  const changeRow = (i, key, val) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[i] = {
        ...cp[i],
        [key]: key === 'name' || key === 'type' ? val : Number(val || 0),
      };
      return cp;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  /* ───── сохранение в БД (мягко) ───── */
  async function persistInvoice() {
    const payload = {
      job_id: id ?? null,
      invoice_no: invoiceNo ? Number(invoiceNo) : null,
      issued_on: toInputDate(invoiceDate), // YYYY-MM-DD
      subtotal,
      discount: num(discount),
      total_due: total,
      // ниже поля «по возможности» — если их в схеме нет, insert упадёт, но PDF всё равно скачаем
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

  /* ───── генерация PDF с уменьшенным размером (без изменения лого) ───── */
  async function saveAndDownload() {
    setSaving(true);
    try {
      const saved = await persistInvoice();

      // jsPDF с компрессией и «только используемые шрифты»
      const doc = new jsPDF({
        unit: 'pt',
        format: 'letter',
        compress: true,
        putOnlyUsedFonts: true,
      });

      // загружаем логотип, если ещё не успели в стейт (чтобы не пропал на черновике)
      const logo = logoDataURL || (await loadLogoDataURL());
      if (logo) {
        // вставляем как есть (PNG), без пережатия/конвертации
        // Размер отображения задаём небольшой (это не сжимает поток данных, но и не раздувает страницу)
        doc.addImage(logo, 'PNG', 460, 24, 90, 90);
      }

      // Заголовок
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(`INVOICE #${invoiceNo || 'DRAFT'}`, 306, 44, { align: 'center' }); // по центру страницы
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Date: ${formatHuman(invoiceDate)}`, 306, 60, { align: 'center' });

      // Bill To
      const left = 40;
      let y = 92;
      doc.setFont(undefined, 'bold');
      doc.text('Bill To:', left, y);
      y += 14;
      doc.setFont(undefined, 'normal');
      [billName, billAddress, billPhone, billEmail]
        .filter(Boolean)
        .forEach((line) => {
          doc.text(String(line), left, y);
          y += 12;
        });

      // Company (справа)
      let ry = 92;
      const right = 572; // 612 - 40
      doc.setFont(undefined, 'bold');
      doc.text('Sim Scope Inc.', right, ry, { align: 'right' });
      ry += 14;
      doc.setFont(undefined, 'normal');
      ['1587 E 19th St', 'Brooklyn, NY 11230', '(929) 412-9042', 'simscopeinc@gmail.com'].forEach(
        (line) => {
          doc.text(line, right, ry, { align: 'right' });
          ry += 12;
        }
      );

      // Таблица
      const startY = Math.max(y, ry) + 12;
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
        margin: { left: 40, right: 40 }, // небольшой правый отступ, как просили
        columnStyles: {
          0: { cellWidth: 372 }, // 612 - 40 - 40 - (40+60+60) ≈ 372
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 60, halign: 'right' },
          3: { cellWidth: 60, halign: 'right' },
        },
      });

      let endY = doc.lastAutoTable.finalY + 10;
      // Итоги
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: $${num(subtotal).toFixed(2)}`, right, endY, { align: 'right' });
      endY += 14;
      doc.text(`Discount: -$${num(discount).toFixed(2)}`, right, endY, { align: 'right' });
      endY += 14;
      doc.text(`Total Due: $${num(total).toFixed(2)}`, right, endY, { align: 'right' });
      endY += 18;

      // Гарантия (EN), опционально
      if (includeWarranty && Number(warrantyDays) > 0) {
        doc.setFont(undefined, 'bold');
        doc.text(`Warranty (${Number(warrantyDays)} days):`, 40, endY);
        endY += 12;
        doc.setFont(undefined, 'normal');
        const wText =
          `A ${Number(
            warrantyDays
          )}-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. ` +
          `The warranty does not cover other components or the appliance as a whole, normal wear, consumables, damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. ` +
          `The warranty starts on the job completion date and is valid only when the invoice is paid in full.`;
        const lines = doc.splitTextToSize(wText, 612 - 80);
        doc.setFontSize(9);
        doc.text(lines, 40, endY);
        endY += lines.length * 10;
      }

      // Низ страницы
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text('Thank you for your business!', right, 760, { align: 'right' });

      const filename = `invoice_${invoiceNo || (id ? `job_${id}` : 'draft')}.pdf`;
      doc.save(filename);

      if (!saved) {
        alert('PDF downloaded. Saving to DB was skipped (RLS/schema). See console for details.');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save or download invoice');
    } finally {
      setSaving(false);
    }
  }

  /* ───── UI ───── */
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-3">Invoice</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="font-semibold">Invoice #</label>
        <input
          className="border px-2 py-1 w-32"
          value={invoiceNo}
          onChange={(e) => setInvoiceNo(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="auto"
        />

        <label className="font-semibold ml-2">Date</label>
        <input
          type="date"
          className="border px-2 py-1"
          value={toInputDate(invoiceDate)}
          onChange={(e) => setInvoiceDate(fromInputDate(e.target.value))}
        />

        <label className="ml-4 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeWarranty}
            onChange={(e) => setIncludeWarranty(e.target.checked)}
          />
          <span>Include warranty</span>
        </label>

        <label className="inline-flex items-center gap-2">
          Days:
          <input
            type="number"
            className="border px-2 py-1 w-20"
            value={warrantyDays}
            onChange={(e) => setWarrantyDays(Number(e.target.value || 0))}
            min={0}
          />
        </label>
      </div>

      {/* Bill To */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <div className="font-semibold mb-1">Bill To</div>
          <input
            className="border px-2 py-1 w-full mb-2"
            placeholder="Full name / Company"
            value={billName}
            onChange={(e) => setBillName(e.target.value)}
          />
          <input
            className="border px-2 py-1 w-full mb-2"
            placeholder="Address"
            value={billAddress}
            onChange={(e) => setBillAddress(e.target.value)}
          />
          <div className="flex gap-2">
            <input
              className="border px-2 py-1 w-full"
              placeholder="Phone"
              value={billPhone}
              onChange={(e) => setBillPhone(e.target.value)}
            />
            <input
              className="border px-2 py-1 w-full"
              placeholder="Email"
              value={billEmail}
              onChange={(e) => setBillEmail(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="font-semibold mb-1">Job</div>
          <div className="text-sm text-gray-600 whitespace-pre-line">
            {job
              ? [
                  job?.job_number ? `Job #${job.job_number}` : '',
                  job?.system_type ? `System: ${job.system_type}` : '',
                  job?.issue ? `Issue: ${job.issue}` : '',
                ]
                  .filter(Boolean)
                  .join('\n')
              : 'No job linked'}
          </div>
        </div>
      </div>

      {/* Таблица строк */}
      <table className="w-full text-sm border-collapse mb-3">
        <thead>
          <tr className="bg-gray-100">
            <th className="text-left p-2 border">Type</th>
            <th className="text-left p-2 border">Name</th>
            <th className="text-center p-2 border">Qty</th>
            <th className="text-right p-2 border">Price</th>
            <th className="text-right p-2 border">Amount</th>
            <th className="p-2 border"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="border p-1">
                <select
                  className="border px-2 py-1 w-full"
                  value={r.type}
                  onChange={(e) => changeRow(i, 'type', e.target.value)}
                >
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td className="border p-1">
                <input
                  className="border px-2 py-1 w-full"
                  value={r.name}
                  onChange={(e) => changeRow(i, 'name', e.target.value)}
                  placeholder={r.type === 'service' ? 'Service' : 'Item'}
                />
              </td>
              <td className="border p-1 text-center">
                <input
                  type="number"
                  className="border px-2 py-1 w-20 text-center"
                  value={r.qty}
                  onChange={(e) => changeRow(i, 'qty', e.target.value)}
                />
              </td>
              <td className="border p-1 text-right">
                <input
                  type="number"
                  className="border px-2 py-1 w-28 text-right"
                  value={r.price}
                  onChange={(e) => changeRow(i, 'price', e.target.value)}
                />
              </td>
              <td className="border p-1 text-right">
                ${(num(r.qty) * num(r.price)).toFixed(2)}
              </td>
              <td className="border p-1 text-center">
                <button className="text-red-600 px-2" onClick={() => delRow(i)} title="Remove">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-3">
        <button className="bg-gray-200 text-black px-3 py-1 rounded" onClick={addRow}>
          ➕ Add row
        </button>
      </div>

      {/* Итоги */}
      <div className="text-right">
        <div>Subtotal: ${num(subtotal).toFixed(2)}</div>
        <div className="inline-flex items-center gap-2 mt-1">
          <label className="font-semibold">Discount $:</label>
          <input
            type="number"
            className="border px-2 py-1 w-24 text-right"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value || 0))}
          />
        </div>
        <div className="font-bold text-lg mt-2">Total Due: ${num(total).toFixed(2)}</div>
      </div>

      <div className="mt-4">
        <button
          onClick={saveAndDownload}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Сохранить и скачать PDF'}
        </button>
      </div>
    </div>
  );
}

