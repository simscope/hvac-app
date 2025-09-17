// src/pages/AdminTechniciansPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function callEdge(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data; try { data = await res.json(); } catch { data = { raw: await res.text() }; }
  return { ok: res.ok, status: res.status, data };
}

function Banner({ title, text, details }) {
  const [open, setOpen] = useState(false);
  if (!title && !text) return null;
  return (
    <div style={{ border: "1px solid #d0d7de", borderRadius: 4, padding: 8, background: "#fff", margin: "12px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <b>{title}</b>
        {details && <button type="button" className="btn" onClick={() => setOpen(v => !v)}>{open ? "Скрыть детали" : "Показать детали"}</button>}
      </div>
      {text && <div style={{ marginTop: 4 }}>{text}</div>}
      {open && details && <pre style={{ background: "#fff", border: "1px solid #eee", padding: 8, borderRadius: 3, overflow: "auto", maxHeight: 280 }}>{JSON.stringify(details, null, 2)}</pre>}
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
  const [fireNote, setFireNote] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");     // admin | manager | technician | all
  const [activeFilter, setActiveFilter] = useState("only"); // only | inactive | all

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

        // если у тебя есть колонка technicians.auth_user_id — оставь, иначе можно убрать этот запрос
        const t = await supabase.from("technicians").select("role, is_admin").eq("auth_user_id", user.id).maybeSingle();
        setMeTechInfo(t.data || null);
      }
      await fetchTechnicians();
    })();
  }, []);

  async function fetchTechnicians() {
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, role, auth_user_id, email, is_active, terminated_at, termination_reason")
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
        !q ? true : [r.name, r.email, r.phone].some(v => String(v || "").toLowerCase().includes(q.toLowerCase()))
      )
      .filter(r => {
        if (roleFilter === "all") return true;
        const roleNorm = r.role === "tech" ? "technician" : r.role;
        return roleNorm === roleFilter;
      })
      .filter(r => {
        if (activeFilter === "all") return true;
        if (activeFilter === "only") return r.is_active !== false;
        if (activeFilter === "inactive") return r.is_active === false;
        return true;
      });
  }

  function resetForm() {
    setEmail(""); setPhone(""); setName(""); setRole("technician");
    setCreateAuth(true); setPassword(genTempPassword());
  }

  async function onCreate(e) {
    e.preventDefault(); setBanner(null);
    if (!isAdmin) { setBanner({ title: "Нет доступа", text: "Только администратор может создавать сотрудников." }); return; }

    const payload = {
      action: "ensure",
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role: role === "tech" ? "technician" : role,
      createAuth,
      link_if_exists: true,
    };

    setLoading(true);
    try {
      const { ok, status, data } = await callEdge("admin-ensure-user", payload);
      if (!ok || data?.error || data?.warning) {
        setBanner({ title: "Создание не выполнено", text: data?.error || "Edge-функция вернула ошибку.", details: { status, ...data } });
        return;
      }
      setBanner({ title: "Сотрудник создан", text: createAuth ? "Учётка Auth создана/привязана, запись в technicians добавлена." : "Добавлена запись в technicians.", details: data });
      resetForm(); await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally { setLoading(false); }
  }

  // ——— НОВОЕ: мягкое увольнение (soft) + удаление учётки
  async function onFire(row) {
    if (!isAdmin) { setBanner({ title: "Нет доступа", text: "Только администратор может увольнять сотрудников." }); return; }
    if (!row?.id) return;
    const ok = window.confirm(
      `Уволить "${row.name}"?\n` +
      `Будет: is_active=false, удалим из всех чатов. Также можно удалить учётку в Auth.`
    );
    if (!ok) return;

    setLoading(true); setBanner(null);
    try {
      // 1) soft-delete техника (RPC из БД)
      const rpc = await supabase.rpc("deactivate_technician", { p_tech_id: row.id, p_reason: fireNote || null });
      if (rpc.error) { setBanner({ title: "Ошибка увольнения", text: rpc.error.message }); return; }

      // 2) удалить учётку в Auth (через edge, если есть auth_user_id)
      if (row.auth_user_id) {
        const { ok: eok, status, data } = await callEdge("staff-terminate", {
          tech_id: row.id, auth_user_id: row.auth_user_id, reason: fireNote || null
        });
        if (!eok || data?.error) {
          setBanner({ title: "Учётка не удалена (Auth)", text: data?.error || "Edge-функция вернула ошибку.", details: { status, ...data } });
        } else {
          setBanner({ title: "Сотрудник уволен", text: `Пользователь "${row.name}" помечен неактивным и удалён из Auth.`, details: data });
        }
      } else {
        setBanner({ title: "Сотрудник уволен", text: `Пользователь "${row.name}" помечен неактивным.` });
      }
      setFireNote("");
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally { setLoading(false); }
  }

  // ——— по запросу: удалить только учётку Auth (без увольнения)
  async function onDeleteAuth(row) {
    if (!isAdmin) { setBanner({ title: "Нет доступа", text: "Только администратор." }); return; }
    if (!row?.auth_user_id) { setBanner({ title: "Нет учётки", text: "У этого сотрудника нет связанной Auth-учётки." }); return; }
    if (!window.confirm(`Удалить учётку Auth у "${row.name}"?`)) return;

    setLoading(true); setBanner(null);
    try {
      const { ok, status, data } = await callEdge("staff-terminate", { tech_id: row.id, auth_user_id: row.auth_user_id, reason: "manual delete auth" });
      if (!ok || data?.error) {
        setBanner({ title: "Ошибка удаления Auth", text: data?.error || "Edge-функция вернула ошибку.", details: { status, ...data } });
        return;
      }
      setBanner({ title: "Auth-учётка удалена", text: `У "${row.name}" больше нет доступа.` });
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally { setLoading(false); }
  }

  // ——— оставляем на всякий пожарный «Удалить полностью» (hard-delete)
  async function onHardDelete(row) {
    if (!isAdmin) { setBanner({ title: "Нет доступа", text: "Только администратор." }); return; }
    if (!row?.id) return;
    const ok = window.confirm(
      `ОПАСНО: Полностью удалить "${row.name}" из technicians?\n` +
      `История может потерять ссылки. Рекомендуется использовать «Уволить».`
    );
    if (!ok) return;

    setLoading(true); setBanner(null);
    try {
      // твоя существующая edge-функция, если она умеет hard-delete; либо сделай RPC remove_technician
      const { ok: edgeOk, status, data } = await callEdge("admin-ensure-user", {
        action: "delete_hard",
        technician_id: row.id,
        alsoDeleteAuth: true,
      });
      if (!edgeOk || data?.error) {
        setBanner({ title: "Ошибка удаления", text: data?.error || "Edge-функция вернула ошибку.", details: { status, ...data } });
        return;
      }
      setBanner({ title: "Удалено", text: `Сотрудник "${row.name}" удалён полностью.`, details: data });
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally { setLoading(false); }
  }

  const disableSubmit = loading || !name.trim() || (createAuth && (!email.trim() || !password));

  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto", padding: 16, font: "14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif", color: "#111" }}>
      <style>{`
        .input,.select,.btn{height:28px;border:1px solid #cfd4d9;border-radius:3px;background:#fff;padding:0 8px;font-size:14px;line-height:26px;box-sizing:border-box}
        .btn{cursor:pointer}.btn:hover{background:#f7f7f7}
        .btn-sm{height:22px;padding:0 6px;font-size:12px;line-height:20px}
        .btn-icon{height:22px;width:22px;padding:0;line-height:20px;text-align:center}
        .badge{display:inline-block;border:1px solid #e0e5ea;border-radius:999px;padding:0 8px;font-size:12px;background:#f7f8fa;color:#555}
        .table{width:100%;border-collapse:collapse;font-size:14px}
        .table th,.table td{border:1px solid #e0e5ea;padding:6px 8px;vertical-align:top}
        .table th{background:#f6f7f9;text-align:left}
        .row-inline{display:flex;gap:8px;align-items:center}
      `}</style>

      <h1 style={{ fontSize: 28, margin: "0 0 12px 0", fontWeight: 700 }}>Техники / Сотрудники</h1>

      {banner && <Banner title={banner.title} text={banner.text} details={banner.details} />}

      <div className="two-cols" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* левая колонка — создание */}
        <div className="col-left" style={{ flex: "0 0 420px", maxWidth: 420 }}>
          {/* ... (форма создания — без изменений, как у тебя) */}
          {/* ОПУЩЕНО ДЛЯ КРАТКОСТИ: оставь свою текущую форму onCreate */}
        </div>

        {/* правая колонка — список */}
        <div className="col-right" style={{ flex: 1, minWidth: 0 }}>
          <div className="row-inline" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Поиск (имя, email, телефон)" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="all">Все роли</option>
              <option value="admin">Админ</option>
              <option value="manager">Менеджер</option>
              <option value="technician">Техник</option>
            </select>
            <select className="select" value={activeFilter} onChange={e => setActiveFilter(e.target.value)}>
              <option value="only">Только активные</option>
              <option value="inactive">Только неактивные</option>
              <option value="all">Все</option>
            </select>
            <button className="btn" onClick={fetchTechnicians}>Обновить список</button>
          </div>

          <div className="row-inline" style={{ marginBottom: 8 }}>
            <input className="input" placeholder="Причина увольнения (опционально)" value={fireNote} onChange={e => setFireNote(e.target.value)} style={{ flex: 1 }} />
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>E-mail</th>
                <th>Телефон</th>
                <th>Роль</th>
                <th style={{ width: 280 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows().map((row) => (
                <tr key={row.id} style={{ opacity: row.is_active === false ? 0.6 : 1 }}>
                  <td>
                    {row.name}{" "}
                    {row.is_active === false && <span className="badge">неактивен</span>}
                  </td>
                  <td>{row.email || "—"}</td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.role === "tech" ? "technician" : row.role}</td>
                  <td className="row-inline" style={{ flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => onFire(row)} title="Пометить неактивным и удалить учётку Auth">
                      Уволить
                    </button>
                    <button className="btn" onClick={() => onDeleteAuth(row)} title="Удалить учётку Auth (без увольнения)">
                      Удалить учётку
                    </button>
                    <button className="btn" onClick={() => onHardDelete(row)} title="ОПАСНО: Полностью удалить запись из technicians">
                      Удалить полностью
                    </button>
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
