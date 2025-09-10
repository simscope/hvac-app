// client/src/pages/TechniciansPage.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";

// roles list
const ROLE_OPTIONS = [
  { value: "admin", label: "Админ" },
  { value: "manager", label: "Менеджер" },
  { value: "tech", label: "Техник" },
];

const inputStyle = {
  width: "100%",
  padding: 6,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
};

const th = {
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
  fontWeight: 600,
};

const td = {
  padding: "6px 10px",
  borderBottom: "1px solid #f1f5f9",
};

export default function TechniciansPage() {
  // только для спиннера: RequireRole пускает сюда только admin
  const { loading: authLoading } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newRow, setNewRow] = useState({
    name: "",
    phone: "",
    email: "",
    role: "tech",
  });

  useEffect(function () {
    if (!authLoading) {
      load();
    }
  }, [authLoading]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, email, role")
      .order("name", { ascending: true });

    if (error) {
      console.error("technicians select error:", error);
      alert("Ошибка загрузки сотрудников");
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }

  function onChangeCell(id, field, value) {
    setItems(function (prev) {
      return prev.map(function (r) {
        if (r.id === id) return { ...r, [field]: value };
        return r;
      });
    });
  }

  async function saveRow(row) {
    const payload = {
      name: row.name ? row.name.trim() : null,
      phone: row.phone ? row.phone.trim() : null,
      email: row.email ? row.email.trim() : null,
      role: row.role ? String(row.role).trim().toLowerCase() : null,
    };

    const { error } = await supabase
      .from("technicians")
      .update(payload)
      .eq("id", row.id);

    if (error) {
      console.error("technicians update error:", error);
      alert("Ошибка при сохранении");
      return;
    }
    await load();
  }

  async function addRow() {
    if (!newRow.name || newRow.name.trim() === "") {
      alert("Введите имя");
      return;
    }

    const payload = {
      name: newRow.name.trim(),
      phone: newRow.phone ? newRow.phone.trim() : null,
      email: newRow.email ? newRow.email.trim() : null,
      role: newRow.role ? newRow.role.toLowerCase().trim() : "tech",
    };

    const { error } = await supabase.from("technicians").insert(payload);

    if (error) {
      console.error("technicians insert error:", error);
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
      console.error("technicians delete error:", error);
      alert("Ошибка при удалении");
      return;
    }
    setItems(function (prev) {
      return prev.filter(function (r) {
        return r.id !== id;
      });
    });
  }

  // Вызов Edge function: создать аккаунт с паролем
  async function createAccount(row) {
    try {
      if (!row.email || row.email.trim() === "") {
        alert("У сотрудника не указан Email");
        return;
      }
      const body = {
        email: row.email.trim(),
        password: prompt(
          "Введите временный пароль для нового пользователя:",
          ""
        ),
        name: row.name || "",
        role: row.role || "tech",
        technicianId: row.id,
      };
      if (!body.password) {
        alert("Пароль не задан.");
        return;
      }

      const { data, error } = await supabase.functions.invoke(
        "admin-create-user",
        {
          body: body,
        }
      );

      if (error) {
        console.error(error);
        alert("Не удалось создать аккаунт: " + (error.message || "ошибка"));
        return;
      }

      if (data && data.ok) {
        alert("Аккаунт создан, auth_user_id записан.");
        await load();
      } else {
        alert("Ответ функции без ok=true");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка вызова функции admin-create-user");
    }
  }

  // Вызов Edge function: сброс пароля
  async function resetPassword(row) {
    try {
      const newPass = prompt(
        "Введите новый пароль для пользователя:",
        ""
      );
      if (!newPass) {
        alert("Пароль не задан.");
        return;
      }
      const body = { technicianId: row.id, newPassword: newPass };

      const { data, error } = await supabase.functions.invoke(
        "admin-reset-password",
        {
          body: body,
        }
      );

      if (error) {
        console.error(error);
        alert("Не удалось сбросить пароль: " + (error.message || "ошибка"));
        return;
      }

      if (data && data.ok) {
        alert("Пароль обновлен.");
      } else {
        alert("Ответ функции без ok=true");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка вызова функции admin-reset-password");
    }
  }

  if (authLoading) return <div className="p-4">Загрузка…</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Сотрудники</h1>

      {/* Форма добавления */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1.3fr 2fr 1.2fr auto",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          style={inputStyle}
          placeholder="Имя"
          value={newRow.name}
          onChange={function (e) {
            setNewRow({ ...newRow, name: e.target.value });
          }}
        />
        <input
          style={inputStyle}
          placeholder="Телефон"
          value={newRow.phone}
          onChange={function (e) {
            setNewRow({ ...newRow, phone: e.target.value });
          }}
        />
        <input
          style={inputStyle}
          placeholder="Email"
          value={newRow.email}
          onChange={function (e) {
            setNewRow({ ...newRow, email: e.target.value });
          }}
        />
        <select
          style={inputStyle}
          value={newRow.role}
          onChange={function (e) {
            setNewRow({ ...newRow, role: e.target.value });
          }}
        >
          {ROLE_OPTIONS.map(function (o) {
            return (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            );
          })}
        </select>
        <button onClick={addRow} style={{ padding: "6px 12px" }}>
          Добавить
        </button>
      </div>

      <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8fafc" }}>
            <tr>
              <th style={th} width="40">
                #
              </th>
              <th style={th}>Имя</th>
              <th style={th} width="180">
                Телефон
              </th>
              <th style={th} width="240">
                Email
              </th>
              <th style={th} width="160">
                Должность
              </th>
              <th style={{ ...th, textAlign: "center" }} width="320">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={td} colSpan={6}>
                  Загрузка…
                </td>
              </tr>
            ) : null}

            {!loading && items.length === 0 ? (
              <tr>
                <td style={td} colSpan={6}>
                  Сотрудников пока нет
                </td>
              </tr>
            ) : null}

            {items.map(function (row, idx) {
              return (
                <tr key={row.id}>
                  <td style={td}>{idx + 1}</td>
                  <td style={td}>
                    <input
                      style={inputStyle}
                      value={row.name || ""}
                      onChange={function (e) {
                        onChangeCell(row.id, "name", e.target.value);
                      }}
                    />
                  </td>
                  <td style={td}>
                    <input
                      style={inputStyle}
                      value={row.phone || ""}
                      onChange={function (e) {
                        onChangeCell(row.id, "phone", e.target.value);
                      }}
                    />
                  </td>
                  <td style={td}>
                    <input
                      style={inputStyle}
                      value={row.email || ""}
                      onChange={function (e) {
                        onChangeCell(row.id, "email", e.target.value);
                      }}
                    />
                  </td>
                  <td style={td}>
                    <select
                      style={inputStyle}
                      value={(row.role || "tech").toLowerCase()}
                      onChange={function (e) {
                        onChangeCell(row.id, "role", e.target.value);
                      }}
                    >
                      {ROLE_OPTIONS.map(function (o) {
                        return (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <button
                      title="Сохранить"
                      onClick={function () {
                        saveRow(row);
                      }}
                      style={{ marginRight: 8 }}
                    >
                      Сохранить
                    </button>

                    <button
                      title="Создать аккаунт (email + пароль)"
                      onClick={function () {
                        createAccount(row);
                      }}
                      style={{ marginRight: 8 }}
                    >
                      Создать аккаунт
                    </button>

                    <button
                      title="Сбросить пароль"
                      onClick={function () {
                        resetPassword(row);
                      }}
                      style={{ marginRight: 8 }}
                    >
                      Сбросить пароль
                    </button>

                    <button
                      title="Удалить"
                      onClick={function () {
                        removeRow(row.id);
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
