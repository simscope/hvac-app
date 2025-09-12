// src/pages/AdminTechniciansPage.jsx
// В том же стиле, что у тебя: ненавязчивые бордеры/радиусы.
// Важное: если invoke вернул FunctionsHttpError — делаем "raw" fetch и
// показываем JSON ответа (status, stage, error, details, action_link).

import React, { useEffect, useMemo, useState } from 'react';
import { supabase, supabaseUrl } from '../supabaseClient';

const input = "w-full px-3 py-2 border rounded";
const btn   = "px-3 py-2 border rounded hover:bg-gray-50";
const th    = "px-3 py-2 text-left border-b";
const td    = "px-3 py-2 border-b";

function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Сырой вызов функции для получения тела ошибки при 4xx/5xx
async function rawCallFunction(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  const url = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${path}`;

  const res  = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

/* ——— маленький баннер-алёрт в твоём стиле ——— */
function Alert({ kind = 'info', title, children }) {
  const color =
    kind === 'error'   ? 'border-red-300 bg-red-50' :
    kind === 'success' ? 'border-green-300 bg-green-50' :
    'border-gray-300 bg-gray-50';
  return (
    <div className={`border rounded px-3 py-2 ${color}`}>
      {title && <div className="font-medium mb-1">{title}</div>}
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
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

  // UI: баннер + “детали” (JSON из функции)
  const [banner, setBanner] = useState(null); // { kind, title, text, details? }
  const [showDetails, setShowDetails] = useState(false);

  // Поиск/фильтр под нашу таблицу
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

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
    const { data, error } = await supabase
      .from('technicians')
      .select('id, name, phone, role, is_admin, org_id, auth_user_id, email')
      .order('name', { ascending: true });
    if (error) {
      setBanner({ kind: 'error', title: 'Ошибка загрузки', text: error.message });
    }
    setList(data || []);
  }

  function filteredRows() {
    return (list || [])
      .filter(r => !q ? true : [r.name, r.email, r.phone].some(v => String(v || '').toLowerCase().includes(q.toLowerCase())))
      .filter(r => roleFilter === 'all' ? true : r.role === roleFilter);
  }

  function resetForm() {
    setEmail(""); setName(""); setPhone("");
    setRole("tech"); setPassword(genTempPassword()); setOrgId(1);
  }

  async function createTech(e) {
    e.preventDefault();
    setBanner(null); setShowDetails(false);

    if (!isAdmin) {
      setBanner({ kind: 'error', title: 'Нет прав', text: 'Только администратор может создавать сотрудников.' });
      return;
    }

    const payload = {
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role,
      org_id: Number(orgId) || 1,
      link_if_exists: true,
    };

    setLoading(true);
    try {
      // 1) основной вызов
      const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });

      if (error || data?.error || data?.warning) {
        // 2) fallback: сырой запрос — показать статус/стадию/детали
        const raw = await rawCallFunction('admin-create-user', payload);
        setBanner({
          kind: raw.ok ? 'success' : 'error',
          title: raw.ok ? 'Сотрудник создан' : 'Не удалось создать сотрудника',
          text: raw.ok ? 'Учётка зарегистрирована/привязана.' : 'Функция вернула ошибку.',
          details: { status: raw.status, ...raw.json },
        });
        if (!raw.ok) return; // выходим на ошибке
      } else {
        setBanner({
          kind: 'success',
          title: 'Сотрудник создан',
          text: 'Передайте e-mail и временный пароль.',
          details: data,
        });
      }

      resetForm();
      await fetchTechnicians();
    } catch (err) {
      setBanner({ kind: 'error', title: 'Необработанная ошибка', text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(emailAddr) {
    setBanner(null); setShowDetails(false);

    const inv = await supabase.functions.invoke('admin-create-user', {
      body: { action: 'sendPasswordReset', email: emailAddr }
    });

    if (inv.error || inv.data?.error) {
      const raw = await rawCallFunction('admin-create-user', { action: 'sendPasswordReset', email: emailAddr });
      setBanner({
        kind: raw.ok ? 'success' : 'error',
        title: raw.ok ? 'Ссылка на сброс готова' : 'Сброс не выполнен',
        text: raw.ok ? 'Письмо отправлено либо ссылка сгенерирована.' : 'Функция вернула ошибку.',
        details: { status: raw.status, ...raw.json },
      });
      return;
    }

    setBanner({
      kind: 'success',
      title: 'Ссылка на сброс готова',
      text: 'Письмо отправлено либо ссылка сгенерирована.',
      details: inv.data,
    });
  }

  const disableSubmit = loading || !email.trim() || !name.trim() || !password;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Техники / Сотрудники</h1>

      {/* Баннер состояния (в твоём стиле) */}
      {banner && (
        <div className="mb-4">
          <Alert kind={banner.kind} title={banner.title}>
            {banner.text}
            {banner.details && (
              <>
                <button className={`${btn} ml-2`} onClick={() => setShowDetails(v => !v)}>
                  {showDetails ? 'Скрыть детали' : 'Показать детали'}
                </button>
                {showDetails && (
                  <pre className="mt-2 max-h-72 overflow-auto bg-white border rounded p-2 text-xs">
                    {JSON.stringify(banner.details, null, 2)}
                  </pre>
                )}
              </>
            )}
          </Alert>
        </div>
      )}

      {/* Форма */}
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
            <button type="button" className={btn} onClick={() => setPassword(genTempPassword())}>Сгенерировать</button>
          </div>
          <div className="text-xs text-gray-500 mt-1">Выдай сотруднику этот пароль для первого входа.</div>
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <button disabled={disableSubmit} className={btn} type="submit">
            {loading ? "Создаю..." : "Создать сотрудника"}
          </button>
          <button type="button" className={btn} disabled={loading} onClick={resetForm}>
            Очистить
          </button>
        </div>
      </form>

      {/* Поиск/фильтр в том же стиле */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <input className={input} placeholder="Поиск (имя, email, телефон)" value={q} onChange={e => setQ(e.target.value)} />
        <select className={input} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">Все роли</option>
          <option value="admin">Админ</option>
          <option value="manager">Менеджер</option>
          <option value="tech">Техник</option>
        </select>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={fetchTechnicians}>Обновить список</button>
        </div>
      </div>

      {/* Таблица — оставил как у тебя */}
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
            {filteredRows().map(row => (
              <tr key={row.id}>
                <td className={td}>{row.name}</td>
                <td className={td}>{row.email || "-"}</td>
                <td className={td}>{row.phone || "-"}</td>
                <td className={td}>{row.role}</td>
                <td className={td}>{row.is_admin ? "TRUE" : "FALSE"}</td>
                <td className={td}>
                  <button className={btn} onClick={() => row.email && sendReset(row.email)} disabled={!row.email}>
                    Сброс пароля
                  </button>
                </td>
              </tr>
            ))}
            {filteredRows().length === 0 && <tr><td className={td} colSpan={6}>Нет сотрудников</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
