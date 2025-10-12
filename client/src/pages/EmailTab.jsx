// client/src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/* --------------------------- helpers --------------------------- */

function getFunctionsBase() {
  // 1) пробуем .env (Vite)
  try {
    const env =
      import.meta &&
      import.meta.env &&
      import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
        ? String(import.meta.env.VITE_SUPABASE_FUNCTIONS_URL).trim()
        : "";
    if (env) return env.replace(/\/+$/, "");
  } catch (_) {}

  // 2) строим по URL проекта Supabase
  const sbUrl =
    (supabase && supabase.rest && supabase.rest.url) ||
    (supabase && supabase.supabaseUrl) ||
    "";

  if (sbUrl) {
    try {
      const u = new URL(sbUrl);
      return (u.origin || "").replace(/\/+$/, "") + "/functions/v1";
    } catch (_) {}
  }

  // 3) резерв
  return "/functions/v1";
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) || ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* --------------------------- main page --------------------------- */

export default function EmailTab() {
  const base = useMemo(getFunctionsBase, []);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]); // [{id, subject, from, snippet, internalDate, unread, hasAttachments}]
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // объект письма с контентом

  const [composeOpen, setComposeOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [accessToken, setAccessToken] = useState(""); // временно

  const fileRef = useRef(null);

  /* --------------------------- list --------------------------- */

  const loadList = async (query) => {
    setLoading(true);
    setError("");
    setSelected(null);

    try {
      const url =
        base.replace(/\/+$/, "") +
        "/gmail_list" +
        (query ? "?q=" + encodeURIComponent(query) : "");

      const r = await fetch(url, { method: "GET" });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(
          (data && (data.error || data.message)) ||
            `HTTP ${r.status} ${r.statusText}`
        );
      }

      // Нормализуем возможные форматы результатов
      const items =
        (data && (data.items || data.messages || data.data || [])) || [];

      // Приводим к простому виду
      const mapped = items.map((it) => ({
        id: it.id || it.messageId || it.gmailId || "",
        subject: it.subject || it.snippetSubject || "(без темы)",
        from: it.from || it.sender || "",
        snippet: it.snippet || "",
        internalDate: it.internalDate || it.date || it.receivedAt || "",
        unread: !!(it.unread || it.isUnread),
        hasAttachments: !!(it.hasAttachments || it.attachmentsCount > 0),
      }));

      setList(mapped);
    } catch (e) {
      console.error("gmail_list error:", e);
      setList([]);
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const onSearch = (e) => {
    e.preventDefault();
    loadList(q.trim());
  };

  /* --------------------------- get one --------------------------- */

  const openMessage = async (id) => {
    setSelected({ id, loading: true });
    try {
      const url =
        base.replace(/\/+$/, "") + "/gmail_get?id=" + encodeURIComponent(id);
      const r = await fetch(url, { method: "GET" });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(
          (data && (data.error || data.message)) ||
            `HTTP ${r.status} ${r.statusText}`
        );
      }

      // ожидаем поля html/text/attachments + служебные заголовки
      const msg = {
        id,
        subject: data.subject || "(без темы)",
        from: data.from || "",
        to: data.to || "",
        date: data.date || data.internalDate || "",
        html: data.html || "",
        text: data.text || "",
        attachments: Array.isArray(data.attachments)
          ? data.attachments
          : [], // [{filename, size, mimeType, url/id}]
      };

      setSelected({ ...msg, loading: false });
    } catch (e) {
      console.error("gmail_get error:", e);
      setSelected({ id, loading: false, error: String(e.message || e) });
    }
  };

  /* --------------------------- compose --------------------------- */

  const addFiles = async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const arr = [];
    for (const f of files) {
      const b64 = await fileToBase64(f);
      arr.push({
        filename: f.name,
        mimeType: f.type || "application/octet-stream",
        base64: b64,
      });
    }
    setAttachments((p) => p.concat(arr));
    try {
      ev.target.value = "";
    } catch (_) {}
  };

  const removeAttachment = (i) => {
    setAttachments((p) => p.filter((_, idx) => idx !== i));
  };

  const sendMail = async () => {
    if (!to.trim()) {
      alert("Укажите получателя");
      return;
    }
    if (!accessToken.trim()) {
      alert("Временно требуется access_token (Google OAuth)");
      return;
    }

    setSending(true);
    try {
      const payload = {
        to: to
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        subject,
        text,
        attachments,
        access_token: accessToken.trim(),
      };

      const r = await fetch(base.replace(/\/+$/, "") + "/gmail_send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || (data && data.ok === false)) {
        throw new Error(
          (data && (data.error || data.message || data.body)) ||
            `HTTP ${r.status} ${r.statusText}`
        );
      }

      alert("Письмо отправлено");
      setComposeOpen(false);
      setTo("");
      setSubject("");
      setText("");
      setAttachments([]);
      // обновим входящие
      loadList(q);
    } catch (e) {
      console.error("gmail_send error:", e);
      alert(String(e.message || e));
    } finally {
      setSending(false);
    }
  };

  /* --------------------------- UI --------------------------- */

  return (
    <div style={{ padding: 12, height: "calc(100vh - 64px)" }}>
      <h2 style={{ margin: "8px 0 12px" }}>Email</h2>

      {/* панель действий */}
      <form onSubmit={onSearch} style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Поиск (Gmail синтаксис: from:, subject:, has:attachment ...)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
          }}
        />
        <button type="submit">Найти</button>
        <button type="button" onClick={() => loadList(q)} disabled={loading}>
          Обновить
        </button>
        <button type="button" onClick={() => setComposeOpen(true)}>
          Написать
        </button>
      </form>

      {/* статус */}
      <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12 }}>
        {loading ? "Загрузка..." : error ? `Ошибка: ${error}` : ""}
      </div>

      {/* двухпанельный вид */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: 10,
          marginTop: 10,
          height: "calc(100% - 90px)",
          minHeight: 420,
        }}
      >
        {/* левая колонка — список */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: 8,
              borderBottom: "1px solid #e5e7eb",
              fontWeight: 600,
            }}
          >
            Входящие
          </div>
          <div style={{ overflow: "auto" }}>
            {list.length === 0 && !loading ? (
              <div style={{ padding: 12, color: "#6b7280" }}>Нет писем</div>
            ) : (
              list.map((m) => (
                <div
                  key={m.id}
                  onClick={() => openMessage(m.id)}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #f1f5f9",
                    cursor: "pointer",
                    background:
                      selected && selected.id === m.id ? "#eef2ff" : "white",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{ fontWeight: m.unread ? 800 : 600, flex: 1 }}
                      title={m.from}
                    >
                      {m.from || "(без отправителя)"}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 12 }}>
                      {fmtDate(m.internalDate)}
                    </div>
                  </div>
                  <div
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      marginTop: 3,
                    }}
                    title={m.subject}
                  >
                    {m.subject || "(без темы)"}
                  </div>
                  {m.snippet ? (
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: 12,
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={m.snippet}
                    >
                      {m.snippet}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        {/* правая колонка — просмотр письма */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: 8,
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 700, flex: 1, minWidth: 180 }}>
              {selected && !selected.loading
                ? selected.subject || "(без темы)"
                : "Выберите письмо слева"}
            </div>
            {selected && !selected.loading ? (
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {fmtDate(selected.date)}
              </div>
            ) : null}
          </div>

          <div style={{ padding: 12, color: "#334155", fontSize: 14 }}>
            {selected ? (
              selected.loading ? (
                <div>Загрузка письма…</div>
              ) : selected.error ? (
                <div style={{ color: "#ef4444" }}>{selected.error}</div>
              ) : (
                <>
                  <div style={{ marginBottom: 8, color: "#6b7280" }}>
                    <div>
                      <b>От:</b> {selected.from || "—"}
                    </div>
                    <div>
                      <b>Кому:</b> {selected.to || "—"}
                    </div>
                  </div>

                  {/* html приоритетно, fallback — text */}
                  {selected.html ? (
                    <iframe
                      title={"mail-" + selected.id}
                      style={{
                        width: "100%",
                        height: "55vh",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        background: "white",
                      }}
                      srcDoc={`<!doctype html><html><head><base target="_blank" /></head><body style="font-family: system-ui, sans-serif;">${selected.html}</body></html>`}
                    />
                  ) : (
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: 10,
                      }}
                    >
                      {selected.text || "(пусто)"}
                    </pre>
                  )}

                  {/* вложения */}
                  {!!(selected.attachments || []).length && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>
                        Вложения
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {selected.attachments.map((a, i) => {
                          const name =
                            a.filename || a.name || `attachment-${i + 1}`;
                          const url =
                            a.url ||
                            (a.id
                              ? base.replace(/\/+$/, "") +
                                "/gmail_get?id=" +
                                encodeURIComponent(selected.id) +
                                "&att=" +
                                encodeURIComponent(a.id)
                              : "");
                          return (
                            <li key={i}>
                              {url ? (
                                <a href={url} rel="noreferrer" target="_blank">
                                  {name}
                                </a>
                              ) : (
                                <span>{name}</span>
                              )}{" "}
                              {a.size ? (
                                <span style={{ color: "#6b7280" }}>
                                  ({a.size}b)
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )
            ) : (
              <div style={{ color: "#6b7280" }}>→ Выберите письмо слева</div>
            )}
          </div>
        </div>
      </div>

      {/* compose modal */}
      {composeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.35)",
            display: "grid",
            placeItems: "center",
            zIndex: 999,
          }}
          onClick={() => setComposeOpen(false)}
        >
          <div
            style={{
              width: "min(860px, 96vw)",
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: 14,
              boxShadow: "0 12px 36px rgba(0,0,0,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 10,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              Новое письмо
              <button onClick={() => setComposeOpen(false)}>×</button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <label>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Кому</div>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="email1@example.com, email2@example.com"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    outline: "none",
                  }}
                />
              </label>

              <label>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Тема</div>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Тема"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    outline: "none",
                  }}
                />
              </label>

              <label>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Текст</div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  placeholder="Сообщение"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </label>

              <div>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                  Вложения
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  onChange={addFiles}
                  style={{ marginBottom: 8 }}
                />
                {!!attachments.length && (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {attachments.map((a, i) => (
                      <li key={i}>
                        {a.filename}{" "}
                        <button type="button" onClick={() => removeAttachment(i)}>
                          удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Google access_token (временно)
                </div>
                <input
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="ya29.a0..."
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    outline: "none",
                  }}
                />
              </label>

              <div style={{ display: "flex", gap: 8, justifyContent: "end" }}>
                <button onClick={() => setComposeOpen(false)}>Отмена</button>
                <button onClick={sendMail} disabled={sending}>
                  {sending ? "Отправка…" : "Отправить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
