// client/src/pages/AdminTechniciansPage.jsx
// Создание сотрудника с расширенным выводом ошибок из Edge Function.

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const input = "w-full px-3 py-2 border rounded";
const btn = "px-3 py-2 border rounded hover:bg-gray-50";
const th = "px-3 py-2 text-left border-b";
const td = "px-3 py-2 border-b";

function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function AdminTechniciansPage() {
  const [me, setMe] = useState(null);
  const [meProfileRole, setMeProfileRole] = useState(null);
  const [meTechInfo, setMeTechInfo] = useState(null);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("tech");
  const [password, setPassword] = useState(genTempPassword());
  const [orgId, setOrgId] = useState(1);

  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me.app_metadata?.role === 'admin') return true;
    if (meProfileRole === 'admin') return true;
    if (meTechInfo?.role === 'admin' || meTechInfo?.is_admin) return true;
    return false;
  }, [me, meProfileRole, meTechInfo]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);

      if (user) {
        const prof = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
        setMeProfileRole(prof.data?.role ?? null);

        const tech = await supabase.from('technicians').select('role, is_admin').eq('auth_user_id', user.id).maybeSingle();
        setMeTechInfo(tech.data || null);
      }

      await fetchTechnicians();
    })();
  }, []);

  async function fetchTechnicians() {
    const { data } = await supabase
      .from('technicians')
      .select('id, name, phone, role, is_admin, org_id, auth_user_id, email')
      .order('name', { ascending: true });
    setList(data || []);
  }

  function showEdgeError(prefix, errObj, dataObj) {
    // Пытаемся вытащить тело ответа Edge Function
    const msgParts = [prefix];
    if (errObj?.message) msgParts.push(`message: ${errObj.message}`);
    // supabase-js кладёт тело в error.context?.response?.text
    const ctx = errObj?.context as any;
    const resp = ctx?.response;
    if (resp?.error) msgParts.push(`resp.error: ${resp.error}`);
    if (resp?.status) msgParts.push(`status: ${resp.status}`);
    if (resp?.body) {
      msgParts.push(`body: ${JSON.stringify(resp.body)}`);
    }
    if (dataObj?.error || dataObj?.warning) {
      msgParts.push(`payload: ${JSON.stringify(dataObj)}`);
    }
    alert(msgParts.join("\n"));
  }

  async function createTech(e) {
    e.preventDefault();
    if (!isAdmin) return alert("Только админ может создавать сотрудников");

    setLoading(true);
    try {
      const payload = {
        email: email.trim(),
        password,
        name: name.trim(),
        phone: phone.trim() || null,
        role,
        org_id: Number(orgId) || 1,
      };

      const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });

      if (error) {
        showEdgeError("Edge Function error", error, data);
        return;
      }
      if (data?.error) {
        showEdgeError("Edge returned error", null, data);
        return;
      }

      setEmail("");
      setName("");
      setPhone("");
      setRole("tech");
      setPassword(genTempPassword());

      await fetchTechnicians();
      alert("Сотрудник создан. Передай ему e-mail и временный пароль.");
    } catch (err) {
      alert("Unhandled error: " + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(emailAddr) {
    if (!isAdmin) return;
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { action: 'sendPasswordReset', email: emailAddr }
    });
    if (error || data?.error) {
      showEdgeError("Reset error", error, data);
    } else {
      alert("Ссылка на сброс пароля сгенерирована/отправлена (см. настройки проекта).");
    }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Техники / Сотрудники</h1>

      <form onSubmit={createTech} className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-3 mb-6">
        <div>
          <label className="block text-sm mb-1">E-mail *</label>
          <input className={input} type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Телефон</label>
          <input className={input} value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Имя / ФИО *</label>
          <input className={input} required value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Роль *</label>
          <select className={input} value={role} onChange={e => setRole(e.target.value)}>
            <option value="tech">Техник</option>
            <option value="manager">Менеджер</option>
            <option value="admin">Админ</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Орг. ID</label>
          <input className={input} type="number" value={orgId} onChange={e => setOrgId(e.target.value)} />
          <div className="text-xs text-gray-500 mt-1">Если всегда 1 — можно не трогать.</div>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Временный пароль *</label>
          <div className="flex gap-2">
            <input className={input} required value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" className={btn} onClick={() => setPassword(genTempPassword())}>
              Сгенерировать
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-1">Выдай сотруднику этот пароль для первого входа.</div>
        </div>
        <div className="md:col-span-2">
          <button disabled={loading} className={btn} type="submit">
            {loading ? "Создаю..." : "Создать сотрудника"}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full border">
          <thead>
            <tr>
              <th className={th}>Имя</th>
              <th className={th}>E-mail</th>
              <th className={th}>Телефон</th>
              <th className={th}>Роль</th>
              <th className={th}>is_admin</th>
              <th className={th}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {list.map(row => (
              <tr key={row.id}>
                <td className={td}>{row.name}</td>
                <td className={td}>{row.email || "-"}</td>
                <td className={td}>{row.phone || "-"}</td>
                <td className={td}>{row.role}</td>
                <td className={td}>{row.is_admin ? "TRUE" : "FALSE"}</td>
                <td className={td}>
                  <div className="flex gap-2">
                    <button className={btn} onClick={() => row.email && sendReset(row.email)} disabled={!row.email}>
                      Сброс пароля
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td className={td} colSpan={6}>Нет сотрудников</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
