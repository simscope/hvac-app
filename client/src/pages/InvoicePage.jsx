// client/src/pages/InvoicePage.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Загружаем логотип из /public в dataURL для jsPDF
async function loadLogoDataURL() {
  const res = await fetch('/logo_invoice_header.png');
  const blob = await res.blob();
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

export default function InvoicePage() {
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [job, setJob] = useState(null);
  const [client, setClient] = useState(null);

  // строки инвойса
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);

  // --- загрузка заявки/клиента/материалов ---
  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setErr('');

      try {
        // 1) Находим заявку: сначала пробуем как uuid id, если не получилось — как job_number (число)
        let jobData = null;

        // пробуем по id (uuid)
        try {
          const { data, error } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          if (!error && data) jobData = data;
        } catch (_) {
          // если ошибся uuid — просто идём дальше
        }

        // если не нашли и id похоже на число — пробуем по job_number
        if (!jobData && /^\d+$/.test(id)) {
          const { data, error } = await supabase
            .from('jobs')
            .select('*')
            .eq('job_number', Number(id))
            .maybeSingle();
          if (!error && data) jobData = data;
        }

        if (!jobData) {
          setErr('Не удалось загрузить заявку');
          setLoading(false);
          return;
        }
        setJob(jobData);

        // 2) Клиент: либо из clients по client_id, либо поля из заявки
        let cl = {
          full_name: jobData.client_name || jobData.full_name || '',
          address: jobData.client_address || jobData.address || '',
          phone: jobData.client_phone || jobData.phone || '',
          email: jobData.client_email || jobData.email || '',
        };

        if (jobData.client_id) {
          const { data: cData } = await supabase
            .from('clients')
            .select('full_name,address,phone,email')
            .eq('id', jobData.client_id)
            .maybeSingle();
          if (cData) {
            cl = {
              full_name: cData.full_name || '',
              address: cData.address || '',
              phone: cData.phone || '',
              email: cData.email || '',
            };
          }
        }
        setClient(cl);

        // 3) Материалы (берём только реально существующие поля)
        const { data: mats } = await supabase
          .from('materials')
          .select('name, quantity, price')
          .eq('job_id', jobData.id);

        // 4) Стартовые строки инвойса
        const startRows = [
          { type: 'service', name: 'Labor', qty: 1, price: Number(jobData.labor_price || 0) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(jobData.scf || 0) },
          ...((mats || []).map((m) => ({
            type: 'material',
            name: m.name || '',
            qty: Number(m.quantity || 0),
            price: Number(m.price || 0),
          }))),
        ];
        setRows(startRows);
      } catch (e) {
        console.error(e);
        setErr('Не удалось загрузить заявку');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [id]);

  // --- расчёты ---
  const subtotal = rows.reduce((acc, r) => acc + Number(r.qty || 0) * Number(r.price || 0), 0);
  const total = subtotal - Number(discount || 0);

  // --- управление строками ---
  const changeRow = (i, key, value) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] =
        key === 'name' || key === 'type'
          ? { ...copy[i], [key]: value }
          : { ...copy[i], [key]: parseFloat(value) || 0 };
      return copy;
    });
  };
  const addRow = () => setRows((prev) => [...prev, { type: 'material', name: '', qty: 1, price: 0 }]);
  const delRow = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  // --- PDF ---
  const downloadPdf = async () => {
    const doc = new jsPDF();

    // Логотип
    try {
      const logo = await loadLogoDataURL();
      doc.addImage(logo, 'PNG', 170, 10, 30, 30);
    } catch (e) {
      console.warn('Logo not loaded, continue', e);
    }

    // Заголовок
    doc.setFont(undefined, 'bold');
    doc.setFontSize(14);
    doc.text(`INVOICE #${job?.job_number || id}`, 100, 50, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 58, { align: 'center' });

    // Клиент слева
    let yL = 70;
    doc.setFont(undefined, 'bold');
    doc.text('Bill To:', 14, yL); yL += 6;
    doc.setFont(undefined, 'normal');
    doc.text(client?.full_name || '', 14, yL); yL += 6;
    doc.text(client?.address || '', 14, yL); yL += 6;
    doc.text(client?.phone || '', 14, yL); yL += 6;
    doc.text(client?.email || '', 14, yL); yL += 8;

    // Компания справа
    let yR = 70;
    doc.setFont(undefined, 'bold');
    doc.text('Sim Scope Inc.', 200, yR, { align: 'right' }); yR += 6;
    doc.setFont(undefined, 'normal');
    doc.text('1587 E 19th St', 200, yR, { align: 'right' }); yR += 6;
    doc.text('Brooklyn, NY 11230', 200, yR, { align: 'right' }); yR += 6;
    doc.text('(929) 412-9042', 200, yR, { align: 'right' }); yR += 6;
    doc.text('simscopeinc@gmail.com', 200, yR, { align: 'right' });

    // Таблица
    const head = [['Service', 'Qty', 'Unit Price', 'Amount']];
    const serviceRows = rows.filter((r) => r.type === 'service').map((r) => [
      r.name,
      r.qty,
      `$${Number(r.price).toFixed(2)}`,
      `$${(Number(r.qty) * Number(r.price)).toFixed(2)}`
    ]);
    const materialsHeader = [{ content: 'MATERIALS', colSpan: 4, styles: { halign: 'left', fillColor: [230,230,230], fontStyle: 'bold' } }];
    const materialRows = rows.filter((r) => r.type === 'material').map((r) => [
      r.name,
      r.qty,
      `$${Number(r.price).toFixed(2)}`,
      `$${(Number(r.qty) * Number(r.price)).toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: Math.max(yL, yR) + 10,
      head,
      body: [...serviceRows, materialsHeader, ...materialRows],
      styles: { fontSize: 10, halign: 'left', lineWidth: 0.1 },
      headStyles: { fillColor: [245,245,245], textColor: 0, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 20 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 } }
    });

    let y = doc.lastAutoTable.finalY + 10;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    doc.text(`Subtotal: $${subtotal.toFixed(2)}`, 200, y, { align: 'right' }); y += 6;
    doc.text(`Discount: -$${Number(discount || 0).toFixed(2)}`, 200, y, { align: 'right' }); y += 6;
    doc.text(`Total Due: $${(subtotal - Number(discount || 0)).toFixed(2)}`, 200, y, { align: 'right' });

    doc.save(`invoice_${job?.job_number || id}.pdf`);
  };

  // --- UI ---
  if (loading) return <div className="p-4">Загрузка…</div>;
  if (err) return <div className="p-4">{err}</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-4">
        <img src="/logo_invoice_header.png" alt="Logo" style={{ width: 60, height: 60, objectFit: 'contain' }} />
        <div className="text-right text-sm">
          <p><strong>Sim Scope Inc.</strong></p>
          <p>1587 E 19th St, Brooklyn, NY 11230</p>
          <p>(929) 412-9042</p>
          <p>simscopeinc@gmail.com</p>
        </div>
      </div>

      <hr className="my-4" />

      <h2 className="text-xl font-bold mb-2">Invoice #{job?.job_number || id}</h2>
      <p><strong>Client:</strong> {client?.full_name || ''}</p>
      <p><strong>Date:</strong> {new Date().toLocaleDateString()}</p>

      <table className="w-full text-sm mt-4 border-collapse">
        <thead>
          <tr>
            <th className="text-left">Type</th>
            <th className="text-left">Name</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select
                  value={r.type}
                  onChange={(e) => changeRow(i, 'type', e.target.value)}
                  className="border px-2"
                >
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td>
                <input
                  value={r.name}
                  onChange={(e) => changeRow(i, 'name', e.target.value)}
                  className="border px-2"
                />
              </td>
              <td>
                <input
                  type="number"
                  value={r.qty}
                  onChange={(e) => changeRow(i, 'qty', e.target.value)}
                  className="border w-16 text-center"
                />
              </td>
              <td>
                <input
                  type="number"
                  value={r.price}
                  onChange={(e) => changeRow(i, 'price', e.target.value)}
                  className="border w-20 text-right"
                />
              </td>
              <td>${(Number(r.qty) * Number(r.price)).toFixed(2)}</td>
              <td>
                <button onClick={() => delRow(i)} className="text-red-600 px-2">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2">
        <button onClick={addRow} className="bg-gray-200 text-black px-3 py-1 rounded">
          ➕ Add Row
        </button>
      </div>

      <div className="mt-4 text-right">
        <p>Subtotal: ${subtotal.toFixed(2)}</p>
        <div className="inline-flex items-center gap-2 mt-2">
          <label className="font-semibold">Discount $:</label>
          <input
            type="number"
            className="border px-2 py-1 w-24 text-right"
            value={discount}
            onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
          />
        </div>
        <p className="font-bold text-lg mt-2">Total Due: ${(subtotal - Number(discount || 0)).toFixed(2)}</p>
      </div>

      <div className="mt-4">
        <button onClick={downloadPdf} className="bg-blue-600 text-white px-4 py-2 rounded">
          📄 Скачать PDF
        </button>
      </div>
    </div>
  );
}
