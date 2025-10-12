// client/src/pages/EmailTab.jsx
import React, { useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// Без TypeScript-кастов и с совместимым кодом для CRA/ESLint
function getFunctionsBase() {
  // 1) Явная переменная окружения
  try {
    const env =
      import.meta &&
      import.meta.env &&
      import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
        ? String(import.meta.env.VITE_SUPABASE_FUNCTIONS_URL).trim()
        : "";
    if (env) return env.replace(/\/+$/, "");
  } catch (_) {}

  // 2) Резерв: строим из URL проекта Supabase
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

  // 3) На крайний случай
  return "/functions/v1";
}

// --- утилиты клиента ---
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

export default function EmailTab() {
  const base = useMemo(getFunctionsBase, []);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const inputRef = useRef(null);

  // Временно: вводим access_token вручную, пока не подтянем из БД
  const [accessToken, setAccessToken] = useState("");

  const onPickFiles = async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const arr = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const b64 = await fileToBase64(f);
      arr.push({
        filename: f.name,
        mimeType: f.type || "application/octet-stream",
        base64: b64,
      });
    }
    setAttachments((prev) => prev.concat(arr));
    try {
      // чтобы можно было выбрать те же файлы повторно
      ev.target.value = "";
    } catch (_) {}
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSend = async () => {
    if (!to.trim()) {
      alert("Укажите получателя");
      return;
    }
    if (!accessToken.trim()) {
      alert("Укажите access_token (временно)");
      return;
    }

    setSending(true);
    try {
      const payload = {
        to: to
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        subject: subject,
        text: text,
        attachments: attachments,
        access_token: accessToken.trim(),
      };

      const r = await fetch(base.replace(/\/+$/, "") + "/gmail_send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await r.json();
      } catch (_) {}

      if (!r.ok || (data && data.ok === false)) {
        // Показать тело/ошибку
        const msg =
          (data && (data.error || data.body)) ||
          ("HTTP " + r.status + " " + r.statusText);
        console.error("gmail_send error:", data);
        alert("Ошибка отправки: " + msg);
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
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
            Вложения
          </div>
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

        {/* Временно: вводим access_token вручную */}
        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Google access_token (временно)
          </div>
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="inp"
            placeholder="ya29.a0..."
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
