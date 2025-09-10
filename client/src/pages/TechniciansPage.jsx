// client/src/pages/TechniciansPage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

// Роли
const roleOptions = [
  { value: 'admin',   label: 'Админ' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'tech',    label: 'Техник' },
];

const inputStyle = { width: '100%', padding: 6, border: '1px solid #e5e7eb', borderRadius: 6 };
const th = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb', textAlign: 'left', fontWeight: 600 };
const td = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9' };

export default function TechniciansPage() {
  // Доступ сюда уже пускает только админ через RequireRole
  const { loading: authLoading } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // форма добавления
  const [newRow, setNewRow] = useState({ name: '', phone: '', email: '', role: 'tech' });

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('technicians')
      .select('id, name, phone, email, role, auth_user_id')
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

  // === MAGIC LINK (email OTP) ================================
  const sendMagicLink = async (row) => {
    const target = (row.email || '').trim();
    if (!target) {
      alert('У сотрудника пустой Email');
      return;
    }

    // для hash-роутера
    const redirectTo = `${window.location.origin}/#/login`;

    // 1) пробуем войти без создания (для уже существующих в auth.users)
    let { error } = await supabase.auth.signInWithOtp({
      email: target,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });

    // 2) если не найден — пробуем создать (работает, когда Signups включены)
    if (error && /not\s*found|user.*does.*not.*exist/i.test(error.message || '')) {
      const res = await supabase.auth.signInWithOtp({
        email: target,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      error = res.error;
    }

    if (error) {
      // Частые причины
      if (error.status === 422 || /Signups.*not.*allowed/i.test(error.message || '')) {
        alert(
          'В Supabase отключены самостоятельные регистрации по email.\n' +
          'Нажмите «Пригласить» — пользователь будет создан админом и получит письмо.'
        );
      } else if (/Database error saving new user/i.test(error.message || '')) {
        alert(
          'Supabase не смог сохранить пользователя (Database error saving new user).\n' +
          'Используйте «Пригласить» — это создаст пользователя через серверную функцию.'
        );
      } else {
        console.error('sendMagicLink error:', error);
        alert('Не удалось отправить письмо: ' + (error.message || 'ошибка'));
      }
      return;
    }

    alert('Письмо со ссылкой для входа отправлено на ' + target);
  };

  // === INVITE (через Edge-функцию) ============================
  // Требуется серверная функция `invite-user` (service role).
  const inviteUser = async (row) => {
    const email = (row.email || '').trim();
    if (!email) {
      alert('У сотрудника пустой Email');
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email,
          name: row.name || '',
          phone: row.phone || '',
          role: (row.role || 'tech').toLowerCase(),
          technician_id: row.id,
        },
      });

      if (error) {
        // Когда функции нет/не настроена: error.message обычно "Function not found"
        console.error('invite-user error:', error);
        alert(
          'Не удалось пригласить пользователя.\n\n' +
          'Скорее всего, ещё не развернута Edge-функция invite-user.\n' +
          'Сделайте это один раз и попробуйте снова.'
        );
        return;
      }

      // ожидаем с сервера { ok: true, userId }
      if (data?.ok) {
        // Если на сервере не связали — доп.подстраховка: пропишем auth_user_id по email
        if (!row.auth_user_id && data.userId) {
          await supabase.from('technicians').update({ auth_user_id: data.userId }).eq('id', row.id);
        }
        await load();
        alert('Приглашение отправлено. Пользователь получит письмо и задаст пароль.');
      } else {
        console.warn('invite-user response:', data);
        alert('Сервер вернул неожиданный ответ. Проверьте логи edge-функции.');
      }
    } catch (e) {
      console.error('invite-user exception:', e);
      alert('Сбой при вызове invite-user. Проверьте, что функция задеплоена и доступна.');
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
        <button onClick={addRow} style={{ padding: '6px 12px' }}>➕ Добавить</button>
      </div>

      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={th} width="40">#</th>
              <th style={th}>Имя</th>
              <th style={th} width="180">Телефон</th>
              <th style={th} width="260">Email</th>
              <th style={th} width="160">Должность</th>
              <th style={{ ...th, textAlign: 'center' }} width="320">Действия</th>
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

                  {/* magic-link = вход по email (если signups включены) */}
                  <button
                    title="Войти по email (magic-link)"
                    onClick={() => sendMagicLink(row)}
                    style={{ marginRight: 8 }}
                  >
                    ✉️ Войти по email
                  </button>

                  {/* серверное приглaшение = создаёт пользователя, когда signups закрыты */}
                  <button
                    title="Пригласить (создать пользователя через сервер)"
                    onClick={() => inviteUser(row)}
                    style={{ marginRight: 8 }}
                  >
                    📨 Пригласить
                  </button>

                  <button title="Удалить" onClick={() => removeRow(row.id)}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Подсказка по серверной функции */}
      <div style={{ marginTop: 12, color: '#6b7280', fontSize: 13, lineHeight: 1.5 }}>
        <b>Подсказка:</b> если при «Войти по email» видите 422/“Signups not allowed”, используйте «Пригласить».
        Это вызывает Edge-функцию <code>invite-user</code> (нужен service role).  
        Функция должна создать пользователя через <code>auth.admin.inviteUserByEmail</code> и вернуть
        <code>{{"{ ok: true, userId }"}}</code>. Мы сразу записываем <code>auth_user_id</code> для техника.
      </div>
    </div>
  );
}
