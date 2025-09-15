// src/pages/AdminTechniciansPage.jsx
// Упрощённая версия: нет статуса (актив/уволен), нет "Сброс пароля", нет "Уволить/Вернуть".
// Остались: создание сотрудника, поиск, фильтр по роли, обновление списка, удаление из базы (для админа).

import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

// ---------- utils ----------
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
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

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
      {open && details && <pre className="pre">{JSON.stringify(details, null, 2)}</pre>}
    </div>
  );
}

export default function AdminTechniciansPage() {
  const [me, setMe] = useState(null);
  const [meProfileRole, setMeProfileRole] = useState(null);
  const [meTechInfo, setMeTechInfo] = useState(null);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("tech");
  const [password, setPassword] = useState(genTempPassword());

  // ui
  const [banner, setBanner] = useState(null);

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
      const { data: { user} } = await supabase.auth.getUser();
      setMe(user || null);

      if (user) {
        const p = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
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
      .select("id, name, phone, role, auth_user_id, email") // без is_active
      .order("name", { ascending: true });

    if (error) {
      setBanner({ title: "Ошибка загрузки", text: error.message });
      setList([]);
      return;
    }
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
      link_if_exists: true,
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
        setBanner({ title: "Сотрудник создан", text: "Передайте e-mail и временный пароль.", details: data });
      }

      resetForm();
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  // ----- ЖЁСТКОЕ УДАЛЕНИЕ -----
  async function deleteTech(row) {
    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор может удалять сотрудников." });
      return;
    }
    if (!row?.id) return;

    const ok = window.confirm(
      `Удалить сотрудника "${row.name}" из базы?\n` +
      `Действие необратимо.`
    );
    if (!ok) return;

    setLoading(true);
    setBanner(null);

    try {
      // (опционально) удаляем из Auth — если хочешь оставить, закомментируй этот блок
      if (row.auth_user_id) {
        try {
          await supabase.functions.invoke("admin-create-user", {
            body: { action: "deleteAuthUser", user_id: row.auth_user_id, softUnlinkTech: true }
          });
        } catch (e) {
          // не блокируем удаление строки
          setBanner({ title: "Внимание", text: "Auth-пользователь не удалён, но запись в базе будет удалена.", details: { err: String(e) } });
        }
      }

      // удаляем строку из technicians
      const { error: delErr } = await supabase.from("technicians").delete().eq("id", row.id);
      if (delErr) {
        setBanner({ title: "Ошибка удаления", text: delErr.message });
        return;
      }

      setBanner({ title: "Удалено", text: `Сотрудник "${row.name}" удалён из базы.` });
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  const disableSubmit = loading || !email.trim() || !name.trim() || !password;

  return (
    <div className="page">
      <style>{`
        .page{max-width:1100px;margin:0 auto;padding:16px;font:14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;}
        h1{font-size:28px;margin:0 0 12px 0;font-weight:700}
        .input,.select,.btn{
          height:28px;border:1px solid #cfd4d9;border-radius:3px;background:#fff;
          padding:0 8px;font-size:14px;line-height:26px; box-sizing:border-box;
        }
        .btn{cursor:pointer}
        .btn:hover{background:#f7f7f7}
        .btn-icon{width:28px;min-width:28px;padding:0;text-align:center}
        .table{width:100%;border-collapse:collapse;font-size:14px}
        .table th,.table td{border:1px solid #e0e5ea;padding:6px 8px;vertical-align:top}
        .table th{background:#f6f7f9;text-align:left}
        .muted{color:#687076}
        .banner{border:1px solid #d0d7de;border-radius:4px;padding:8px;background:#fff;margin:12px 0}
        .banner-head{display:flex;gap:8px;align-items:center}
        .mt4{margin-top:4px}
        .pre{background:#fff;border:1px solid #eee;padding:8px;border-radius:3px;overflow:auto;max-height:280px}

        .two-cols{display:flex;gap:20px;align-items:flex-start}
        .col-left{flex:0 0 400px;max-width:400px}
        .col-right{flex:1;min-width:0}
        .col-left .table{table-layout:fixed}
        .col-left .table td:nth-child(1){width:140px}
        .col-left .table .input,.col-left .table .select{width:100%}
        .row-inline{display:flex;gap:8px;align-items:center}
        .row-inline .input{flex:1;min-width:140px}
        .dim{color:#8a8f98}
      `}</style>

      <h1>Техники / Сотрудники</h1>

      {banner && (
        <Banner title={banner.title} text={banner.text} details={banner.details} />
      )}

      <div className="two-cols">
        {/* Левая колонка — форма */}
        <div className="col-left">
          <form onSubmit={createTech}>
            <table className="table" style={{ marginBottom: 12 }}>
              <thead>
                <tr><th colSpan={2}>Создание сотрудника</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>E-mail *</td>
                  <td><input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></td>
                </tr>
                <tr>
                  <td>Телефон</td>
                  <td><input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></td>
                </tr>
                <tr>
                  <td>Имя / ФИО *</td>
                  <td><input className="input" required value={name} onChange={e => setName(e.target.value)} /></td>
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
                  <td>
                    <div className="row-inline">
                      <input
                        className="input"
                        type="text"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="Сгенерировать"
                        onClick={() => setPassword(genTempPassword())}
                        aria-label="Сгенерировать пароль"
                      >
                        ⟳
                      </button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td />
                  <td className="muted">Выдай сотруднику этот пароль для первого входа.</td>
                </tr>
                <tr>
                  <td />
                  <td className="row-inline">
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
        </div>

        {/* Правая колонка — фильтры + список */}
        <div className="col-right">
          <div className="row-inline" style={{ marginBottom: 8 }}>
            <input
              className="input"
              placeholder="Поиск (имя, email, телефон)"
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
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
                  <td className="row-inline">
                    {isAdmin && (
                      <button
                        className="btn"
                        onClick={() => deleteTech(row)}
                        title="Полностью удалить запись из базы"
                      >
                        Удалить из базы
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRows().length === 0 && (
                <tr><td colSpan={5}>Нет сотрудников</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
