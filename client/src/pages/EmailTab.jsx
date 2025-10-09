// client/src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const SHARED_EMAIL = "simscope.office@gmail.com";

async function fetchWithAuth(fnPath, method = "POST", body = {}) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/${fnPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || ""}`,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function EmailTab() {
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]); // [{id, subject, from, date, snippet}]
  const [nextPageToken, setNextPageToken] = useState(null);
  const [q, setQ] = useState(""); // gmail-синтаксис
  const [active, setActive] = useState(null); // message object
  const [error, setError] = useState("");

  const subtitle = useMemo(
    () => `Общий ящик: ${SHARED_EMAIL} (только просмотр)`,
    []
  );

  const loadList = async (append = false, pageToken = null) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithAuth("gmail_list", "POST", {
        shared_email: SHARED_EMAIL,
        q: q || "",
        pageToken: pageToken || null,
      });
      const list = res.items || [];
      setItems((prev) => (append ? [...prev, ...list] : list));
      setNextPageToken(res.nextPageToken || null);
      if (!append && list[0]) {
        // авто-открыть первое письмо
        loadMessage(list[0].id).catch(() => {});
      }
      setConnected(true);
    } catch (e) {
      const msg = String(e.message || e);
      // если ящик не подключен — предложить подключить
      if (msg.includes("MAIL_ACCOUNT_NOT_FOUND")) setConnected(false);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextPageToken) return;
    await loadList(true, nextPageToken);
  };

  const loadMessage = async (id) => {
    setError("");
    try {
      const res = await fetchWithAuth("gmail_get", "POST", {
        shared_email: SHARED_EMAIL,
        message_id: id,
      });
      setActive(res);
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  useEffect(() => {
    loadList().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearch = (e) => {
    e?.preventDefault?.();
    loadList().catch(() => {});
  };

  const connectGmail = () => {
    // редирект на функцию старта OAuth
    window.location.href = `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/oauth_google_start`;
  };

  return (
    <div className="p-4 grid gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Email</h1>
          <div className="text-sm text-gray-600 mt-1">{subtitle}</div>
        </div>
        {!connected && (
          <button
            className="px-3 py-2 rounded bg-black text-white"
            onClick={connectGmail}
            title="Подключить общий ящик через Google OAuth"
          >
            Подключить Gmail
          </button>
        )}
      </div>

      <form className="flex gap-2" onSubmit={onSearch}>
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="Поиск (синтаксис Gmail: from:, to:, subject:, has:attachment, newer_than:7d …)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="px-4 py-2 rounded bg-black text-white" disabled={loading}>
          Поиск
        </button>
      </form>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-700 rounded p-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {/* Список */}
        <div className="border rounded-xl overflow-hidden">
          <div className="px-3 py-2 text-sm font-semibold border-b bg-gray-50">
            Входящие
          </div>
          <div style={{ maxHeight: 560, overflow: "auto" }}>
            {items.length === 0 && !loading && (
              <div className="p-3 text-sm text-gray-500">Нет писем</div>
            )}
            {items.map((m) => (
              <button
                key={m.id}
                className={
                  "w-full text-left px-3 py-2 border-b hover:bg-gray-50 " +
                  (active?.id === m.id ? "bg-blue-50" : "")
                }
                onClick={() => loadMessage(m.id)}
              >
                <div className="text-sm font-semibold line-clamp-1">{m.subject || "(без темы)"}</div>
                <div className="text-xs text-gray-600 line-clamp-1">
                  {m.from} • {m.date_human}
                </div>
                {m.snippet && (
                  <div className="text-xs text-gray-500 line-clamp-1">{m.snippet}</div>
                )}
              </button>
            ))}
            {nextPageToken && (
              <div className="p-2">
                <button className="w-full border rounded py-2" onClick={loadMore} disabled={loading}>
                  Загрузить ещё
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Просмотр */}
        <div className="md:col-span-2 border rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50">
            <div className="text-sm font-semibold">{active?.subject || "(без темы)"}</div>
            <div className="text-xs text-gray-600">
              {active?.from} → {active?.to?.join(", ") || "—"} • {active?.date_human || ""}
            </div>
          </div>
          <div style={{ maxHeight: 560, overflow: "auto" }}>
            {!active && (
              <div className="p-4 text-sm text-gray-500">Выберите письмо слева</div>
            )}
            {active && (
              <div className="p-4">
                {active.html ? (
                  // Gmail HTML уже приведён на сервере, но всё равно отображаем в «изолированном» контейнере
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: active.html }}
                  />
                ) : (
                  <pre className="text-sm whitespace-pre-wrap">{active.text || ""}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Загрузка…</div>}
    </div>
  );
}
