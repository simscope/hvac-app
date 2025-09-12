// src/pages/AdminTechniciansPage.jsx
// Вариант B (ledger): «классический леджер» — тонкие границы, серый заголовок,
// без лишней декоративности. Org ID и is_admin убраны. Если invoke даёт
// FunctionsHttpError — делаем raw fetch и показываем JSON (status, stage, error, details).

import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

/* —— стиль «ledger» —— */
const input  = "w-full px-2.5 py-1.5 border rounded text-sm";
const select = input;
const btn    = "px-2.5 py-1.5 border rounded text-sm hover:bg-gray-50";
const th     = "px-2.5 py-1.5 text-left border-b border-gray-300 text-sm bg-gray-50 whitespace-nowrap";
const td     = "px-2.5 py-1.5 border-b border-gray-200 text-sm align-top";
const label  = "block text-[12px] mb-0.5 text-gray-700";
const table  = "w-full border border-gray-300 text-sm";

/* генератор временного пароля */
function genTempPassword(len = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/* сырой вызов Edge-функции — чтобы получить тело ошибки при 4xx/5xx */
async function rawCallFunction(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

/* тонкий баннер с опциональными «деталями» */
function Banner({ title, text, details, onToggle, open }) {
  if (!title && !text) return null;
  return (
    <div className="border rounded px-3 py-2 mb-3">
      <div className="flex items-center gap-2">
        <div className="font-medium text-sm">{title}</div>
        {details && (
          <button className={btn} onClick={onToggle}>
            {open ? "Скрыть детали" : "Показать детали"}
          </button>
        )}
      </div>
      {text && <div className="text-sm mt-1">{text}</div>}
      {open && details && (
        <pre className="mt-2 max-h-72 overflow-auto border rounded p-2 text-[12px] bg-white">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AdminTechniciansPage() {
  /* auth */
  const [me, setMe] = useState(null);
  const [meProfileRole, setMeProfileRole] = useState(null);
  const [meTechInfo, setMeTechInfo] = useState(null);

  /* data */
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  /* form */
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("tech");
  const [password, setPassword] = useState(genTempPassword());

  /* ui */
  const [banner, setBanner] = useState(null); // {title, text, details}
  const [openDetails, setOpenDetails] = useState(false);

  /* filters */
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me.app_metadata?.role === "admin") return true;
    if (meProfileRole === "admin") return true;
    if (meTechInfo?.role === "admin" || meTechInfo?.is_admin) return true;
    return false;
  }, [me, meProfileRole, meTechInfo]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);

      if (user) {
        const prof = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        setMeProfileRole(prof.data?.role ?? null);

        const tech = await supabase.from("technicians").select("role, is_admin").eq("auth_user_id", user.id).maybeSingle();
        setMeTechInfo(tech.data || null);
      }
      await fetchTechnicians();
    })();
  }, []);

  async function fetchTechnicians() {
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, role, auth_user_id, email") // is_admin и org_id убраны
      .order("name", { ascending: true });

    if (error) setBanner({ title: "Ошибка загрузки", text: error.message });
    setList(data || []);
  }

  function filteredRows() {
    return (list || [])
      .filter(r =>
        !q
          ? true
          : [r.name, r.email, r.phone]
              .some(v => String(v || "").toLowerCase().includes(q.toLowerCase()))
      )
      .filter(r => (roleFilter === "all" ? true : r.role === roleFilter));
  }

  function resetForm() {
    setEmail(""); setName(""); setPhone(""); setRole("tech"); setPassword(genTempPassword());
  }

  async function createTech(e) {
    e.preventDefault();
    setBanner(null); setOpenDetails(false);

    if (!isAdmin) {
      setBanner({ title: "Нет прав", text: "Только администратор может создавать сотрудников." });
      return;
    }

    const payload = {
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role,
      link_if_exists: true, // org_id не отправляем
    };

    setLoading(true);
    try {
      // 1) invoke
      const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });

      if (error || data?.error || data?.warning) {
        // 2) raw fetch — показать JSON
        const raw = await rawCallFunction("admin-create-user", payload);
        setBanner({
          title: raw.ok ? "Сотрудник создан" : "Не удалось создать сотрудника",
          text:  raw.ok ? "Учётка зарегистрирована/привязана." : "Edge-функция вернула ошибку.",
          details: { status: raw.status, ...raw.json },
        });
        if (!raw.ok) return;
      } else {
        setBanner({
          title: "Сотрудник создан",
          text: "Передайте e-mail и временный пароль.",
          details: data,
        });
      }

      resetForm();
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(emailAddr) {
    setBanner(null); setOpenDetails(false);

    const inv = await supabase.functions.invoke("admin-create-user", {
      body: { action: "sendPasswordReset", email: emailAddr },
    });

    if (inv.error || inv.data?.error) {
      const raw = await rawCallFunction("admin-create-user", { action: "sendPasswordReset", email: emailAddr });
      setBanner({
        title: raw.ok ? "Ссылка на сброс готова" : "Сброс не выполнен",
        text:  raw.ok ? "Письмо отправлено либо ссылка сгенерирована." : "Edge-функция вернула ошибку.",
        details: { status: raw.status, ...raw.json },
      });
      return;
    }

    setBanner({
      title: "Ссылка на сброс готова",
      text: "Письмо отправлено либо ссылка сгенерирована.",
      details: inv.data,
    });
  }

  const disableSubmit = loading || !email.trim() || !name.trim() || !password;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Техники / Сотрудники</h1>

      {/* баннер */}
      {banner && (
        <Banner
          title={banner.title}
          text={banner.text}
          details={banner.details}
          open={openDetails}
          onToggle={() => setOpenDetails(v => !v)}
        />
      )}

      {/* форма */}
      <form onSubmit={createTech} className="border rounded p-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div>
            <label className={label}>E-mail *</label>
            <input className={input} type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={label}>Телефон</label>
            <input className={input} value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <label className={label}>Имя / ФИО *</label>
            <input className={input} required value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className={label}>Роль *</label>
            <select className={select} value={role} onChange={e => setRole(e.target.value)}>
              <option value="tech">Техник</option>
              <option value="manager">Менеджер</option>
              <option value="admin">Админ</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className={label}>Временный пароль *</label>
            <div className="flex gap-2">
              <input className={input} required value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" className={btn} onClick={() => setPassword(genTempPassword())}>
                Сгенерировать
              </button>
            </div>
            <div className="text-[12px] text-gray-500 mt-1">
              Выдай сотруднику этот пароль для первого входа.
            </div>
          </div>

          <div className="md:col-span-1 flex items-end gap-2">
            <button disabled={disableSubmit} className={btn} type="submit">
              {loading ? "Создаю..." : "Создать"}
            </button>
            <button type="button" className={btn} disabled={loading} onClick={resetForm}>
              Очистить
            </button>
          </div>
        </div>
      </form>

      {/* панель фильтров */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
        <input
          className={input}
          placeholder="Поиск (имя, email, телефон)"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <select className={select} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">Все роли</option>
          <option value="admin">Админ</option>
          <option value="manager">Менеджер</option>
          <option value="tech">Техник</option>
        </select>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={fetchTechnicians}>Обновить список</button>
        </div>
      </div>

      {/* таблица */}
      <div className="overflow-x-auto">
        <table className={table}>
          <thead>
            <tr>
              <th className={th}>Имя</th>
              <th className={th}>E-mail</th>
              <th className={th}>Телефон</th>
              <th className={th}>Роль</th>
              <th className={th}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows().map((row) => (
              <tr key={row.id}>
                <td className={td}>{row.name}</td>
                <td className={td}>{row.email || "—"}</td>
                <td className={td}>{row.phone || "—"}</td>
                <td className={td}>{row.role}</td>
                <td className={td}>
                  <button
                    className={btn}
                    onClick={() => row.email && sendReset(row.email)}
                    disabled={!row.email}
                    title={!row.email ? "У сотрудника нет email" : "Отправить/сгенерировать ссылку на сброс"}
                  >
                    Сброс пароля
                  </button>
                </td>
              </tr>
            ))}
            {filteredRows().length === 0 && (
              <tr>
                <td className={td} colSpan={5}>Нет сотрудников</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
