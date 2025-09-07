
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import jsPDF from 'jspdf';
import logo from '../assets/logo_invoice_header.png';
import autoTable from 'jspdf-autotable';

const InvoicePage = () => {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const { data: jobData } = await supabase.from('jobs').select('*').eq('id', id).single();
      setJob(jobData);

      const { data: clientData } = await supabase.from('clients').select('*').eq('id', jobData.client_id).single();
      setClient(clientData);

      const { data: materialData } = await supabase.from('materials').select('*').eq('job_id', id);

      const initialRows = [
        { type: 'service', name: 'Labor', qty: 1, price: parseFloat(jobData.labor_price || 0) },
        { type: 'service', name: 'Service Call Fee', qty: 1, price: parseFloat(jobData.scf || 0) },
        ...(materialData || []).map(m => ({
          type: 'material',
          name: m.name,
          qty: Number(m.qty),
          price: Number(m.price)
        }))
      ];

      setRows(initialRows);
    };

    fetchData();
  }, [id]);

  const subtotal = rows.reduce((sum, item) => sum + item.qty * item.price, 0);
  const total = subtotal - discount;

  const handleChange = (index, key, value) => {
    const updated = [...rows];
    updated[index][key] = key === 'name' || key === 'type' ? value : parseFloat(value) || 0;
    setRows(updated);
  };

  const addRow = () => {
    setRows([...rows, { type: 'material', name: '', qty: 1, price: 0 }]);
  };

  const deleteRow = (index) => {
    const updated = [...rows];
    updated.splice(index, 1);
    setRows(updated);
  };

  const handleDownload = () => {
    const doc = new jsPDF();
    const serviceRows = rows.filter(r => r.type === 'service');
    const materialRows = rows.filter(r => r.type === 'material');

  // Логотип
  doc.addImage(logo, 'PNG', 170, 10, 30, 30);

  // INVOICE # + дата
  doc.setFont(undefined, 'bold');
  doc.setFontSize(14);
  doc.text(`INVOICE #${job?.job_number || id}`, 100, 50);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 100, 58);

  // Клиент (слева)
  let yLeft = 70;
  doc.setFont(undefined, 'bold');
  doc.text('Bill To:', 14, yLeft); yLeft += 6;
  doc.setFont(undefined, 'normal');
  doc.text(client.full_name || '', 14, yLeft); yLeft += 6;
  doc.text(client.address || '', 14, yLeft); yLeft += 6;
  doc.text(client.phone || '', 14, yLeft); yLeft += 6;
  doc.text(client.email || '', 14, yLeft); yLeft += 8;

  // Компания (справа, на том же уровне)
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
  head: [], // убираем стандартный заголовок
  body: [
    // Заголовок вручную
    [
      { content: 'Service', styles: { fillColor: [230, 230, 230], fontStyle: 'bold' } },
      { content: 'Qty', styles: { fillColor: [230, 230, 230], fontStyle: 'bold' } },
      { content: 'Unit Price', styles: { fillColor: [230, 230, 230], fontStyle: 'bold' } },
      { content: 'Amount', styles: { fillColor: [230, 230, 230], fontStyle: 'bold' } }
    ],
    // Заголовок секции SERVICE
    
    ...serviceRows.map(r => [
      r.name,
      r.qty,
      `$${r.price.toFixed(2)}`,
      `$${(r.qty * r.price).toFixed(2)}`
    ]),
    // Заголовок секции MATERIALS
    [{ content: 'materials', colSpan: 4, styles: { fillColor: [230, 230, 230], fontStyle: 'bold' } }],
    ...materialRows.map(r => [
      r.name,
      r.qty,
      `$${r.price.toFixed(2)}`,
      `$${(r.qty * r.price).toFixed(2)}`
    ])
  ],
  styles: { fontSize: 10, halign: 'left', lineWidth: 0 },
  headStyles: { fillColor: [250, 250, 250], textColor: 0, fontStyle: 'bold' },
  alternateRowStyles: { fillColor: [255, 255, 255] },
  margin: { left: 14, right: 14 },
  
  // 👇 Увеличиваем ширину первой колонки ("Service")
  columnStyles: {
    0: { cellWidth: 130 },  // ← ширина "Service"
    1: { cellWidth: 20 },  // Qty
    2: { cellWidth: 20 },  // Unit Price
    3: { cellWidth: 20 }   // Amount
    }
});
    let endY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`Subtotal: $${subtotal.toFixed(2)}`, 200, endY, { align: 'right' }); endY += 6;
    doc.text(`Discount: -$${discount.toFixed(2)}`, 200, endY, { align: 'right' }); endY += 6;
    doc.text(`Total Due: $${total.toFixed(2)}`, 200, endY, { align: 'right' });

    doc.save(`invoice_${job?.job_number || id}.pdf`);
  };

  if (!job || !client) return <div className="p-4">Загрузка...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-4">
        <img src={logo} alt="Logo" style={{ width: '50px' }} />
        <div className="text-right text-sm">
          <p><strong>Sim Scope Inc.</strong></p>
          <p>1587 E 19th St, Brooklyn, NY</p>
          <p>(929) 412-9042</p>
          <p>simscopeinc@gmail.com</p>
        </div>
      </div>

      <hr className="my-4" />

      <h2 className="text-xl font-bold mb-2">Invoice #{job.job_number}</h2>
      <p><strong>Client:</strong> {client.full_name}</p>
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
                <select value={r.type} onChange={e => handleChange(i, 'type', e.target.value)} className="border px-2">
                  <option value="service">service</option>
                  <option value="material">material</option>
                </select>
              </td>
              <td><input value={r.name} onChange={e => handleChange(i, 'name', e.target.value)} className="border px-2" /></td>
              <td><input type="number" value={r.qty} onChange={e => handleChange(i, 'qty', e.target.value)} className="border w-16 text-center" /></td>
              <td><input type="number" value={r.price} onChange={e => handleChange(i, 'price', e.target.value)} className="border w-20 text-right" /></td>
              <td>${(r.qty * r.price).toFixed(2)}</td>
              <td><button onClick={() => deleteRow(i)} className="text-red-600 px-2">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2">
        <button onClick={addRow} className="bg-gray-200 text-black px-3 py-1 rounded">➕ Add Row</button>
      </div>

      <div className="mt-4 text-right">
        <p>Subtotal: ${subtotal.toFixed(2)}</p>
        <div className="inline-flex items-center gap-2 mt-2">
          <label className="font-semibold">Discount $:</label>
          <input
            type="number"
            className="border px-2 py-1 w-24 text-right"
            value={discount}
            onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
          />
        </div>
        <p className="font-bold text-lg mt-2">Total Due: ${total.toFixed(2)}</p>
      </div>

      <div className="mt-4">
        <button onClick={handleDownload} className="bg-blue-600 text-white px-4 py-2 rounded">📄 Скачать PDF</button>
      </div>
    </div>
  );
};

export default InvoicePage;
