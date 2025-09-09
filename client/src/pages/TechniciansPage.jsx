import React, { useEffect, useState } from 'react';
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
  const [busyId, setBusyId] = useState(null);

  // форма добавления
  const [newRow, setNewRow] = useState({ name: '', phone: '', email: '', role: 'tech' });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('technicians')
      .select('id, name, phone, email, role, auth_user_id')
      .order('name', { ascending: true });

    if (error) {
      console.error(error);
      alert('Не удалось загрузить сотрудников');
    } else {
      setItems(data || []);
    }
    setLoading(false);
  };

  const onChangeCell = (id, field, value) => {
    setItems(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const saveRow = async (row) => {
    setBusyId(row.id);
    const payload = {
      name: row.name?.trim() || null,
      phone: row.phone?.trim() || null,
      email: row.email?.trim() || null,    // 👈 новый email
      role: row.role || null,
    };
    const { error } = await supabase.from('technicians').update(payload).eq('id', row.id);
    setBusyId(null);
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
      email: newRow.email?.trim() || null, // 👈 сохраняем email
      role: newRow.role || 'tech',
    };
    const { error } = await supabase.from('technicians').insert(payload);
    if (error) {
      console.error(error);
      if (String(error.message).includes('unique')) {
        alert('Такой email уже существует у другого сотрудника');
      } else {
        alert('Ошибка при добавлении');
      }
      return;
    }
    setNewRow({ name: '', phone: '', email: '', role: 'tech' });
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

  /**
   * Отправка волшебной ссылки для входа на email сотрудника.
   * Работает с клиентским ключом — admin-ключ не нужен.
   * После входа триггер в БД привяжет auth_user_id к technicians по email.
   */
  const sendMagicLink = async (row) => {
    const email = row.email?.trim();
    if (!email) {
      alert('У сотрудника не указан email');
      return;
    }

    try {
      setBusyId(row.id);
      const redirectTo = `${window.location.origin}/`; // вернёмся на главную после подтверждения
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      setBusyId(null);

      if (error) {
        console.error(error);
        alert('Не удалось отправить ссылку: ' + error.message);
        return;
      }
      alert('Приглашение отправлено на ' + email);
    } catch (e) {
      setBusyId(null);
      console.error(e);
      alert('Не удалось отправить ссылку');
    }
  };

  // На всякий случай: быстрая «ссылка для письма» (если хочешь отправлять сам из почты)
  const inviteMailto = (row) => {
    const appUrl = window.location.origin + '/';
    const subject = encodeURIComponent('Доступ в HVAC App');
    const body = encodeURIComponent(
      `Здравствуйте!\n\nВойдите по ссылке: ${appUrl}\nНажмите "Войти по ссылке" и укажите этот email: ${row.email || ''}.\n`
    );
    return `mailto:${row.email || ''}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">👥 Сотрудники</h1>

      {/* Форма добавления */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.5fr 2fr 1.2fr auto',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
        }}
      >
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
        <input
          style={inputStyle}
          placeholder="Email"
          value={newRow.email}
          onChange={e => setNewRow({ ...newRow, email: e.target.value })}
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
              <th style={th} width="160">Телефон</th>
              <th style={th} width="240">Email</th>
              <th style={th} width="140">Должность</th>
              <th style={{ ...th, textAlign: 'center' }} width="260">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td style={td} colSpan={6}>Загрузка…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td style={td} colSpan={6}>Сотрудников пока нет</td></tr>
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
                  <input
                    style={inputStyle}
                    type="email"
                    value={row.email || ''}
                    onChange={e => onChangeCell(row.id, 'email', e.target.value)}
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
                  <button
                    title="Сохранить"
                    onClick={() => saveRow(row)}
                    style={{ marginRight: 6 }}
                    disabled={busyId === row.id}
                  >
                    {busyId === row.id ? '…' : '💾 Сохранить'}
                  </button>

                  <button
                    title="Отправить ссылку для входа"
                    onClick={() => sendMagicLink(row)}
                    style={{ marginRight: 6 }}
                    disabled={busyId === row.id}
                  >
                    ✉️ Отправить ссылку
                  </button>

                  <a
                    title="Открыть письмо в почтовом клиенте"
                    href={inviteMailto(row)}
                    style={{ marginRight: 6 }}
                  >
                    📧 Письмо
                  </a>

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
