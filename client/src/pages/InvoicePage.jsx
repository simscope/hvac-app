// client/src/pages/InvoicePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ------------------------ Настройки и утилиты ------------------------ */

const CURRENCY = (n) => `$${Number(n || 0).toFixed(2)}`;

// Создаём jsPDF так, чтобы файл был маленьким
function createPdf() {
  return new jsPDF({
    unit: 'mm',
    format: 'a4',
    compress: true,          // сжатие потоков
    putOnlyUsedFonts: true,  // не встраивать лишнее
    precision: 2,            // меньше знаков после запятой в координатах
  });
}

// Пережимаем логотип до WebP/JPEG на лету, чтобы не раздувать PDF
async function loadSmallLogoDataURL(maxWidth = 280) {
  const res = await fetch('/logo_invoice_header.png'); // лежит в /public
  if (!res.ok) throw new Error('Logo not found');
  const blob = await res.blob();

  const img = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.src = URL.createObjectURL(blob);
  });

  // масштабируем при необходимости
  const scale = Math.min(1, maxWidth / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  // предпочтем WebP → сильно меньше; если не поддерживается — JPEG
  const tryWebp = canvas.toDataURL('image/webp', 0.72);
  const isWebp = tryWebp.startsWith('data:image/webp');
  const dataUrl = isWebp ? tryWebp : canvas.toDataURL('image/jpeg', 0.72);

  URL.revokeObjectURL(img.src);
  return { dataUrl, format: isWebp ? 'WEBP' : 'JPEG' };
}

/* ----------------------------- Компонент ----------------------------- */

