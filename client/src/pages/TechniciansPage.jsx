// src/pages/AdminTechniciansPage.jsx
// Чистый CSS внутри компонента (без Tailwind).
// Страница "Техники / Сотрудники" в стиле твоих страниц: тонкие бордеры,
// маленькие контролы, таблица формы и таблица списка.
// Edge Function: если invoke => FunctionsHttpError, делаем raw fetch и показываем JSON (status, stage, error, details).

import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

// ---------- Утилиты ----------
function genTempPassword(len = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

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

// ---------- Блок уведомления ----------
function Banner({ title, text, details }) {
  const [open, setOpen] = useState(false);
  if (!title && !text) return null;
  return (
    <div className="banner">
      <div className="banner-head">
        <b>{title}</b>
        {details && (
          <button type="button" className="btn" onClick={() => setOpen(v => !v)}>
            {open ? "Скрыть детали" : "Показать детали"}
          </button>
        )}
      </div>
      {text && <div className="mt4">{text}</div>}
      {open && details && (
        <pre className="pre">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------- Страница ----------
export default function AdminTechniciansPage() {
  // Auth
  const [me, setMe] = useState(null);
  const [meProfileRole, setMeProfileRole] = useState(null);
  const [meTechInfo, setMeTechInfo] = useState(null);

  // Data
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("tech");
  const [password, setPassword] = useState(genTempPassword());

  // UI
  const [banner, setBanner] = useState(null); // {title, text, details}

  // filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me?.app_metadata?.role === "admin") return true;
    if (meProfileRole === "admin") return true;
    if (meTechInfo?.role === "admin" || meTechInfo?.is_admin) return true;
    return false;
  }, [me, meProfileRole, meTechInfo]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);

      if (user) {
        const p = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        setMeProfileRole(p.data?.role ?? null);

        const t = await supabase
          .from("technicians")
          .select("role, is_admin")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        setMeTechInfo(t.data || null);
      }
      await fetchTechnicians();
    })();
  }, []);

  async function fetchTechnicians() {
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, role, auth_user_id, email")
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
    setEmail("");
    setName("");
    setPhone("");
    setRole("tech");
    setPassword(genTempPassword());
  }

  async function createTech(e) {
    e.preventDefault();
    setBanner(null);

    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор может создавать сотрудников." });
      return;
    }

    const payload = {
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role,
      link_if_exists: true, // org_id не используем
    };

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });

      if (error || data?.error || data?.warning) {
        const raw = await rawCallFunction("admin-create-user", payload);
        setBanner({
          title: raw.ok ? "Сотрудник создан" : "Создание не выполнено",
          text: raw.ok
            ? "Учётка зарегистрирована/привязана."
            : "Edge-функция вернула ошибку.",
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
    setBanner(null);
    const inv = await supabase.functions.invoke("admin-create-user", {
      body: { action: "sendPasswordReset", email: emailAddr },
    });

    if (inv.error || inv.data?.error) {
      const raw = await rawCallFunction("admin-create-user", {
        action: "sendPasswordReset",
        email: emailAddr,
      });
      setBanner({
        title: raw.ok ? "Ссылка на сброс готова" : "Сброс не выполнен",
        text: raw.ok
          ? "Письмо отправлено либо ссылка сгенерирована."
          : "Edge-функция вернула ошибку.",
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
    <div className="page">
      {/* локальные стили — аккуратные, под твой стиль */}
      <style>{`
        .page{max-width:1100px;margin:0 auto;padding:16px;font:14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;}
        h1{font-size:28px;margin:0 0 12px 0;font-weight:700}
        .toolbar{display:flex;gap:8px;align-items:center;margin:8px 0 12px 0}
        .input,.select,.btn{
          height:28px;border:1px solid #cfd4d9;border-radius:3px;background:#fff;
          padding:0 8px;font-size:14px;line-height:26px;
        }
        .btn{cursor:pointer}
        .btn:hover{background:#f7f7f7}
        .table{width:100%;border-collapse:collapse;font-size:14px}
        .table th,.table td{border:1px solid #e0e5ea;padding:6px 8px;vertical-align:top}
        .table th{background:#f6f7f9;text-align:left}
        .muted{color:#687076}
        .banner{border:1px solid #d0d7de;border-radius:4px;padding:8px;background:#fff;margin:12px 0}
        .banner-head{display:flex;gap:8px;align-items:center}
        .mt4{margin-top:4px}
        .pre{background:#fff;border:1px solid #eee;padding:8px;border-radius:3px;overflow:auto;max-height:280px}
        .two-cols{display:grid;grid-template-columns:260px 1fr;gap:16px}
        @media (max-width:900px){.two-cols{display:block}}
      `}</style>

      <h1>Техники / Сотрудники</h1>

      {banner && (
        <Banner title={banner.title} text={banner.text} details={banner.details} />
      )}

      {/* Две колонки: слева — табличка формы, справа — список */}
      <div className="two-cols">
        {/* ФОРМА (в таблице) */}
        <form onSubmit={createTech}>
          <table className="table" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th colSpan={2}>Создание сотрудника</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ width: 140 }}>E-mail *</td>
                <td>
                  <input className="input" type="email" required value={email}
                         onChange={e => setEmail(e.target.value)} />
                </td>
              </tr>
              <tr>
                <td>Телефон</td>
                <td>
                  <input className="input" value={phone} onChange={e => setPhone(e.target.value)} />
                </td>
              </tr>
              <tr>
                <td>Имя / ФИО *</td>
                <td>
                  <input className="input" required value={name}
                         onChange={e => setName(e.target.value)} />
                </td>
              </tr>
              <tr>
                <td>Роль *</td>
                <td>
                  <select className="select" value={role} onChange={e => setRole(e.target.value)}>
                    <option value="tech">Техник</option>
                    <option value="manager">Менеджер</option>
                    <option value="admin">Админ</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td>Временный пароль *</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <input className="input" required value={password}
                         onChange={e => setPassword(e.target.value)} />
                  <button type="button" className="btn" onClick={() => setPassword(genTempPassword())}>
                    Сгенерировать
                  </button>
                </td>
              </tr>
              <tr>
                <td />
                <td className="muted">Выдай сотруднику этот пароль для первого входа.</td>
              </tr>
              <tr>
                <td />
                <td style={{ display: "flex", gap: 8 }}>
                  <button className="btn" disabled={disableSubmit} type="submit">
                    {loading ? "Создаю..." : "Создать сотрудника"}
                  </button>
                  <button type="button" className="btn" disabled={loading} onClick={resetForm}>
                    Очистить
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </form>

        {/* СПИСОК + ПАНЕЛЬ ФИЛЬТРОВ */}
        <div>
          <div className="toolbar">
            <input
              className="input"
              placeholder="Поиск (имя, email, телефон)"
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="all">Все роли</option>
              <option value="admin">Админ</option>
              <option value="manager">Менеджер</option>
              <option value="tech">Техник</option>
            </select>
            <button className="btn" onClick={fetchTechnicians}>Обновить список</button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>E-mail</th>
                <th>Телефон</th>
                <th>Роль</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows().map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.email || "—"}</td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.role}</td>
                  <td>
                    <button
                      className="btn"
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
                  <td colSpan={5}>Нет сотрудников</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
