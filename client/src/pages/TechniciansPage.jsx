// client/src/pages/TechniciansPage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

// Должности
const roleOptions = [
  { value: 'admin',   label: 'Админ' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'tech',    label: 'Техник' },
];

const inputStyle = { width: '100%', padding: 6, border: '1px solid #e5e7eb', borderRadius: 6 };
const th = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb', textAlign: 'left', fontWeight: 600 };
const td = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9' };

export default function TechniciansPage() {
  // Роут уже фильтрует доступ по роли; используем auth только ради спиннера
  const { loading: authLoading } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Форма добавления
  const [newRow, setNewRow] = useState({ name: '', phone: '', email: '', role: 'tech' });

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('technicians')
      .select('id, name, phone, email, role')
      .order('name', { ascending: true });

    if (error) {
      console.error('technicians select error:', error);
      alert('Ошибка загрузки сотрудников');
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  };

  const onChangeCell = (id, field, value) => {
    setItems(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const saveRow = async (row) => {
    const payload = {
      name:  row.name?.trim()  || null,
      phone: row.phone?.trim() || null,
      email: row.email?.trim() || null,
      role:  row.role ? String(row.role).trim().toLowerCase() : null,
    };
    const { error } = await supabase.from('technicians').update(payload).eq('id', row.id);
    if (error) {
      console.error('technicians update error:', error);
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
      name:  newRow.name.trim(),
      phone: newRow.phone?.trim() || null,
      email: newRow.email?.trim() || null,
      role:  (newRow.role || 'tech').toLowerCase().trim(),
    };
    const { error } = await supabase.from('technicians').insert(payload);
    if (error) {
      console.error('technicians insert error:', error);
      alert('Ошибка при добавлении');
      return;
    }
    setNewRow({ name: '', phone: '', email: '', role: 'tech' });
    await load();
  };

  const removeRow = async (id) => {
    if (!window.confirm('Удалить сотрудника?')) return;
    const { error } = await supabase.from('technicians').delete().eq('id', id);
    if (error) {
      console.error('technicians delete error:', error);
      alert('Ошибка при удалении');
      return;
    }
    setItems(prev => prev.filter(r => r.id !== id));
  };

  /**
   * Отправка magic-link (email OTP).
   * Без emailRedirectTo → берётся Authentication → URL Configuration → Site URL.
   * Сначала пробуем только существующему пользователю (shouldCreateUser: false),
   * если «user not found» — пытаемся создать (shouldCreateUser: true).
   */
  const sendLoginLink = async (email) => {
    const target = (email || '').trim();
    if (!target) return alert('У сотрудника пустой Email');

    const tryOtp = (shouldCreateUser) =>
      supabase.auth.signInWithOtp({
        email: target,
        options: {
          shouldCreateUser,
          // НЕ передаём emailRedirectTo — это устраняет типовой 422 из-за redirect_to
        },
      });

    // 1) только существующим
    let { error } = await tryOtp(false);

    // 2) если нет пользователя — создаём (если разрешены signups)
    if (error && /not\s*found|user\s*not\s*found/i.test(error.message || '')) {
      const r2 = await tryOtp(true);
      error = r2.error;
    }

    if (error) {
      const msg = (error.message || '').toLowerCase();

      if (msg.includes('signups not allowed')) {
        return alert(
          'В Supabase запрещены регистрации по email.\n' +
          'Включи: Authentication → Sign In / Providers → Allow new users to sign up.'
        );
      }
      if (msg.includes('redirect') || msg.includes('url')) {
        return alert(
          'Supabase отклонил redirect_to.\n' +
          'Решение: не передавать redirect_to в коде и убедиться, что в URL Configuration ' +
          'прописан Site URL https://hvac-app-jade.vercel.app (и он же в Additional Redirect URLs).'
        );
      }

      console.error('[sendLoginLink] error:', error);
      return alert('Не удалось отправить письмо: ' + (error.message || 'ошибка'));
    }

    alert('Письмо со ссылкой для входа отправлено на ' + target);
  };

  if (authLoading) return <div className="p-4">Загрузка…</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">👥 Сотрудники</h1>

      {/* Форма добавления */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr 2fr 1.2fr auto', gap: 8, marginBottom: 12 }}>
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
              <th style={th} width="180">Телефон</th>
              <th style={th} width="240">Email</th>
              <th style={th} width="160">Должность</th>
              <th style={{ ...th, textAlign: 'center' }} width="220">Действия</th>
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
                    value={row.email || ''}
                    onChange={e => onChangeCell(row.id, 'email', e.target.value)}
                  />
                </td>
                <td style={td}>
                  <select
                    style={inputStyle}
                    value={(row.role || 'tech').toLowerCase()}
                    onChange={e => onChangeCell(row.id, 'role', e.target.value)}
                  >
                    {roleOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button title="Сохранить" onClick={() => saveRow(row)} style={{ marginRight: 8 }}>💾</button>
                  <button title="Письмо для входа" onClick={() => sendLoginLink(row.email)} style={{ marginRight: 8 }}>
                    ✉️ Войти по email
                  </button>
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
