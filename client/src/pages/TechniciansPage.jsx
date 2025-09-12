// src/pages/AdminTechniciansPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

/* ========== UI helpers ========== */
const cx = (...s) => s.filter(Boolean).join(" ");
const input = "w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50";
const select = input;
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed";
const btn = cx(btnBase, "border border-gray-300 hover:bg-gray-50");
const btnPrimary = cx(
  btnBase,
  "bg-blue-600 text-white hover:bg-blue-700 border border-blue-600"
);
const badge = "inline-flex items-center px-2 py-0.5 text-xs rounded-full border";

/* ========== Password util ========== */
function genTempPassword(len = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/* ========== Raw call to Edge Function ========== */
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
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

/* ========== Pretty JSON ========== */
function JsonBlock({ data }) {
  if (!data) return null;
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-gray-900 text-gray-100 text-xs p-3">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/* ========== Page ========== */
export default function AdminTechniciansPage() {
  /* auth context */
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
  const [orgId, setOrgId] = useState(1);

  /* UI state */
  const [notice, setNotice] = useState(null); // {type:'success'|'error'|'info', title, message, details?}
  const [showDetails, setShowDetails] = useState(false);

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
        const prof = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        setMeProfileRole(prof.data?.role ?? null);

        const tech = await supabase
          .from("technicians")
          .select("role, is_admin")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        setMeTechInfo(tech.data || null);
      }

      await fetchTechnicians();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTechnicians() {
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, role, is_admin, org_id, auth_user_id, email")
      .order("name", { ascending: true });

    if (error) {
      setNotice({
        type: "error",
        title: "Ошибка загрузки",
        message: error.message,
      });
    }
    setList(data || []);
  }

  function resetForm() {
    setEmail("");
    setName("");
    setPhone("");
    setRole("tech");
    setPassword(genTempPassword());
    setOrgId(1);
  }

  function filtered(rows) {
    return (rows || [])
      .filter((r) =>
        !q
          ? true
          : [r.name, r.email, r.phone].some((v) =>
              String(v || "").toLowerCase().includes(q.toLowerCase())
            )
      )
      .filter((r) => (roleFilter === "all" ? true : r.role === roleFilter));
  }

  async function createTech(e) {
    e.preventDefault();
    setNotice(null);
    if (!isAdmin) {
      setNotice({
        type: "error",
        title: "Недостаточно прав",
        message: "Только администратор может создавать сотрудников.",
      });
      return;
    }

    setLoading(true);

    const payload = {
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role,
      org_id: Number(orgId) || 1,
      link_if_exists: true,
    };

    try {
      // 1) основной вызов
      const { data, error } = await supabase.functions.invoke(
        "admin-create-user",
        { body: payload }
      );

      if (error || data?.error || data?.warning) {
        // 2) fallback: сырой вызов, чтобы вытащить JSON при 4xx/5xx
        const raw = await rawCallFunction("admin-create-user", payload);

        // показываем понятный блок с деталями ответа
        setNotice({
          type: raw.ok ? "success" : "error",
          title: raw.ok ? "Сотрудник создан" : "Не удалось создать сотрудника",
          message: raw.ok
            ? "Новая учётка зарегистрирована / привязана."
            : "Edge-функция вернула ошибку.",
          details: { status: raw.status, ...raw.json },
        });

        if (!raw.ok) return; // не продолжаем на ошибке
      } else {
        setNotice({
          type: "success",
          title: "Сотрудник создан",
          message:
            "Новая учётка зарегистрирована / привязана. Передайте e-mail и временный пароль.",
          details: data,
        });
      }

      resetForm();
      await fetchTechnicians();
    } catch (err) {
      setNotice({
        type: "error",
        title: "Необработанная ошибка",
        message: String(err?.message || err),
      });
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(emailAddr) {
    setNotice(null);

    // 1) invoke
    const inv = await supabase.functions.invoke("admin-create-user", {
      body: { action: "sendPasswordReset", email: emailAddr },
    });

    if (inv.error || inv.data?.error) {
      // 2) fallback raw
      const raw = await rawCallFunction("admin-create-user", {
        action: "sendPasswordReset",
        email: emailAddr,
      });

      setNotice({
        type: raw.ok ? "success" : "error",
        title: raw.ok ? "Ссылка на сброс отправлена" : "Не удалось сгенерировать ссылку",
        message: raw.ok
          ? "Письмо отправлено пользователю или ссылка создана."
          : "Edge-функция вернула ошибку.",
        details: { status: raw.status, ...raw.json },
      });
      return;
    }

    setNotice({
      type: "success",
      title: "Ссылка на сброс отправлена",
      message: "Письмо отправлено пользователю или ссылка создана.",
      details: inv.data,
    });
  }

  const disabledSubmit =
    !email.trim() || !name.trim() || !role || !password || loading;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Техники / Сотрудники</h1>
        <div className="text-sm text-gray-500">
          {isAdmin ? (
            <span className={cx(badge, "border-green-600 text-green-700")}>
              Доступ: администратор
            </span>
          ) : (
            <span className={cx(badge, "border-amber-500 text-amber-700")}>
              Доступ: ограничен
            </span>
          )}
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div
          className={cx(
            "mb-6 rounded-lg border p-4",
            notice.type === "error" && "border-red-300 bg-red-50",
            notice.type === "success" && "border-green-300 bg-green-50",
            notice.type === "info" && "border-blue-300 bg-blue-50"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">
                {notice.title || (notice.type === "success" ? "Готово" : "Сообщение")}
              </div>
              {notice.message && (
                <div className="text-sm text-gray-700 mt-1">{notice.message}</div>
              )}
            </div>
            {notice?.details && (
              <button
                className={btn}
                onClick={() => setShowDetails((v) => !v)}
              >
                {showDetails ? "Скрыть детали" : "Показать детали"}
              </button>
            )}
          </div>
          {showDetails && <JsonBlock data={notice.details} />}
        </div>
      )}

      {/* Guard for non-admin */}
      {!isAdmin && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          У вас нет прав для создания сотрудников. Обратитесь к администратору.
        </div>
      )}

      {/* Create form */}
      <div className="mb-8 rounded-xl border bg-white shadow-sm p-4 md:p-6">
        <h2 className="text-lg font-semibold mb-4">Добавить сотрудника</h2>
        <form onSubmit={createTech} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">E-mail *</label>
            <input
              className={input}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Телефон</label>
            <input
              className={input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+375..."
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Имя / ФИО *</label>
            <input
              className={input}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Иванов"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Роль *</label>
            <select
              className={select}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="tech">Техник</option>
              <option value="manager">Менеджер</option>
              <option value="admin">Админ</option>
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Орг. ID</label>
            <input
              className={input}
              type="number"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="1"
            />
            <div className="text-xs text-gray-500 mt-1">
              Если всегда 1 — можно не трогать.
            </div>
          </div>

          <div className="md:col-span-1">
            <label className="block text-sm mb-1">Временный пароль *</label>
            <div className="flex gap-2">
              <input
                className={input}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={btn}
                onClick={() => setPassword(genTempPassword())}
              >
                Сгенерировать
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Передайте сотруднику этот пароль для первого входа.
            </div>
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button
              disabled={disabledSubmit || !isAdmin}
              className={btnPrimary}
              type="submit"
            >
              {loading && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
              )}
              {loading ? "Создаю..." : "Создать сотрудника"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={resetForm}
              disabled={loading}
            >
              Очистить форму
            </button>
          </div>
        </form>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <input
          className={cx(input, "md:max-w-xs")}
          placeholder="Поиск по имени, email, телефону…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={select}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">Все роли</option>
          <option value="admin">Админ</option>
          <option value="manager">Менеджер</option>
          <option value="tech">Техник</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-gray-600">
              <th className="px-4 py-2 text-left">Имя</th>
              <th className="px-4 py-2 text-left">E-mail</th>
              <th className="px-4 py-2 text-left">Телефон</th>
              <th className="px-4 py-2 text-left">Роль</th>
              <th className="px-4 py-2 text-left">is_admin</th>
              <th className="px-4 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered(list).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-4 py-2">{row.name}</td>
                <td className="px-4 py-2">{row.email || "—"}</td>
                <td className="px-4 py-2">{row.phone || "—"}</td>
                <td className="px-4 py-2">
                  <span
                    className={cx(
                      badge,
                      row.role === "admin" && "border-red-400 text-red-700",
                      row.role === "manager" && "border-amber-400 text-amber-700",
                      row.role === "tech" && "border-blue-400 text-blue-700"
                    )}
                  >
                    {row.role}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {row.is_admin ? (
                    <span className="text-green-700">TRUE</span>
                  ) : (
                    <span className="text-gray-500">FALSE</span>
                  )}
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    className={btn}
                    onClick={() => row.email && sendReset(row.email)}
                    disabled={!row.email}
                    title={!row.email ? "У этого сотрудника нет email" : "Сгенерировать ссылку на сброс"}
                  >
                    Сброс пароля
                  </button>
                </td>
              </tr>
            ))}
            {filtered(list).length === 0 && (
              <tr className="border-t">
                <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                  Сотрудники не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