export default function InvoicePage() {
  const { id } = useParams(); // job id
  const [job, setJob] = useState(null);
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // Текст гарантии: 60 дней только на выполненный ремонт
  const warrantyText =
    'Гарантия 60 календарных дней распространяется ТОЛЬКО на выполненный ремонт и/или установленные запчасти. ' +
    'Гарантия не покрывает прочие узлы и технику в целом, естественный износ, расходные материалы, ' +
    'повреждения вследствие внешнего воздействия (удары, влага, перепады питания и т.п.), ' +
    'а также случаи вмешательства третьих лиц. Гарантия действует с момента завершения работ при условии полной оплаты.';

  // загрузка данных
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr('');

        if (!id) throw new Error('Не указан ID заявки');

        // job
        const { data: j, error: ej } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (ej || !j) throw new Error('Не удалось загрузить заявку');
        if (!alive) return;
        setJob(j);

        // client (может не быть — тогда пытаться взять поля из jobs)
        let clientData = null;
        if (j.client_id) {
          const { data: c, error: ec } = await supabase
            .from('clients')
            .select('*')
            .eq('id', j.client_id)
            .maybeSingle();
          if (!ec && c) clientData = c;
        }
        if (!clientData) {
          clientData = {
            full_name: j.client_name || j.full_name || '',
            phone: j.client_phone || j.phone || '',
            email: j.client_email || j.email || '',
            address: j.client_address || j.address || '',
          };
        }
        if (!alive) return;
        setClient(clientData);

        // materials
        const { data: mats, error: em } = await supabase
          .from('materials')
          .select('*')
          .eq('job_id', id);
        if (em) console.warn('materials load warn', em);

        // Подготовка строк инвойса (service + materials)
        const materialRows = (mats || []).map((m) => ({
          type: 'material',
          name: m.name || '',
          qty: Number(m.quantity ?? m.qty ?? 0),
          price: Number(m.price ?? 0),
        }));

        const initialRows = [
          { type: 'service', name: 'Labor', qty: 1, price: Number(j.labor_price || 0) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(j.scf || 0) },
          ...materialRows,
        ];
        if (!alive) return;
        setRows(initialRows);
      } catch (e) {
        console.error(e);
        if (alive) setErr(e.message || 'Ошибка загрузки');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // суммы
  const subtotal = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.qty || 0) * Number(r.price || 0), 0),
    [rows]
  );
  const total = useMemo(() => Math.max(0, subtotal - Number(discount || 0)), [subtotal, discount]);

  // правка строк
  const handleChange = (idx, key, value) => {
    setRows((prev) => {
      const n = [...prev];
      n[idx] = {
        ...n[idx],
        [key]: key === 'name' || key === 'type' ? value : Number(value || 0),
      };
      return n;
    });
  };
  const addRow = () => setRows((p) => [...p, { type: 'material', name: '', qty: 1, price: 0 }]);
  const deleteRow = (idx) => setRows((p) => p.filter((_, i) => i !== idx));

  // генерация PDF
  const downloadPdf = async () => {
    try {
      const doc = createPdf();

      // Логотип (маленький)
      try {
        const { dataUrl, format } = await loadSmallLogoDataURL(260);
        doc.addImage(dataUrl, format, 170, 10, 28, 28, undefined, 'FAST');
      } catch (e) {
        console.warn('Logo skipped', e);
      }

      // Заголовки
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(`INVOICE #${job?.job_number || id}`, 100, 50, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 58, { align: 'center' });

      // Клиент (слева)
      let yL = 70;
      doc.setFont('helvetica', 'bold');
      doc.text('Bill To:', 14, yL);
      yL += 6;
      doc.setFont('helvetica', 'normal');
      if (client?.full_name) { doc.text(String(client.full_name), 14, yL); yL += 6; }
      if (client?.address)   { doc.text(String(client.address),   14, yL); yL += 6; }
      if (client?.phone)     { doc.text(String(client.phone),     14, yL); yL += 6; }
      if (client?.email)     { doc.text(String(client.email),     14, yL); yL += 6; }

      // Компания (справа)
      let yR = 70;
      doc.setFont('helvetica', 'bold');
      doc.text('Sim Scope Inc.', 200, yR, { align: 'right' }); yR += 6;
      doc.setFont('helvetica', 'normal');
      doc.text('1587 E 19th St', 200, yR, { align: 'right' }); yR += 6;
      doc.text('Brooklyn, NY 11230', 200, yR, { align: 'right' }); yR += 6;
      doc.text('(929) 412-9042', 200, yR, { align: 'right' }); yR += 6;
      doc.text('simscopeinc@gmail.com', 200, yR, { align: 'right' });

      // Таблица
      const serviceRows = rows
        .filter((r) => r.type === 'service')
        .map((r) => [r.name, r.qty, CURRENCY(r.price), CURRENCY(r.qty * r.price)]);

      const materialRows = rows
        .filter((r) => r.type === 'material')
        .map((r) => [r.name, r.qty, CURRENCY(r.price), CURRENCY(r.qty * r.price)]);

      autoTable(doc, {
        startY: Math.max(yL, yR) + 10,
        head: [['Description', 'Qty', 'Unit Price', 'Amount']],
        body: [
          ...serviceRows,
          [{ content: 'MATERIALS', colSpan: 4, styles: { halign: 'left', fillColor: [230, 230, 230], fontStyle: 'bold' } }],
          ...materialRows,
        ],
        styles: { fontSize: 10, halign: 'left', lineWidth: 0.1 },
        headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        margin: { left: 14, right: 14 },
        columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 20 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 } },
      });

      let y = doc.lastAutoTable.finalY + 8;

      // Суммы
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`Subtotal: ${CURRENCY(subtotal)}`, 200, y, { align: 'right' }); y += 6;
      doc.text(`Discount: -${CURRENCY(discount)}`, 200, y, { align: 'right' }); y += 6;
      doc.text(`Total Due: ${CURRENCY(total)}`, 200, y, { align: 'right' }); y += 8;

      // Гарантия
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Warranty (60 days):', 14, y); y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(warrantyText, 182);
      doc.text(wrapped, 14, y); y += wrapped.length * 4 + 6;

      // Низ
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.text('Thank you for your business!', 200, y, { align: 'right' });

      doc.save(`invoice_${job?.job_number || id}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Не удалось сформировать PDF');
    }
  };

  if (loading) return <div className="p-4">Загрузка…</div>;
  if (err) return <div className="p-4 text-red-600">Ошибка: {err}</div>;
  if (!job || !client) return <div className="p-4">Не удалось загрузить данные</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Шапка */}
      <div className="flex justify-between mb-4 items-center">
        <img
          src="/logo_invoice_header.png"
          alt="Logo"
          style={{ width: 60, height: 60, objectFit: 'contain' }}
        />
        <div className="text-right text-sm">
          <p><strong>Sim Scope Inc.</strong></p>
          <p>1587 E 19th St, Brooklyn, NY 11230</p>
          <p>(929) 412-9042</p>
          <p>simscopeinc@gmail.com</p>
        </div>
      </div>

      <hr className="my-4" />

      {/* Информация */}
      <div className="flex flex-wrap gap-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Invoice #{job?.job_number || id}</h2>
          <div className="text-sm text-gray-700">Date: {new Date().toLocaleDateString()}</div>
        </div>
        <div className="grow" />
        <div className="text-sm">
          <div className="font-semibold mb-1">Bill To:</div>
          <div>{client?.full_name || '—'}</div>
          <div>{client?.address || '—'}</div>
          <div>{client?.phone || '—'}</div>
          <div>{client?.email || '—'}</div>
        </div>
      </div>

      {/* Таблица-редактор */}
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
                <select
                  value={r.type}
                  onChange={(e) => handleChange(i, 'type', e.target.value)}
                  className="border rounded px-2 py-1"
                >
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td>
                <input
                  value={r.name}
                  onChange={(e) => handleChange(i, 'name', e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="text-center">
                <input
                  type="number"
                  value={r.qty}
                  onChange={(e) => handleChange(i, 'qty', e.target.value)}
                  className="border rounded px-2 py-1 w-20 text-center"
                />
              </td>
              <td className="text-right">
                <input
                  type="number"
                  value={r.price}
                  onChange={(e) => handleChange(i, 'price', e.target.value)}
                  className="border rounded px-2 py-1 w-24 text-right"
                />
              </td>
              <td className="text-right">{CURRENCY(r.qty * r.price)}</td>
              <td className="text-center">
                <button
                  onClick={() => deleteRow(i)}
                  className="text-red-600 px-2"
                  title="Удалить строку"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3">
        <button onClick={addRow} className="bg-gray-200 text-black px-3 py-1 rounded">
          ➕ Добавить строку
        </button>
      </div>

      {/* Суммы + скидка */}
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

      {/* Гарантия — видно на странице и попадёт в PDF */}
      <div className="mt-6 p-3 border rounded bg-gray-50 text-sm leading-5">
        <div className="font-semibold mb-1">Гарантия (60 дней):</div>
        <div>{warrantyText}</div>
      </div>

      <div className="mt-6">
        <button onClick={downloadPdf} className="bg-blue-600 text-white px-4 py-2 rounded">
          📄 Скачать PDF
        </button>
      </div>
    </div>
  );
}
