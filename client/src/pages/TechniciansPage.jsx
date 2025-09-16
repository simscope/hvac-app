// Простая админ-страница сотрудников.
// Создаёт техников (с/без учётки Auth), показывает список, удаляет (в т.ч. учётку Auth).
import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function callEdge(path, body) {
  // Надёжный вызов через fetch (на случай, если functions.invoke вернёт редкую ошибку)
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
  return { ok: res.ok, status: res.status, data: json };
}

function Banner({ title, text, details }) {
  const [open, setOpen] = useState(false);
  if (!title && !text) return null;
  return (
    <div style={{ border: "1px solid #d0d7de", borderRadius: 4, padding: 8, background: "#fff", margin: "12px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <b>{title}</b>
        {details && (
          <button type="button" className="btn" onClick={() => setOpen(v => !v)}>
            {open ? "Скрыть детали" : "Показать детали"}
          </button>
        )}
      </div>
      {text && <div style={{ marginTop: 4 }}>{text}</div>}
      {open && details && (
        <pre style={{ background: "#fff", border: "1px solid #eee", padding: 8, borderRadius: 3, overflow: "auto", maxHeight: 280 }}>
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
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
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("technician"); // admin | manager | technician
  const [createAuth, setCreateAuth] = useState(true);
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
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);

      if (user) {
        const p = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        setMeProfileRole(p.data?.role ?? null);

        const t = await supabase.from("technicians").select("role, is_admin").eq("auth_user_id", user.id).maybeSingle();
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

    if (error) {
      setBanner({ title: "Ошибка загрузки", text: error.message });
      setList([]);
      return;
    }
    setList(data || []);
  }

  function filteredRows() {
    return (list || [])
      .filter(r => !q ? true : [r.name, r.email, r.phone].some(v => String(v || "").toLowerCase().includes(q.toLowerCase())))
      .filter(r => (roleFilter === "all" ? true : r.role === roleFilter || (roleFilter === "technician" && r.role === "tech")));
  }

  function resetForm() {
    setEmail("");
    setPhone("");
    setName("");
    setRole("technician");
    setCreateAuth(true);
    setPassword(genTempPassword());
  }

  async function onCreate(e) {
    e.preventDefault();
    setBanner(null);

    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор может создавать сотрудников." });
      return;
    }

    const payload = {
      action: "ensure",
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role: role === "tech" ? "technician" : role, // унифицируем
      createAuth,
      link_if_exists: true,
    };

    setLoading(true);
    try {
      const { ok, status, data } = await callEdge("admin-ensure-user", payload);

      if (!ok || data?.error || data?.warning) {
        setBanner({
          title: "Создание не выполнено",
          text: data?.error || "Edge-функция вернула ошибку.",
          details: { status, ...data },
        });
        return;
      }

      setBanner({
        title: "Сотрудник создан",
        text: createAuth ? "Учётка Auth создана/привязана, запись в technicians добавлена." : "Добавлена запись в technicians.",
        details: data,
      });
      resetForm();
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  async function deleteTech(row, alsoDeleteAuth = true) {
    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор может удалять сотрудников." });
      return;
    }
    if (!row?.id) return;

    const ok = window.confirm(
      `Удалить сотрудника "${row.name}"?\n` +
      (alsoDeleteAuth ? "Также будет удалена учётка Auth (если привязана)." : "Учётка Auth не будет удалена.")
    );
    if (!ok) return;

    setLoading(true);
    setBanner(null);

    try {
      const { ok, status, data } = await callEdge("admin-ensure-user", {
        action: "delete",
        technician_id: row.id,         // ключ, который функция теперь точно понимает
        alsoDeleteAuth: !!alsoDeleteAuth,
      });

      if (!ok || data?.error) {
        setBanner({ title: "Ошибка удаления", text: data?.error || "Edge-функция вернула ошибку.", details: { status, ...data } });
        return;
      }

      setBanner({ title: "Удалено", text: `Сотрудник "${row.name}" удалён.`, details: data });
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  const disableSubmit = loading || !name.trim() || (createAuth && (!email.trim() || !password));

  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto", padding: 16, font: "14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif", color: "#111" }}>
      <style>{`
        .input,.select,.btn{
          height:28px;border:1px solid #cfd4d9;border-radius:3px;background:#fff;
          padding:0 8px;font-size:14px;line-height:26px; box-sizing:border-box;
        }
        .btn{cursor:pointer}
        .btn:hover{background:#f7f7f7}
        .table{width:100%;border-collapse:collapse;font-size:14px}
        .table th,.table td{border:1px solid #e0e5ea;padding:6px 8px;vertical-align:top}
        .table th{background:#f6f7f9;text-align:left}
        .row-inline{display:flex;gap:8px;align-items:center}
      `}</style>

      <h1 style={{ fontSize: 28, margin: "0 0 12px 0", fontWeight: 700 }}>Техники / Сотрудники</h1>

      {banner && <Banner title={banner.title} text={banner.text} details={banner.details} />}

      <div className="two-cols" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div className="col-left" style={{ flex: "0 0 420px", maxWidth: 420 }}>
          <form onSubmit={onCreate}>
            <table className="table" style={{ marginBottom: 12, tableLayout: "fixed" }}>
              <thead>
                <tr><th colSpan={2}>Создание сотрудника</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ width: 140 }}>E-mail {createAuth && "*"}</td>
                  <td><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!createAuth} /></td>
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
                      <option value="technician">Техник</option>
                      <option value="manager">Менеджер</option>
                      <option value="admin">Админ</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td>Создавать учётку Auth</td>
                  <td className="row-inline">
                    <input type="checkbox" checked={createAuth} onChange={e => setCreateAuth(e.target.checked)} />
                    <span style={{ color: "#687076" }}>Отключи, если нужна только строка в technicians.</span>
                  </td>
                </tr>
                <tr>
                  <td>Временный пароль {createAuth && "*"}</td>
                  <td className="row-inline">
                    <input className="input" type="text" value={password} onChange={e => setPassword(e.target.value)} disabled={!createAuth} />
                    <button type="button" className="btn" onClick={() => setPassword(genTempPassword())}>Сгенерировать</button>
                  </td>
                </tr>
                <tr>
                  <td />
                  <td className="row-inline">
                    <button className="btn" disabled={disableSubmit} type="submit">{loading ? "Создаю..." : "Создать"}</button>
                    <button type="button" className="btn" disabled={loading} onClick={resetForm}>Очистить</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </form>
        </div>

        <div className="col-right" style={{ flex: 1, minWidth: 0 }}>
          <div className="row-inline" style={{ marginBottom: 8 }}>
            <input className="input" placeholder="Поиск (имя, email, телефон)" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="all">Все роли</option>
              <option value="admin">Админ</option>
              <option value="manager">Менеджер</option>
              <option value="technician">Техник</option>
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
                    <button className="btn" onClick={() => deleteTech(row, false)}>Удалить</button>
                    <button className="btn" onClick={() => deleteTech(row, true)} title="Удалить запись и учётку Auth">Удалить (полностью)</button>
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
