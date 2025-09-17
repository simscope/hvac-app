// client/src/pages/AdminTechniciansPage.jsx
// Админ-страница техников: создание, список, активация/деактивация, удаление.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

/* ------------ UI helpers ------------ */
const PAGE  = { padding: 16, display: "grid", gap: 12 };
const CARD  = { border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 14 };
const ROW   = { display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" };
const INPUT = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" };
const BTN   = { padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#111827", color: "#fff" };
const BTN_LIGHT = { padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" };

export default function AdminTechniciansPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("active"); // active | inactive

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("technician"); // ВАЖНО: по умолчанию правильное значение
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadTechs(); }, []);

  async function loadTechs() {
    setLoading(true);
    // Берём все роли, но для совместимости: in(['technician','tech','manager','admin'])
    const { data, error } = await supabase
      .from("technicians")
      .select("id,name,phone,email,role,is_active,auth_user_id,org_id")
      .in("role", ["technician", "tech", "manager", "admin"])
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      setList([]);
    } else {
      setList(data || []);
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return (list || []).filter(t => (tab === "active" ? t.is_active : !t.is_active));
  }, [list, tab]);

  async function createTech(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const payload = {
        name: name?.trim() || "",
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        role: role || "technician",     // ← фикс роли
        is_active: true,
        org_id: 1,
      };
      if (!payload.name) throw new Error("Введите имя сотрудника");

      const { error } = await supabase.from("technicians").insert(payload);
      if (error) throw error;

      setName(""); setPhone(""); setEmail(""); setRole("technician");
      await loadTechs();
      alert("Техник создан");
    } catch (err) {
      console.error(err);
      alert(err.message || "Ошибка при создании");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(t) {
    try {
      const { error } = await supabase
        .from("technicians")
        .update({ is_active: !t.is_active })
        .eq("id", t.id);
      if (error) throw error;
      await loadTechs();
    } catch (err) {
      console.error(err);
      alert("Не удалось изменить активность");
    }
  }

  async function removeTech(t) {
    if (!window.confirm(`Удалить сотрудника «${t.name}» навсегда?`)) return;
    try {
      const { error } = await supabase.from("technicians").delete().eq("id", t.id);
      if (error) throw error;
      await loadTechs();
    } catch (err) {
      console.error(err);
      alert("Не удалось удалить");
    }
  }

  return (
    <div style={PAGE}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Сотрудники</h2>

      {/* Создание техника */}
      <form onSubmit={createTech} style={CARD}>
        <h3 style={{ marginTop: 0 }}>Создать сотрудника</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={ROW}>
            <label>Имя</label>
            <input style={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Andrei S" />
          </div>
          <div style={ROW}>
            <label>Телефон</label>
            <input style={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="929..." />
          </div>
          <div style={ROW}>
            <label>Email</label>
            <input style={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tech@example.com" />
          </div>
          <div style={ROW}>
            <label>Роль</label>
            <select style={INPUT} value={role} onChange={(e) => setRole(e.target.value)}>
              {/* ВАЖНО: основная рабочая роль — technician */}
              <option value="technician">technician</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
              {/* поддержка старого значения, если где-то в базе осталось */}
              <option value="tech">tech (legacy)</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" style={BTN} disabled={creating}>
              {creating ? "Создаю…" : "Создать"}
            </button>
            <button type="button" style={BTN_LIGHT} onClick={() => { setName(""); setPhone(""); setEmail(""); setRole("technician"); }}>
              Очистить
            </button>
          </div>
        </div>
      </form>

      {/* Таб-переключатель */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={{ ...BTN_LIGHT, background: tab === "active" ? "#eef2ff" : "#fff" }}
          onClick={() => setTab("active")}
        >
          Активные
        </button>
        <button
          style={{ ...BTN_LIGHT, background: tab === "inactive" ? "#eef2ff" : "#fff" }}
          onClick={() => setTab("inactive")}
        >
          Неактивные
        </button>
        <div style={{ marginLeft: "auto" }}>
          <button style={BTN_LIGHT} onClick={loadTechs} disabled={loading}>
            {loading ? "Обновляю…" : "Обновить"}
          </button>
        </div>
      </div>

      {/* Список */}
      <div style={CARD}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Имя</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Телефон</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Email</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Роль</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Статус</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>{t.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>{t.phone || "—"}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>{t.email || "—"}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>{t.role}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>
                  {t.is_active ? "Активен" : "Неактивен"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #e5e7eb", display: "flex", gap: 8 }}>
                  <button style={BTN_LIGHT} onClick={() => toggleActive(t)}>
                    {t.is_active ? "Сделать неактивным" : "Сделать активным"}
                  </button>
                  <button style={{ ...BTN_LIGHT, borderColor: "#ef4444", color: "#ef4444" }} onClick={() => removeTech(t)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 10 }}>Нет записей</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
