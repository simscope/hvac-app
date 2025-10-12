import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * ВАЖНО:
 *  - для вызова Edge-функций передаём headers: { apikey, Authorization }
 *  - Authorization = токен сессии, если нет — используем anon key
 */
async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };
}

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

function prettyDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleString();
}

export default function EmailTab() {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);           // письма (INBOX)
  const [active, setActive] = useState(null);     // выбранное письмо
  const [q, setQ] = useState("");                 // поиск (gmail-синтаксис)
  const [composeOpen, setComposeOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);         // File[]
  const inputFileRef = useRef(null);

  const hasSelection = !!active;

  const fetchList = async (query = "") => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${FN_BASE}/gmail_list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json(); // [{id, threadId, snippet, internalDate, headers: {...}}]
      setList(data || []);
      setActive(null);
    } catch (e) {
      alert(`gmail_list error: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList("");
  }, []);

  const openCompose = () => {
    setTo("");
    setSubject("");
    setText("");
    setFiles([]);
    setComposeOpen(true);
  };

  const onPickFiles = (e) => {
    const f = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...f]);
    if (inputFileRef.current) inputFileRef.current.value = "";
  };

  const sendEmail = async () => {
    try {
      if (!to.trim()) return alert("Укажите получателя");
      const headers = await getAuthHeaders();

      // Готовим вложения: [{filename, mimeType, base64}]
      const attachments = await Promise.all(
        files.map(
          (f) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                // reader.result -> data:application/pdf;base64,XXXXX
                const s = String(reader.result || "");
                const base64 = s.includes(",") ? s.split(",")[1] : s;
                resolve({
                  filename: f.name,
                  mimeType: f.type || "application/octet-stream",
                  base64,
                });
              };
              reader.onerror = (err) => reject(err);
              reader.readAsDataURL(f);
            })
        )
      );

      const payload = {
        to: to.trim(),             // может содержать несколько адресов через запятую
        subject: subject || "",
        text: text || "",
        html: "",                  // при желании можно дернуть editor и подать HTML
        attachments,               // как выше собрали
        shared_email: "simscope.office@gmail.com", // общий «ящик», с которого шлём
      };

      const r = await fetch(`${FN_BASE}/gmail_send`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }
      alert("Письмо отправлено!");
      setComposeOpen(false);
      // по желанию: обновим список
      fetchList(q);
    } catch (e) {
      alert(`gmail_send error: ${e.message || e}`);
    }
  };

  const openMessage = (m) => setActive(m);

  return (
    <div style={{ padding: 16 }}>
      <h2>Email</h2>

      <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск (Gmail: from:, subject:, has:attachment ...)"
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={() => fetchList(q)} disabled={loading}>
          {loading ? "Загрузка..." : "Найти"}
        </button>
        <button onClick={() => fetchList("")} disabled={loading}>Обновить</button>
        <button onClick={openCompose}>Написать</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12, minHeight: 420 }}>
        {/* ЛЕВАЯ КОЛОНКА – список */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: 8, background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
            Входящие
          </div>
          <div style={{ overflow: "auto" }}>
            {list.length === 0 && (
              <div style={{ padding: 12, color: "#6b7280" }}>
                Нет писем
              </div>
            )}
            {list.map((m) => {
              const from = m.headers?.from || "";
              const subj = m.headers?.subject || "(без темы)";
              return (
                <button
                  key={m.id}
                  onClick={() => openMessage(m)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderBottom: "1px solid #eee",
                    background: active?.id === m.id ? "rgba(59,130,246,.08)" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {from}
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {subj}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{m.snippet || ""}</span>
                    <span>{prettyDate(m.internalDate)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА – контент */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: 12, background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
            {hasSelection ? (active.headers?.subject || "(без темы)") : "Выберите письмо слева"}
          </div>
          <div style={{ padding: 12, minHeight: 300, overflow: "auto" }}>
            {!hasSelection ? null : (
              <>
                <div style={{ marginBottom: 6, color: "#374151" }}>
                  <b>От:</b> {active.headers?.from || ""}
                </div>
                <div style={{ marginBottom: 6, color: "#374151" }}>
                  <b>Кому:</b> {active.headers?.to || ""}
                </div>
                <div style={{ marginBottom: 10, color: "#6b7280", fontSize: 12 }}>
                  {prettyDate(active.internalDate)}
                </div>
                {/* показываем в виде текста; если нужна разметка — парсить mime у функции gmail_list */}
                <pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>
                  {active.snippet || ""}
                </pre>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Модал «Новое письмо» */}
      {composeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 2000,
          }}
        >
          <div style={{ width: 780, maxWidth: "95vw", background: "white", borderRadius: 10, padding: 14, boxShadow: "0 20px 45px rgba(0,0,0,.35)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Новое письмо</div>
              <button onClick={() => setComposeOpen(false)}>✕</button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Кому (через запятую)" />
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Тема" />
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст письма" rows={8} />
            </div>

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <input ref={inputFileRef} type="file" multiple onChange={onPickFiles} />
              {files.length > 0 && (
                <div style={{ fontSize: 12, color: "#374151" }}>
                  Вложений: {files.length}
                </div>
              )}
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setComposeOpen(false)}>Отмена</button>
              <button onClick={sendEmail} style={{ background: "#2563eb", color: "white", padding: "8px 12px", borderRadius: 6 }}>
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
