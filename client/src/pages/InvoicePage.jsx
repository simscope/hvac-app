// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ───────────── helpers: dates & numbers ───────────── */
const pad = (n) => String(n).padStart(2, '0');
const formatHuman = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; // DD.MM.YYYY
const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // YYYY-MM-DD
const fromInputDate = (s) => {
  if (!s) return new Date();
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const money = (v) => Number(v || 0);

/* ───────────── logo loader ───────────── */
async function loadLogoDataURL() {
  try {
    const res = await fetch('/logo_invoice_header.png', { cache: 'force-cache' });
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return dataUrl; // PNG dataURL
  } catch {
    return null;
  }
}

export default function InvoicePage() {
  const { id } = useParams(); // job id (может быть undefined — инвойс «непривязанный» тоже поддерживаем)

  // Источники
  const [job, setJob] = useState(null);
  const [client, setClient] = useState(null);

  // Редактируемые поля «Bill To» — подтягиваем из клиента и даём править
  const [billName, setBillName] = useState('');
  const [billAddress, setBillAddress] = useState('');
  const [billPhone, setBillPhone] = useState('');
  const [billEmail, setBillEmail] = useState('');

  // Строки счёта
  const [rows, setRows] = useState([]); // [{type:'service'|'material', name:'', qty:1, price:0}]
  const [discount, setDiscount] = useState(0);

  // Номер и дата инвойса
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());

  // Гарантия
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState(60);

  const [saving, setSaving] = useState(false);

  /* ───────────── загрузка данных ───────────── */
  useEffect(() => {
    (async () => {
      // 1) job + client + материалы
      if (id) {
        const { data: j } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
        setJob(j || null);

        if (j?.client_id) {
          const { data: c } = await supabase
            .from('clients')
            .select('*')
            .eq('id', j.client_id)
            .maybeSingle();
          setClient(c || null);

          setBillName(c?.full_name || c?.name || '');
          setBillAddress(
            c?.address ||
              [c?.street, c?.city, c?.state, c?.zip].filter(Boolean).join(', ') ||
              ''
          );
          setBillPhone(c?.phone || '');
          setBillEmail(c?.email || '');
        }

        // Материалы
        const { data: mats } = await supabase.from('materials').select('*').eq('job_id', id);
        const materialsRows =
          (mats || []).map((m) => ({
            type: 'material',
            name: m.name || '',
            qty: Number(m.qty || 1),
            price: Number(m.price || 0),
          })) || [];

        // Базовые сервисные позиции: labor + scf по job
        const serviceRows = [
          { type: 'service', name: 'Labor', qty: 1, price: Number(j?.labor_price || 0) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(j?.scf || 0) },
        ];

        setRows([...serviceRows, ...materialsRows]);
      }

      // 2) авто-номер (можно вручную поменять)
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
          // если RLS/нет колонки — тихо игнорим, оставим пустым («DRAFT»)
          setInvoiceNo('');
        }
      }

      // 3) дата по умолчанию — сегодня (локально)
      setInvoiceDate(new Date());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ───────────── вычисления ───────────── */
  const subtotal = useMemo(
    () => rows.reduce((sum, r) => sum + money(r.qty) * money(r.price), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, money(subtotal) - money(discount)), [subtotal, discount]);

  /* ───────────── изменение строк ───────────── */
  const changeRow = (i, key, val) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [key]: key === 'name' || key === 'type' ? val : Number(val || 0) };
      if (key === 'qty' || key === 'price') {
        copy[i].qty = Number(copy[i].qty || 0);
        copy[i].price = Number(copy[i].price || 0);
      }
      return copy;
    });
  };
  const addRow = () =>
    setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  /* ───────────── сохранение в БД (мягко) ───────────── */
  async function persistInvoice() {
    // Подстраиваемся под любую схему: если какие-то поля отсутствуют — БД откажет,
    // но мы не сорвём скачивание PDF.
    const payload = {
      job_id: id ?? null,
      invoice_no: invoiceNo ? Number(invoiceNo) : null,
      issued_on: toInputDate(invoiceDate), // строка 'YYYY-MM-DD' — совместима с date/timestamp/date text
      subtotal,
      discount: money(discount),
      total_due: total,
      rows_json: rows, // JSON, если в схеме нет — будет ошибка, но PDF продолжим
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
      // Логи для диагностики, но не блокируем выгрузку PDF
      console.warn('[Invoices] save skipped:', e?.message || e);
      return false;
    }
  }

  /* ───────────── генерация PDF ───────────── */
  async function saveAndDownload() {
    setSaving(true);
    let saved = false;
    try {
      // 1) попытка сохранить (мягко)
      saved = await persistInvoice();

      // 2) делаем PDF
      const doc = new jsPDF();
      const tableMargin = { left: 14, right: 14 }; // небольшой отступ справа, как просили

      // логотип (без сжатия — как есть)
      try {
        const logo = await loadLogoDataURL();
        if (logo) {
          // Картинку немного уменьшим (визуально), но без какой-либо перекодировки.
          doc.addImage(logo, 'PNG', 165, 12, 30, 30);
        }
      } catch {
        /* пусто */
      }

      // заголовок
      doc.setFont(undefined, 'bold');
      doc.setFontSize(14);
      doc.text(`INVOICE #${invoiceNo || 'DRAFT'}`, 100, 50, { align: 'center' });
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.text(`Date: ${formatHuman(invoiceDate)}`, 100, 58, { align: 'center' });

      // левая колонка (Bill To)
      let ly = 70;
      doc.setFont(undefined, 'bold');
      doc.text('Bill To:', tableMargin.left, ly);
      ly += 6;
      doc.setFont(undefined, 'normal');
      [billName, billAddress, billPhone, billEmail]
        .filter(Boolean)
        .forEach((line) => {
          doc.text(String(line), tableMargin.left, ly);
          ly += 6;
        });

      // правая колонка (Company)
      let ry = 70;
      doc.setFont(undefined, 'bold');
      doc.text('Sim Scope Inc.', 200 - tableMargin.right, ry, { align: 'right' });
      ry += 6;
      doc.setFont(undefined, 'normal');
      [
        '1587 E 19th St',
        'Brooklyn, NY 11230',
        '(929) 412-9042',
        'simscopeinc@gmail.com',
      ].forEach((line) => {
        doc.text(line, 200 - tableMargin.right, ry, { align: 'right' });
        ry += 6;
      });

      // табличка
      const startY = Math.max(ly, ry) + 10;

      const tableBody = rows.map((r) => [
        r.name || (r.type === 'service' ? 'Service' : 'Item'),
        String(r.qty || 0),
        `$${money(r.price).toFixed(2)}`,
        `$${(money(r.qty) * money(r.price)).toFixed(2)}`,
      ]);

      autoTable(doc, {
        startY,
        head: [['Description', 'Qty', 'Unit Price', 'Amount']],
        body: tableBody,
        styles: { fontSize: 10, halign: 'left', lineWidth: 0.1 },
        headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        margin: tableMargin,
        columnStyles: {
          0: { cellWidth: 120 },
          1: { cellWidth: 20, halign: 'center' },
          2: { cellWidth: 28, halign: 'right' },
          3: { cellWidth: 28, halign: 'right' },
        },
      });

      let y = doc.lastAutoTable.finalY + 8;

      // итоговый блок справа
      doc.setFont(undefined, 'bold');
      doc.text(`Subtotal: $${money(subtotal).toFixed(2)}`, 200 - tableMargin.right, y, {
        align: 'right',
      });
      y += 6;
      doc.text(`Discount: -$${money(discount).toFixed(2)}`, 200 - tableMargin.right, y, {
        align: 'right',
      });
      y += 6;
      doc.text(`Total Due: $${money(total).toFixed(2)}`, 200 - tableMargin.right, y, {
        align: 'right',
      });
      y += 12;

      // гарантия (опционально), маленький кегль
      if (includeWarranty && Number(warrantyDays) > 0) {
        doc.setFont(undefined, 'bold');
        doc.text(`Warranty (${Number(warrantyDays)} days):`, tableMargin.left, y);
        y += 6;
        doc.setFont(undefined, 'normal');

        const lines = doc.splitTextToSize(
          `A ${Number(
            warrantyDays
          )}-day limited warranty applies ONLY to the work performed and/or parts installed by Sim Scope Inc. The warranty does not cover other components or the appliance as a whole, normal wear, consumables, damage caused by external factors (impacts, moisture, power surges, etc.), or any third-party tampering. The warranty starts on the job completion date and is valid only when the invoice is paid in full.`,
          200 - tableMargin.left - tableMargin.right
        );
        doc.setFontSize(9);
        doc.text(lines, tableMargin.left, y);
        y += lines.length * 5 + 4;
      }

      // подпись внизу
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text('Thank you for your business!', 200 - tableMargin.right, 285, {
        align: 'right',
      });

      const filename = `invoice_${invoiceNo || (id ? `job_${id}` : 'draft')}.pdf`;
      doc.save(filename);

      // сообщение
      if (!saved) {
        alert('PDF is downloaded. Saving to database was skipped (RLS/schema). See console for details.');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save or download invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-3">Invoice</h1>

      {/* Информация / настройки */}
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

      {/* Bill To (редактируемо) */}
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
                ${(money(r.qty) * money(r.price)).toFixed(2)}
              </td>
              <td className="border p-1 text-center">
                <button
                  className="text-red-600 px-2"
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

      <div className="mb-3">
        <button className="bg-gray-200 text-black px-3 py-1 rounded" onClick={addRow}>
          ➕ Add row
        </button>
      </div>

      {/* Итоги */}
      <div className="text-right">
        <div>Subtotal: ${money(subtotal).toFixed(2)}</div>
        <div className="inline-flex items-center gap-2 mt-1">
          <label className="font-semibold">Discount $:</label>
          <input
            type="number"
            className="border px-2 py-1 w-24 text-right"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value || 0))}
          />
        </div>
        <div className="font-bold text-lg mt-2">Total Due: ${money(total).toFixed(2)}</div>
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
