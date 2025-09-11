// client/src/pages/TechniciansPage.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";

const roleOptions = [
  { value: "admin", label: "Админ" },
  { value: "manager", label: "Менеджер" },
  { value: "tech", label: "Техник" },
];

const th = { padding: "8px 10px", borderBottom: "1px solid #e5e7eb", textAlign: "left", fontWeight: 600 };
const td = { padding: "6px 10px", borderBottom: "1px solid #f1f5f9" };
const inputStyle = { width: "100%", padding: 6, border: "1px solid #e5e7eb", borderRadius: 6 };

export default function TechniciansPage() {
  const { role, loading: authLoading } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newRow, setNewRow] = useState({ name: "", phone: "", email: "", role: "tech" });

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, email, role, auth_user_id")
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      alert("Ошибка загрузки сотрудников");
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }

  const onChangeCell = (id, field, value) => {
    setItems(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  async function saveRow(row) {
    const payload = {
      name: row.name?.trim() || null,
      phone: row.phone?.trim() || null,
      email: row.email?.trim() || null,
      role: row.role?.trim().toLowerCase() || "tech",
    };
    const { error } = await supabase.from("technicians").update(payload).eq("id", row.id);
    if (error) {
      console.error(error);
      alert("Ошибка при сохранении");
      return;
    }
    await load();
  }

  async function addRow() {
    if (!newRow.name?.trim()) {
      alert("Введите имя");
      return;
    }
    const payload = {
      name: newRow.name.trim(),
      phone: newRow.phone?.trim() || null,
      email: newRow.email?.trim() || null,
      role: (newRow.role || "tech").toLowerCase().trim(),
    };
    const { error } = await supabase.from("technicians").insert(payload);
    if (error) {
      console.error(error);
      alert("Ошибка при добавлении");
      return;
    }
    setNewRow({ name: "", phone: "", email: "", role: "tech" });
    await load();
  }

  async function removeRow(id) {
    if (!window.confirm("Удалить сотрудника?")) return;
    const { error } = await supabase.from("technicians").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Ошибка при удалении");
      return;
    }
    setItems(prev => prev.filter(r => r.id !== id));
  }

  // --- ВЫЗОВ Edge-функции admin-create-user ---
  async function createAccount(row) {
    const email = (row.email || "").trim();
    if (!email) return alert("У сотрудника пустой Email");
    const password = prompt("Задай временный пароль (минимум 6 символов):", "");
    if (!password) return;

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({
          email,
          password,
          role: (row.role || "tech").toLowerCase(),
          technician_id: row.id,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Ошибка функции");
      alert("Аккаунт создан/привязан");
      await load();
    } catch (e) {
      console.error(e);
      alert("Не удалось создать аккаунт: " + e.message);
    }
  }

  // --- Сброс пароля (Edge-функция admin-reset-password) ---
  async function resetPassword(row) {
    if (!row.auth_user_id) return alert("У сотрудника ещё нет аккаунта");
    const newPass = prompt("Новый пароль:", "");
    if (!newPass) return;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ user_id: row.auth_user_id, new_password: newPass }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Ошибка функции");
      alert("Пароль обновлён");
    } catch (e) {
      console.error(e);
      alert("Не удалось обновить пароль: " + e.message);
    }
  }

  if (authLoading) return <div className="p-4">Загрузка…</div>;
  if (role !== "admin") return <div className="p-6">Нет прав доступа.</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">👥 Сотрудники</h1>

      {/* Форма добавления */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 2fr 1.2fr auto", gap: 8, marginBottom: 12 }}>
        <input style={inputStyle} placeholder="Имя" value={newRow.name}
               onChange={e => setNewRow({ ...newRow, name: e.target.value })} />
        <input style={inputStyle} placeholder="Телефон" value={newRow.phone}
               onChange={e => setNewRow({ ...newRow, phone: e.target.value })} />
        <input style={inputStyle} placeholder="Email" value={newRow.email}
               onChange={e => setNewRow({ ...newRow, email: e.target.value })} />
        <select style={inputStyle} value={newRow.role}
                onChange={e => setNewRow({ ...newRow, role: e.target.value })}>
          {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={addRow} style={{ padding: "6px 12px" }}>➕ Добавить</button>
      </div>

      <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8fafc" }}>
            <tr>
              <th style={th} width="40">#</th>
              <th style={th}>Имя</th>
              <th style={th} width="180">Телефон</th>
              <th style={th} width="260">Email</th>
              <th style={th} width="160">Должность</th>
              <th style={{ ...th, textAlign: "center" }} width="340">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={6}>Загрузка…</td></tr>}
            {!loading && items.length === 0 && <tr><td style={td} colSpan={6}>Сотрудников пока нет</td></tr>}
            {items.map((row, idx) => (
              <tr key={row.id}>
                <td style={td}>{idx + 1}</td>
                <td style={td}>
                  <input style={inputStyle} value={row.name || ""}
                         onChange={e => onChangeCell(row.id, "name", e.target.value)} />
                </td>
                <td style={td}>
                  <input style={inputStyle} value={row.phone || ""}
                         onChange={e => onChangeCell(row.id, "phone", e.target.value)} />
                </td>
                <td style={td}>
                  <input style={inputStyle} value={row.email || ""}
                         onChange={e => onChangeCell(row.id, "email", e.target.value)} />
                </td>
                <td style={td}>
                  <select style={inputStyle}
                          value={(row.role || "tech").toLowerCase()}
                          onChange={e => onChangeCell(row.id, "role", e.target.value)}>
                    {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                  <button title="Сохранить" onClick={() => saveRow(row)} style={{ marginRight: 8 }}>💾 Сохранить</button>
                  <button title="Создать аккаунт" onClick={() => createAccount(row)} style={{ marginRight: 8 }}>
                    👤 Создать аккаунт
                  </button>
                  <button title="Сбросить пароль" onClick={() => resetPassword(row)} style={{ marginRight: 8 }}>
                    🔑 Сбросить пароль
                  </button>
                  <button title="Удалить" onClick={() => removeRow(row.id)}>🗑️ Удалить</button>
                  {row.auth_user_id && <span style={{ marginLeft: 10, opacity: 0.6 }}>UID: {row.auth_user_id.slice(0, 8)}…</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
