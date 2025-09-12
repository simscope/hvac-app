// client/src/pages/InvoicePage.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Загрузка логотипа из /public в dataURL для jsPDF
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
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);

  // устойчивый поиск заявки и связанных данных
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setErr('');

        // 1) Заявка
        const isUuid = /^[0-9a-fA-F-]{36}$/.test(id);
        const isNum = /^\d+$/.test(id);

        let jobData = null;
        let jobErr = null;

        if (isUuid) {
          ({ data: jobData, error: jobErr } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', id)
            .maybeSingle());
        } else if (isNum) {
          ({ data: jobData, error: jobErr } = await supabase
            .from('jobs')
            .select('*')
            .eq('job_number', Number(id))
            .maybeSingle());
        }

        // Запасной комбинированный поиск, если выше ничего не нашли
        if (!jobData && !jobErr) {
          const { data: anyJobs, error: anyErr } = await supabase
            .from('jobs')
            .select('*')
            .or(`id.eq.${id},uid.eq.${id},uuid.eq.${id}`)
            .limit(1);
          jobErr = anyErr || null;
          jobData = (anyJobs && anyJobs[0]) || null;
        }

        if (jobErr || !jobData) {
          console.error('jobs lookup failed', { id, jobErr, jobData });
          setErr('Не удалось загрузить заявку');
          setLoading(false);
          return;
        }

        setJob(jobData);

        // 2) Клиент с мягким фолбэком из полей jobs
        let clientObj = {
          full_name: jobData.client_name || jobData.full_name || '',
          address: jobData.client_address || jobData.address || '',
          phone: jobData.client_phone || jobData.phone || '',
          email: jobData.client_email || jobData.email || '',
        };

        if (jobData.client_id) {
          const { data: clientData } = await supabase
            .from('clients')
            .select('full_name,address,phone,email')
            .eq('id', jobData.client_id)
            .maybeSingle();
          if (clientData) {
            clientObj = {
              full_name: clientData.full_name || '',
              address: clientData.address || '',
              phone: clientData.phone || '',
              email: clientData.email || '',
            };
          }
        }
        setClient(clientObj);

        // 3) Материалы (materials.job_id — UUID из jobs.id)
        const materialsJobId = jobData.id;
        const { data: materialData } = await supabase
          .from('materials')
          .select('name, quantity, price')
          .eq('job_id', materialsJobId);

        const initialRows = [
          { type: 'service', name: 'Labor',            qty: 1, price: Number(jobData.labor_price || 0) },
          { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(jobData.scf || 0) },
          ...((materialData || [])).map((m) => ({
            type: 'material',
            name: m.name || '',
            qty: Number(m.quantity || 0),
            price: Number(m.price || 0),
          })),
        ];
        setRows(initialRows);
      } catch (e) {
        console.error(e);
        setErr('Не удалось загрузить заявку');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  // ---- расчёты
  const subtotal = rows.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0),
    0
  );
  const total = subtotal - Number(discount || 0);

  // ---- изменения строк
  const handleChange = (index, key, value) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[index] =
        key === 'name' || key === 'type'
          ? { ...updated[index], [key]: value }
          : { ...updated[index], [key]: parseFloat(value) || 0 };
      return updated;
    });
  };

  const addRow = () =>
    setRows((prev) => [...prev, { type: 'material', name: '', qty: 1, price: 0 }]);

  const deleteRow = (index) =>
    setRows((prev) => prev.filter((_, i) => i !== index));

  // ---- экспорт PDF
  const handleDownload = async () => {
    const doc = new jsPDF();

    const serviceRows = rows.filter((r) => r.type === 'service');
    const materialRows = rows.filter((r) => r.type === 'material');

    try {
      const logoDataUrl = await loadLogoDataURL();
      doc.addImage(logoDataUrl, 'PNG', 170, 10, 30, 30);
    } catch (e) {
      console.warn('Logo load failed, continue without logo', e);
    }

    // INVOICE + дата
    doc.setFont(undefined, 'bold');
    doc.setFontSize(14);
    doc.text(`INVOICE #${job?.job_number || id}`, 100, 50, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 58, { align: 'center' });

    // Клиент
    let yLeft = 70;
    doc.setFont(undefined, 'bold');
    doc.text('Bill To:', 14, yLeft); yLeft += 6;
    doc.setFont(undefined, 'normal');
    doc.text(client?.full_name || '', 14, yLeft); yLeft += 6;
    doc.text(client?.address || '', 14, yLeft); yLeft += 6;
    doc.text(client?.phone || '', 14, yLeft); yLeft += 6;
    doc.text(client?.email || '', 14, yLeft); yLeft += 8;

    // Компания
    let yRight = 70;
    doc.setFont(undefined, 'bold');
    doc.text('Sim Scope Inc.', 200, yRight, { align: 'right' }); yRight += 6;
    doc.setFont(undefined, 'normal');
    doc.text('1587 E 19th St', 200, yRight, { align: 'right' }); yRight += 6;
    doc.text('Brooklyn, NY 11230', 200, yRight, { align: 'right' }); yRight += 6;
    doc.text('(929) 412-9042', 200, yRight, { align: 'right' }); yRight += 6;
    doc.text('simscopeinc@gmail.com', 200, yRight, { align: 'right' });

    autoTable(doc, {
      startY: Math.max(yLeft, yRight) + 10,
      head: [['Service', 'Qty', 'Unit Price', 'Amount']],
      body: [
        ...serviceRows.map((r) => [
          r.name,
          r.qty,
          `$${Number(r.price).toFixed(2)}`,
          `$${(Number(r.qty) * Number(r.price)).toFixed(2)}`
        ]),
        [{ content: 'MATERIALS', colSpan: 4, styles: { halign: 'left', fillColor: [230,230,230], fontStyle: 'bold' } }],
        ...materialRows.map((r) => [
          r.name,
          r.qty,
          `$${Number(r.price).toFixed(2)}`,
          `$${(Number(r.qty) * Number(r.price)).toFixed(2)}`
        ]),
      ],
      styles: { fontSize: 10, halign: 'left', lineWidth: 0.1 },
      headStyles: { fillColor: [245,245,245], textColor: 0, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255,255,255] },
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 130 },
        1: { cellWidth: 20 },
        2: { cellWidth: 25 },
        3: { cellWidth: 25 },
      },
    });

    let endY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`Subtotal: $${subtotal.toFixed(2)}`, 200, endY, { align: 'right' }); endY += 6;
    doc.text(`Discount: -$${Number(discount || 0).toFixed(2)}`, 200, endY, { align: 'right' }); endY += 6;
    doc.text(`Total Due: $${total.toFixed(2)}`, 200, endY, { align: 'right' });

    doc.save(`invoice_${job?.job_number || id}.pdf`);
  };

  // ---- отображение
  if (loading) return <div className="p-4">Загрузка…</div>;
  if (err) return <div className="p-4">{err}</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-4">
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
                  onChange={(e) => handleChange(i, 'type', e.target.value)}
                  className="border px-2"
                >
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td>
                <input
                  value={r.name}
                  onChange={(e) => handleChange(i, 'name', e.target.value)}
                  className="border px-2"
                />
              </td>
              <td>
                <input
                  type="number"
                  value={r.qty}
                  onChange={(e) => handleChange(i, 'qty', e.target.value)}
                  className="border w-16 text-center"
                />
              </td>
              <td>
                <input
                  type="number"
                  value={r.price}
                  onChange={(e) => handleChange(i, 'price', e.target.value)}
                  className="border w-20 text-right"
                />
              </td>
              <td>${(Number(r.qty) * Number(r.price)).toFixed(2)}</td>
              <td>
                <button onClick={() => deleteRow(i)} className="text-red-600 px-2">✕</button>
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
        <p className="font-bold text-lg mt-2">Total Due: ${total.toFixed(2)}</p>
      </div>

      <div className="mt-4">
        <button
          onClick={handleDownload}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          📄 Скачать PDF
        </button>
      </div>
    </div>
  );
}
