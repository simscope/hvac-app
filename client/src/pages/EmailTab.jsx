// client/src/pages/EmailTab.jsx
import React, { useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const getFunctionsBase = () => {
  // 1) Явная переменная окружения
  const env = import.meta?.env?.VITE_SUPABASE_FUNCTIONS_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  // 2) Резерв: строим из URL проекта Supabase
  const sbUrl = (supabase as any)?.rest?.url || (supabase as any)?.supabaseUrl;
  if (sbUrl) {
    const u = new URL(sbUrl);
    return `${u.origin}/functions/v1`;
  }
  // 3) На крайний случай
  return "/functions/v1";
};

export default function EmailTab() {
  const base = useMemo(getFunctionsBase, []);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const inputRef = useRef(null);

  // Временно держим access_token в памяти/вводе (до того как подключите из БД)
  const [accessToken, setAccessToken] = useState("");

  const onPickFiles = async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const arr = [];
    for (const f of files) {
      const b64 = await fileToBase64(f);
      arr.push({ filename: f.name, mimeType: f.type || "application/octet-stream", base64: b64 });
    }
    setAttachments((prev) => prev.concat(arr));
    // очистить value, чтобы повторно можно было выбирать те же файлы
    try { ev.target.value = ""; } catch {}
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSend = async () => {
    if (!to.trim()) return alert("Укажите получателя");
    if (!accessToken.trim()) return alert("Укажите access_token (временное поле)");

    setSending(true);
    try {
      const payload = {
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: subject,
        text: text,
        attachments,
        access_token: accessToken.trim(), // временно берём отсюда
      };

      const r = await fetch(`${base}/gmail_send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.ok === false) {
        console.error("gmail_send error:", data);
        alert(`Ошибка отправки: ${data?.error || data?.body || r.status}`);
        return;
      }

      alert("Письмо отправлено!");
      setSubject("");
      setText("");
      setAttachments([]);
    } catch (e) {
      console.error(e);
      alert(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Email</h2>

      <div style={{ maxWidth: 720, display: "grid", gap: 12 }}>
        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Кому (через запятую)</div>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="inp"
            placeholder="user1@example.com, user2@example.com"
            style={inpStyle}
          />
        </label>

        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Тема</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="inp"
            placeholder="Тема письма"
            style={inpStyle}
          />
        </label>

        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Текст</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Текст письма"
            style={{ ...inpStyle, resize: "vertical" }}
          />
        </label>

        <div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Вложения</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={onPickFiles}
            style={{ marginBottom: 8 }}
          />
          {attachments.length > 0 && (
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

        {/* Временное поле access_token, пока не подключим его из БД */}
        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Google access_token (временно)</div>
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="inp"
            placeholder="ya29.a0...."
            style={inpStyle}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onSend} disabled={sending}>
            {sending ? "Отправка..." : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- утилиты клиента ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const inpStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
};

