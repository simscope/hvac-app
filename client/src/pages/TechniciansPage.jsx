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

function isEmail(v) {
  return !!String(v || '').trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
}

export default function TechniciansPage() {
  // Роут уже фильтрует доступ по роли; используем auth только ради спиннера
  const { loading: authLoading } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Форма добавления
  const [newRow, setNewRow] = useState({ name: '', phone: '', email: '', role: 'tech' });

  // Локальные флаги занятости
  const [savingId, setSavingId] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [adding, setAdding] = useState(false);

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
    setSavingId(row.id);
    const payload = {
      name:  row.name?.trim()  || null,
      phone: row.phone?.trim() || null,
      email: row.email?.trim() || null,
      role:  row.role ? String(row.role).trim().toLowerCase() : null,
    };
    try {
      const { error } = await supabase.from('technicians').update(payload).eq('id', row.id);
      if (error) throw error;
      await load();
    } catch (e) {
      console.error('technicians update error:', e);
      alert('Ошибка при сохранении: ' + (e.message || 'неизвестная ошибка'));
    } finally {
      setSavingId(null);
    }
  };

  const addRow = async () => {
    if (!newRow.name?.trim()) {
      alert('Введите имя');
      return;
    }
    if (!isEmail(newRow.email)) {
      alert('Укажите корректный Email — он нужен для входа по ссылке');
      return;
    }

    setAdding(true);
    const payload = {
      name:  newRow.name.trim(),
      phone: newRow.phone?.trim() || null,
      email: newRow.email?.trim() || null,
      role:  (newRow.role || 'tech').toLowerCase().trim(),
    };
    try {
      const { error } = await supabase.from('technicians').insert(payload);
      if (error) throw error;
      setNewRow({ name: '', phone: '', email: '', role: 'tech' });
      await load();
    } catch (e) {
      console.error('technicians insert error:', e);
      alert('Ошибка при добавлении: ' + (e.message || 'неизвестная ошибка'));
    } finally {
      setAdding(false);
    }
  };

  const removeRow = async (id) => {
    if (!window.confirm('Удалить сотрудника?')) return;
    try {
      const { error } = await supabase.from('technicians').delete().eq('id', id);
      if (error) throw error;
      setItems(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error('technicians delete error:', e);
      alert('Ошибка при удалении: ' + (e.message || 'неизвестная ошибка'));
    }
  };

  // Отправка magic-link (email OTP)
  const sendLoginLink = async (email, rowId) => {
    const target = (email || '').trim();
    if (!target) {
      alert('У сотрудника пустой Email');
      return;
    }
    if (!isEmail(target)) {
      alert('Некорректный Email');
      return;
    }

    setSendingId(rowId || -1);

    // Для hash-роутера возвращаем на /#/login
    const redirectTo = window.location.origin;

    try {
      // 1) Пытаемся отправить ссылку ТОЛЬКО существующему пользователю
      let { error } = await supabase.auth.signInWithOtp({
        email: target,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });

      // 2) Если пользователь не найден — пробуем создать (если signups разрешены)
      if (error && /not\s*found/i.test(error.message || '')) {
        const res = await supabase.auth.signInWithOtp({
          email: target,
          options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
        });
        error = res.error;
      }

      if (error) {
        // Частые сценарии — даём человеку понятные подсказки
        if (/signups.*not.*allowed.*otp/i.test(error.message || '')) {
          alert(
            'Регистрация по email отключена в Supabase.\n' +
            'Включи signups в Auth → Settings или создай пользователя вручную в Auth → Users (Invite).'
          );
        } else if (/Database error saving new user/i.test(error.message || '')) {
          alert(
            'Supabase не смог создать пользователя (Database error saving new user).\n' +
            'Проверь: Auth → Providers (Email ON), Settings → Signups (ON), Redirect URLs добавлен,\n' +
            'и что нет «жёсткого» триггера на вставку в auth.users/public.profiles.'
          );
        } else {
          throw error;
        }
        return;
      }

      alert('Письмо со ссылкой для входа отправлено на ' + target);
    } catch (e) {
      console.error('sendLoginLink error:', e);
      alert('Не удалось отправить письмо: ' + (e.message || 'ошибка'));
    } finally {
      setSendingId(null);
    }
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
        <button onClick={addRow} disabled={adding} style={{ padding: '6px 12px' }}>
          {adding ? 'Добавляю…' : '➕ Добавить'}
        </button>
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
                  <button
                    title="Сохранить"
                    onClick={() => saveRow(row)}
                    disabled={savingId === row.id}
                    style={{ marginRight: 8 }}
                  >
                    {savingId === row.id ? '💾…' : '💾'}
                  </button>
                  <button
                    title="Письмо для входа"
                    onClick={() => sendLoginLink(row.email, row.id)}
                    disabled={sendingId === row.id}
                    style={{ marginRight: 8 }}
                  >
                    {sendingId === row.id ? '✉️…' : '✉️ Войти по email'}
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

