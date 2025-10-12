import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

/* ────────────────────────────────────────────────────────────────────────────
   Кросс-средовый доступ к env:
   - Vite: import.meta.env
   - CRA (react-scripts): process.env
   - Любая страница: window.__ENV__ (если захотите)
   ────────────────────────────────────────────────────────────────────────── */
const ENV =
  (typeof import.meta !== "undefined" && import.meta.env) ||
  (typeof process !== "undefined" && process.env) ||
  (typeof window !== "undefined" && window.__ENV__) ||
  {};

/* Базовый URL функций Supabase */
let FUNCTIONS_BASE =
  ENV.VITE_SUPABASE_FUNCTIONS_URL ||
  ENV.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  (ENV.VITE_SUPABASE_URL || ENV.REACT_APP_SUPABASE_URL
    ? `${String(ENV.VITE_SUPABASE_URL || ENV.REACT_APP_SUPABASE_URL)
        .replace(/\/+$/, "")}/functions/v1`
    : "");

// ⚠️ На случай, если переменные среды так и не заданы,
// можно временно раскомментировать строку ниже и подставить ваш URL проекта.
// FUNCTIONS_BASE = "https://jyvwdftejvnisjvuidtt.supabase.co/functions/v1";

const SHARED_EMAIL = "simscope.office@gmail.com";

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleString();
};

