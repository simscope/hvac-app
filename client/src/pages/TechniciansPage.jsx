// client/src/pages/AdminTechniciansPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const input = "w-full px-3 py-2 border rounded";
const btn = "px-3 py-2 border rounded hover:bg-gray-50";
const th = "px-3 py-2 text-left border-b";
const td = "px-3 py-2 border-b";

function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

export default function AdminTechniciansPage() {
  const [me, setMe] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);

  // Форма создания
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("tech");
  const [password, setPassword] = useState(genTempPassword());
  const [notes, setNotes] = useState("");

  const isAdmin = useMemo(() => (me?.app_metadata?.role === 'admin'), [me]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);
      await fetchStaff();
    })();
  }, []);

  async function fetchStaff() {
    const { data, error } = await supabase
      .from('staff')
      .select('id, auth_user_id, email, full_name, phone, role, is_active, created_at, notes')
      .order('created_at', { ascending: false });
    if (!error) setStaff(data || []);
  }

  async function createEmployee(e) {
    e.preventDefault();
    if (!isAdmin) {
      alert("Только админ может создавать сотрудников");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        email: email.trim(),
        password: password,
        role,
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        is_active: true,
        notes: notes || null,
      };
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: payload,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // очистим форму, обновим список
      setEmail(""); setFullName(""); setPhone(""); setRole("tech"); setPassword(genTempPassword()); setNotes("");
      await fetchStaff();
      alert("Пользователь создан. Передай ему логин и временный пароль.");
    } catch (err) {
      alert("Ошибка создания: " + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(row) {
    if (!isAdmin) return;
    const { error } = await supabase
      .from('staff')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);
    if (!error) fetchStaff();
  }

  async function sendReset(email) {
    if (!isAdmin) return;
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { action: 'sendPasswordReset', email }
    });
    if (error || data?.error) {
      alert("Не удалось отправить reset: " + (error?.message || data?.error));
    } else {
      alert("Ссылка на сброс пароля сгенерирована/отправлена (см. настройки проекта).");
    }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Сотрудники</h1>

      {/* ФОРМА СОЗДАНИЯ */}
      <form onSubmit={createEmployee} className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-3 mb-6">
        <div>
          <label className="block text-sm mb-1">E-mail *</label>
          <input className={input} type="email" required value={email} onChange={e=>setEmail(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Телефон</label>
          <input className={input} value={phone} onChange={e=>setPhone(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">ФИО</label>
          <input className={input} value={fullName} onChange={e=>setFullName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Роль *</label>
          <select className={input} value={role} onChange={e=>setRole(e.target.value)}>
            <option value="tech">Техник</option>
            <option value="manager">Менеджер</option>
            <option value="admin">Админ</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Временный пароль *</label>
          <div className="flex gap-2">
            <input className={input} required value={password} onChange={e=>setPassword(e.target.value)} />
            <button type="button" className={btn} onClick={()=>setPassword(genTempPassword())}>Сгенерировать</button>
          </div>
          <div className="text-xs text-gray-500 mt-1">Отдай сотруднику e-mail и этот временный пароль для входа.</div>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Заметки</label>
          <textarea className={input} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <button disabled={loading} className={btn} type="submit">
            {loading ? "Создаю..." : "Создать сотрудника"}
          </button>
        </div>
      </form>

      {/* ТАБЛИЦА */}
      <div className="overflow-x-auto">
        <table className="w-full border">
          <thead>
            <tr>
              <th className={th}>Дата</th>
              <th className={th}>E-mail</th>
              <th className={th}>ФИО</th>
              <th className={th}>Телефон</th>
              <th className={th}>Роль</th>
              <th className={th}>Статус</th>
              <th className={th}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(row => (
              <tr key={row.id}>
                <td className={td}>{new Date(row.created_at).toLocaleString()}</td>
                <td className={td}>{row.email}</td>
                <td className={td}>{row.full_name || '-'}</td>
                <td className={td}>{row.phone || '-'}</td>
                <td className={td}>{row.role}</td>
                <td className={td}>
                  <span className={`px-2 py-1 rounded text-sm ${row.is_active ? 'bg-green-100' : 'bg-gray-200'}`}>
                    {row.is_active ? 'активен' : 'выкл.'}
                  </span>
                </td>
                <td className={td}>
                  <div className="flex gap-2">
                    <button className={btn} onClick={()=>toggleActive(row)}>
                      {row.is_active ? 'Отключить' : 'Включить'}
                    </button>
                    <button className={btn} onClick={()=>sendReset(row.email)}>
                      Сброс пароля
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr><td className={td} colSpan={7}>Нет сотрудников</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
