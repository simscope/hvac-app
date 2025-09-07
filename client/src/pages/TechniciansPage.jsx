import React, { useEffect, useState } from 'react';
// ЕСЛИ у тебя клиент называется иначе, замени импорт на:  import { supabase } from '../supabase';
import { supabase } from '../supabaseClient';

const roleOptions = [
  { value: 'manager', label: 'Менеджер' },
  { value: 'tech', label: 'Техник' },
];

const inputStyle = { width: '100%', padding: 6, border: '1px solid #e5e7eb', borderRadius: 6 };
const th = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb', textAlign: 'left', fontWeight: 600 };
const td = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9' };

export default function TechniciansPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // форма для добавления
  const [newRow, setNewRow] = useState({ name: '', phone: '', role: 'tech' });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('technicians').select('*').order('name', { ascending: true });
    if (!error) setItems(data || []);
    setLoading(false);
  };

  const onChangeCell = (id, field, value) => {
    setItems(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const saveRow = async (row) => {
    const payload = {
      name: row.name ?? null,
      phone: row.phone ?? null,
      role: row.role ?? null, // <-- Должность
    };
    const { error } = await supabase.from('technicians').update(payload).eq('id', row.id);
    if (error) {
      console.error(error);
      alert('Ошибка при сохранении');
      return;
    }
    await load();
  };

  const addRow = async () => {
    if (!newRow.name?.trim()) {
      alert('Введите имя');
      return;
    }
    const payload = {
      name: newRow.name.trim(),
      phone: newRow.phone?.trim() || null,
      role: newRow.role || 'tech',
    };
    const { error } = await supabase.from('technicians').insert(payload);
    if (error) {
      console.error(error);
      alert('Ошибка при добавлении');
      return;
    }
    setNewRow({ name: '', phone: '', role: 'tech' });
    await load();
  };

  const removeRow = async (id) => {
    if (!window.confirm('Удалить сотрудника?')) return;
    const { error } = await supabase.from('technicians').delete().eq('id', id);
    if (error) {
      console.error(error);
      alert('Ошибка при удалении');
      return;
    }
    setItems(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">👥 Сотрудники</h1>

      {/* Форма добавления */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.2fr auto', gap: 8, marginBottom: 12 }}>
        <input
          style={inputStyle}
          placeholder="Имя"
          value={newRow.name}
          onChange={e => setNewRow({ ...newRow, name: e.target.value })}
        />
        <input
          style={inputStyle}
          placeholder="Телефон"
          value={newRow.phone}
          onChange={e => setNewRow({ ...newRow, phone: e.target.value })}
        />
        <select
          style={inputStyle}
          value={newRow.role}
          onChange={e => setNewRow({ ...newRow, role: e.target.value })}
        >
          {roleOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button onClick={addRow} style={{ padding: '6px 12px' }}>➕ Добавить</button>
      </div>

      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={th} width="40">#</th>
              <th style={th}>Имя</th>
              <th style={th} width="200">Телефон</th>
              <th style={th} width="200">Должность</th>
              <th style={{ ...th, textAlign: 'center' }} width="160">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td style={td} colSpan={5}>Загрузка…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td style={td} colSpan={5}>Сотрудников пока нет</td></tr>
            )}
            {items.map((row, idx) => (
              <tr key={row.id}>
                <td style={td}>{idx + 1}</td>
                <td style={td}>
                  <input
                    style={inputStyle}
                    value={row.name || ''}
                    onChange={e => onChangeCell(row.id, 'name', e.target.value)}
                  />
                </td>
                <td style={td}>
                  <input
                    style={inputStyle}
                    value={row.phone || ''}
                    onChange={e => onChangeCell(row.id, 'phone', e.target.value)}
                  />
                </td>
                <td style={td}>
                  <select
                    style={inputStyle}
                    value={row.role || 'tech'}
                    onChange={e => onChangeCell(row.id, 'role', e.target.value)}
                  >
                    {roleOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button title="Сохранить" onClick={() => saveRow(row)} style={{ marginRight: 6 }}>💾</button>
                  <button title="Удалить" onClick={() => removeRow(row.id)}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