export default function EmailTab() {
  const { session } = useAuth();
  const token = session?.access_token || session?.accessToken || null;

  const [list, setList] = useState({ items: [], nextPageToken: null });
  const [q, setQ] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState(null);

  const [selected, setSelected] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  const [busyAction, setBusyAction] = useState(false);

  const needConnect = useMemo(() => {
    return !FUNCTIONS_BASE || errList === "MAIL_ACCOUNT_NOT_FOUND";
  }, [errList]);

  const loadList = async (opts = {}) => {
    if (!FUNCTIONS_BASE) {
      setErrList("Не задан URL функций Supabase");
      return;
    }
    setLoadingList(true);
    setErrList(null);
    try {
      const r = await fetch(`${FUNCTIONS_BASE}/gmail_list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          shared_email: SHARED_EMAIL,
          q: opts.q ?? q,
          pageToken: opts.pageToken ?? null,
        }),
      });
      if (r.status === 404) {
        const t = await r.text();
        if (t.includes("MAIL_ACCOUNT_NOT_FOUND"))
          setErrList("MAIL_ACCOUNT_NOT_FOUND");
        else setErrList(t || "Not found");
        setList({ items: [], nextPageToken: null });
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setList({
        items: j.items || [],
        nextPageToken: j.nextPageToken || null,
      });
    } catch (e) {
      setErrList((e && e.message) || "Failed to fetch");
      setList({ items: [], nextPageToken: null });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [FUNCTIONS_BASE]);

  const loadMessage = async (id) => {
    if (!FUNCTIONS_BASE || !id) return;
    setLoadingMsg(true);
    setErrMsg(null);
    setSelected(null);
    try {
      const r = await fetch(`${FUNCTIONS_BASE}/gmail_get`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ shared_email: SHARED_EMAIL, message_id: id }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setSelected(j);
    } catch (e) {
      setErrMsg((e && e.message) || "Failed to fetch");
    } finally {
      setLoadingMsg(false);
    }
  };

  const modify = async (id, action) => {
    if (!FUNCTIONS_BASE || !id) return;
    setBusyAction(true);
    try {
      const r = await fetch(`${FUNCTIONS_BASE}/gmail_modify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ shared_email: SHARED_EMAIL, message_id: id, action }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadList();
      if (selected?.id === id) setSelected(null);
    } catch (e) {
      alert((e && e.message) || "Ошибка операции");
    } finally {
      setBusyAction(false);
    }
  };

  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState({ to: "", subject: "", text: "", html: "" });

  const sendMail = async () => {
    if (!FUNCTIONS_BASE) return;
    if (!draft.to) return alert("Укажите получателя");
    setBusyAction(true);
    try {
      const r = await fetch(`${FUNCTIONS_BASE}/gmail_send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          shared_email: SHARED_EMAIL,
          from: SHARED_EMAIL,
          to: draft.to.split(/[,\s;]+/).filter(Boolean),
          subject: draft.subject || "",
          text: draft.text || "",
          html: draft.html || "",
          attachments: [],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setComposeOpen(false);
      setDraft({ to: "", subject: "", text: "", html: "" });
      await loadList();
    } catch (e) {
      alert((e && e.message) || "Не удалось отправить");
    } finally {
      setBusyAction(false);
    }
  };

  const connectGmail = () => {
    if (!FUNCTIONS_BASE) {
      alert("Не задан VITE/REACT_APP_SUPABASE_* (URL функций)");
      return;
    }
    window.open(`${FUNCTIONS_BASE}/oauth_google_start`, "_blank", "width=480,height=640");
  };

  const iframeRef = useRef(null);
  useEffect(() => {
    if (iframeRef.current && selected?.html != null) {
      iframeRef.current.srcdoc =
        selected.html ||
        `<pre style="white-space:pre-wrap;font:14px system-ui">${(selected.text || "")
          .replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>`;
    }
  }, [selected?.html, selected?.text]);

  return (
    <div className="mail">
      <div className="mail__header">
        <div className="mail__title">Email</div>
        <div className="mail__actions">
          <div className="mail__search">
            <input
              placeholder="Поиск (Gmail: from:, subject:, has:attachment …)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadList({ q })}
            />
            <button onClick={() => loadList({ q })} disabled={loadingList}>Найти</button>
          </div>
          <button onClick={() => loadList()} disabled={loadingList}>Обновить</button>
          <button onClick={() => setComposeOpen(true)}>Написать</button>
          {needConnect && (
            <button className="mail__connect" onClick={connectGmail}>
              Подключить Gmail
            </button>
          )}
        </div>
      </div>

      <div className="mail__hint">
        Общий ящик: <b>{SHARED_EMAIL}</b>
        {!needConnect ? " (подключено)" : " (не подключено — нажмите «Подключить Gmail»)"}
      </div>

      <div className="mail__body">
        <aside className="mail__list">
          {loadingList && <div className="mail__empty">Загрузка…</div>}
          {!loadingList && errList && (
            <div className="mail__error">
              {errList === "MAIL_ACCOUNT_NOT_FOUND"
                ? "Ящик не подключён. Нажмите «Подключить Gmail»."
                : errList}
            </div>
          )}
          {!loadingList && !errList && list.items.length === 0 && (
            <div className="mail__empty">Писем нет</div>
          )}
          {!loadingList && !errList && list.items.length > 0 && (
            <ul className="mail__items" role="list">
              {list.items.map((m) => (
                <li
                  key={m.id}
                  className={"mail__item" + (selected?.id === m.id ? " is-active" : "")}
                  onClick={() => loadMessage(m.id)}
                >
                  <div className="mail__item-subj">{m.subject || "(без темы)"}</div>
                  <div className="mail__item-meta">
                    <span className="mail__item-from">{m.from || "—"}</span>
                    <span className="mail__item-date">{m.date_human || ""}</span>
                  </div>
                  {m.snippet && <div className="mail__item-snippet">{m.snippet}</div>}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="mail__viewer">
          {!selected && !loadingMsg && <div className="mail__placeholder">Выберите письмо слева</div>}
          {loadingMsg && <div className="mail__placeholder">Открываем…</div>}
          {errMsg && <div className="mail__error">{errMsg}</div>}
          {selected && !loadingMsg && (
            <>
              <header className="mail__viewer-head">
                <div className="mail__viewer-subj">{selected.subject || "(без темы)"}</div>
                <div className="mail__viewer-meta">
                  <div className="mail__row"><span>От:</span> <b>{selected.from || "—"}</b></div>
                  <div className="mail__row"><span>Кому:</span> {selected.to?.join(", ") || "—"}</div>
                  <div className="mail__row"><span>Дата:</span> {fmtDate(selected.date_human)}</div>
                </div>
                <div className="mail__viewer-actions">
                  <button disabled={busyAction} onClick={() => modify(selected.id, "read")}>Прочитано</button>
                  <button disabled={busyAction} onClick={() => modify(selected.id, "unread")}>Не прочитано</button>
                  <button disabled={busyAction} onClick={() => modify(selected.id, "trash")}>В корзину</button>
                </div>
              </header>
              <div className="mail__viewer-body">
                <iframe ref={iframeRef} title="email" className="mail__iframe" sandbox="allow-popups allow-same-origin" />
              </div>
            </>
          )}
        </section>
      </div>

      {composeOpen && (
        <div className="mail__modal">
          <div className="mail__modal-inner">
            <div className="mail__modal-head">
              Новое письмо
              <button onClick={() => setComposeOpen(false)}>✕</button>
            </div>
            <div className="mail__modal-body">
              <label>Кому
                <input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="email1@example.com, email2@example.com"/>
              </label>
              <label>Тема
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}/>
              </label>
              <label>Текст (plain)
                <textarea rows={6} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })}/>
              </label>
              <label>HTML (необязательно)
                <textarea rows={6} value={draft.html} onChange={(e) => setDraft({ ...draft, html: e.target.value })} placeholder="<p>Здравствуйте…</p>"/>
              </label>
            </div>
            <div className="mail__modal-actions">
              <button className="is-primary" disabled={busyAction} onClick={sendMail}>Отправить</button>
              <button onClick={() => setComposeOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mail{display:flex;flex-direction:column;gap:12px;padding:12px;color:#111}
        .mail__header{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .mail__title{font-weight:800;font-size:20px}
        .mail__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .mail__search{display:flex;gap:6px;align-items:center}
        .mail__search input{width:380px;max-width:55vw;padding:8px 10px;border:1px solid #d1d5db;border-radius:10px}
        .mail__actions button{padding:8px 10px;border:1px solid #d1d5db;background:#fff;border-radius:10px;cursor:pointer}
        .mail__actions button:hover{background:#f9fafb}
        .mail__connect{background:#2563eb;color:#fff;border-color:#2563eb}
        .mail__connect:hover{filter:brightness(.95)}
        .mail__hint{font-size:12px;opacity:.8}
        .mail__body{display:grid;grid-template-columns: 360px 1fr; gap:12px; min-height:60vh}
        .mail__list{border:1px solid #e5e7eb;border-radius:12px;background:#fff;overflow:auto}
        .mail__items{list-style:none;margin:0;padding:0}
        .mail__item{padding:10px 12px;border-bottom:1px solid #f3f4f6;cursor:pointer}
        .mail__item:hover{background:#f9fafb}
        .mail__item.is-active{background:#eef2ff}
        .mail__item-subj{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mail__item-meta{
