// client/src/pages/InvoicePage.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

// Лого из /public как dataURL для jsPDF
async function loadLogoDataURL() {
  try {
    const res = await fetch('/logo_invoice_header.png');
    if (!res.ok) throw new Error('logo not found');
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function InvoicePage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setErr('');

      // 1) Заявка
      const { data: jobData, error: jobErr } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (jobErr || !jobData) {
        setErr('Не удалось загрузить заявку');
        setLoading(false);
        return;
      }
      setJob(jobData);

      // 2) Клиент (мягко)
      let clientObj = {
        full_name: jobData.client_name || jobData.full_name || '',
        address: jobData.client_address || jobData.address || '',
        phone: jobData.client_phone || jobData.phone || '',
        email: jobData.client_email || jobData.email || '',
      };

      if (jobData.client_id) {
        const { data: clientData, error: clientErr } = await supabase
          .from('clients')
          .select('full_name,address,phone,email')
          .eq('id', jobData.client_id)
          .maybeSingle();

        if (!clientErr && clientData) {
          clientObj = {
            full_name: clientData.full_name || '',
            address: clientData.address || '',
            phone: clientData.phone || '',
            email: clientData.email || '',
          };
        }
        // если ошибка/нет клиента — остаётся fallback из jobData
      }
      setClient(clientObj);

      // 3) Материалы
      const { data: materialData } = await supabase
        .from('materials')
        .select('name, quantity, price')
        .eq('job_id', id);

      // 4) Инициализация строк счёта
      const initialRows = [
        { type: 'service', name: 'Labor', qty: 1, price: Number(jobData.labor_price || 0) },
        { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(jobData.scf || 0) },
        ...((materialData || [])).map((m) => ({
          type: 'material',
          name: m.name || '',
          qty: Number(m.quantity || 0),   // <-- quantity
          price: Number(m.price || 0),
        })),
      ];
      setRows(initialRows);

      setLoading(false);
    };

    fetchData();
  }, [id]);

  const subtotal = rows.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0),
    0
  );
  const total = subtotal - Number(discount || 0);

  const handleChange = (index, key, value) => {
    const updated = [...rows];
    updated[index][key] =
      key === 'name' || key === 'type' ? value : (parseFloat(value) || 0);
    setRows(updated);
  };

  const addRow = () =>
    setRows([...rows, { type: 'material', name: '', qty: 1, price: 0 }]);
  const deleteRow = (index) => setRows(rows.filter((_, i) => i !== index));

  const handleDownload = async () => {
    // Динамические импорты — безопаснее для загрузки страницы
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF();
    const serviceRows = rows.filter((r) => r.type === 'service');
    const materialRows = rows.filter((r) => r.type === 'material');

    // Логотип
    const logoDataUrl = await loadLogoDataURL();
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', 170, 10, 30, 30);
      } catch { /* игнор, продолжим без логотипа */ }
    }

    // Заголовок
    doc.setFont(undefined, 'bold');
    doc.setFontSize(14);
    doc.text(`INVOICE #${job?.job_number || id}`, 100, 50, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 58, {
      align: 'center',
    });

    // Клиент (слева)
    let yLeft = 70;
    doc.setFont(undefined, 'bold');
    doc.text('Bill To:', 14, yLeft);
    yLeft += 6;
    doc.setFont(undefined, 'normal');
    doc.text(client?.full_name || '', 14, yLeft); yLeft += 6;
    doc.text(client?.address || '', 14, yLeft);   yLeft += 6;
    doc.text(client?.phone || '', 14, yLeft);     yLeft += 6;
    doc.text(client?.email || '', 14, yLeft);     yLeft += 8;

    // Компания (справа)
    let yRight = 70;
    doc.setFont(undefined, 'bold');
    doc.text('Sim Scope Inc.', 200, yRight, { align: 'right' }); yRight += 6;
    doc.setFont(undefined, 'normal');
    doc.text('1587 E 19th St', 200, yRight, { align: 'right' }); yRight += 6;
    doc.text('Brooklyn, NY 11230', 200, yRight, { align: 'right' }); yRight += 6;
    doc.text('(929) 412-9042', 200, yRight, { align: 'right' }); yRight += 6;
    doc.text('simscopeinc@gmail.com', 200, yRight, { align: 'right' });

    // Таблица
    autoTable(doc, {
      startY: Math.max(yLeft, yRight) + 10,
      head: [['Service', 'Qty', 'Unit Price', 'Amount']],
      body: [
        ...serviceRows.map((r) => [
          r.name,
          r.qty,
          `$${Number(r.price).toFixed(2)}`,
          `$${(Number(r.qty) * Number(r.price)).toFixed(2)}`,
        ]),
        [
          {
            content: 'MATERIALS',
            colSpan: 4,
            styles: { halign: 'left', fillColor: [230, 230, 230], fontStyle: 'bold' },
          },
        ],
        ...materialRows.map((r) => [
          r.name,
          r.qty,
          `$${Number(r.price).toFixed(2)}`,
          `$${(Number(r.qty) * Number(r.price)).toFixed(2)}`,
        ]),
      ],
      styles: { fontSize: 10, halign: 'left', lineWidth: 0.1 },
      headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 130 }, // Service
        1: { cellWidth: 20 },  // Qty
        2: { cellWidth: 25 },  // Unit Price
        3: { cellWidth: 25 },  // Amount
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

  if (loading) return <div className="p-4">Загрузка…</div>;
  if (err) return <div className="p-4 text-red-600">{err}</div>;

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
                <button onClick={() => deleteRow(i)} className="text-red-600 px-2">
                  ✕
                </button>
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
