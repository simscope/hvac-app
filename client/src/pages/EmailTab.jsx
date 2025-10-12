import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

// ─────────────────────────────────────────────────────────────────────────────
// Настройки эндпоинтов Edge Functions (не хардкодим URL проекта)
// ─────────────────────────────────────────────────────────────────────────────
const FUNCTIONS_BASE =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL.replace(/\/+$/,"")}/functions/v1`
    : "");

// имя общего ящика, который мы подключали
const SHARED_EMAIL = "simscope.office@gmail.com";

// Небольшие утилиты
const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
};

// ─────────────────────────────────────────────────────────────────────────────
// Компонент
// ─────────────────────────────────────────────────────────────────────────────
export default function EmailTab() {
  const { session } = useAuth(); // нужен только для токена
  const token = session?.access_token || session?.accessToken || null;

  const [list, setList] = useState({ items: [], nextPageToken: null });
  const [q, setQ] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState(null);

  const [selected, setSelected] = useState(null); // объект письма (полный)
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  const [busyAction, setBusyAction] = useState(false);

  const needConnect = useMemo(() => {
    // показываем кнопку «Подключить Gmail», если нет базового URL или пришёл 404/401
    return !FUNCTIONS_BASE || errList === "MAIL_ACCOUNT_NOT_FOUND";
  }, [errList]);

  // ───────────────────────────────────────────────────────────────────────────
  // Загрузка списка
  // ───────────────────────────────────────────────────────────────────────────
  const loadList = async (opts = {}) => {
    if (!FUNCTIONS_BASE) return;
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
        // наша функция возвращает 404 с текстом MAIL_ACCOUNT_NOT_FOUND
        const t = await r.text();
        if (t.includes("MAIL_ACCOUNT_NOT_FOUND")) setErrList("MAIL_ACCOUNT_NOT_FOUND");
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

  // сразу подгружаем
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [FUNCTIONS_BASE]);

  // ───────────────────────────────────────────────────────────────────────────
  // Загрузка одного письма
  // ───────────────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────────
  // Пометки (прочитано/непрочитано/в корзину)
  // ───────────────────────────────────────────────────────────────────────────
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
      // обновим список/письмо
      await loadList();
      if (selected?.id === id) setSelected(null);
    } catch (e) {
      alert((e && e.message) || "Ошибка операции");
    } finally {
      setBusyAction(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Отправка письма (минимальный ответ / compose)
  // ───────────────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────────
  // Подключение Gmail (OAuth)
  // ───────────────────────────────────────────────────────────────────────────
  const connectGmail = () => {
    if (!FUNCTIONS_BASE) {
      alert("Не задан VITE_SUPABASE_FUNCTIONS_URL/VITE_SUPABASE_URL");
      return;
    }
    window.open(`${FUNCTIONS_BASE}/oauth_google_start`, "_blank", "width=480,height=640");
  };

  // безопасный просмотр HTML (sandbox iframe)
  const iframeRef = useRef(null);
  useEffect(() => {
    if (iframeRef.current && selected?.html != null) {
      // кладём html в srcdoc (так безопаснее и без лишних стилей от страницы)
      iframeRef.current.srcdoc = selected.html || `<pre style="white-space:pre-wrap;font:14px system-ui">${(selected.text||"").replace(/[&<>]/g,s=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[s]))}</pre>`;
    }
  }, [selected?.html, selected?.text]);

  return (
    <div className="mail">
      <div className="mail__header">
        <div className="mail__title">Email</div>

        <div className="mail__actions">
          <div className="mail__search">
            <input
              placeholder="Поиск (синтаксис Gmail: from:, subject:, has:attachment …)"
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
        {!needConnect && <span> (подключено)</span>}
        {needConnect && <span> (не подключено — нажмите «Подключить Gmail»)</span>}
      </div>

      <div className="mail__body">
        {/* Левая колонка — список писем */}
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

        {/* Правая колонка — просмотр письма */}
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
                {/* HTML безопасно через srcdoc в sandbox */}
                <iframe
                  ref={iframeRef}
                  title="email"
                  className="mail__iframe"
                  sandbox="allow-popups allow-same-origin"
                />
              </div>
            </>
          )}
        </section>
      </div>

      {/* Compose minimal */}
      {composeOpen && (
        <div className="mail__modal">
          <div className="mail__modal-inner">
            <div className="mail__modal-head">
              Новое письмо
              <button onClick={() => setComposeOpen(false)}>✕</button>
            </div>
            <div className="mail__modal-body">
              <label>
                Кому
                <input
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  placeholder="email1@example.com, email2@example.com"
                />
              </label>
              <label>
                Тема
                <input
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                />
              </label>
              <label>
                Текст (plain)
                <textarea
                  rows={6}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </label>
              <label>
                HTML (необязательно)
                <textarea
                  rows={6}
                  value={draft.html}
                  onChange={(e) => setDraft({ ...draft, html: e.target.value })}
                  placeholder="<p>Здравствуйте…</p>"
                />
              </label>
            </div>
            <div className="mail__modal-actions">
              <button className="is-primary" disabled={busyAction} onClick={sendMail}>Отправить</button>
              <button onClick={() => setComposeOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* локальные стили */}
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
        .mail__list{
          border:1px solid #e5e7eb;border-radius:12px;background:#fff;overflow:auto;
        }
        .mail__items{list-style:none;margin:0;padding:0}
        .mail__item{padding:10px 12px;border-bottom:1px solid #f3f4f6;cursor:pointer}
        .mail__item:hover{background:#f9fafb}
        .mail__item.is-active{background:#eef2ff}
        .mail__item-subj{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mail__item-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#4b5563;margin-top:4px}
        .mail__item-snippet{font-size:12px;color:#6b7280;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mail__empty,.mail__error{padding:16px;font-size:14px}
        .mail__error{color:#b91c1c}

        .mail__viewer{
          border:1px solid #e5e7eb;border-radius:12px;background:#fff;display:flex;flex-direction:column;overflow:hidden;
        }
        .mail__placeholder{padding:24px;color:#6b7280}
        .mail__viewer-head{padding:14px;border-bottom:1px solid #f3f4f6;display:grid;row-gap:8px}
        .mail__viewer-subj{font-weight:800;font-size:18px}
        .mail__viewer-meta{display:grid;gap:4px;font-size:13px;color:#374151}
        .mail__row span{color:#6b7280;margin-right:6px}
        .mail__viewer-actions{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
        .mail__viewer-actions button{padding:8px 10px;border:1px solid #d1d5db;background:#fff;border-radius:10px;cursor:pointer}
        .mail__viewer-actions button:hover{background:#f9fafb}
        .mail__viewer-body{flex:1;overflow:auto}
        .mail__iframe{width:100%;height:100%;border:0;display:block}

        /* Compose */
        .mail__modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:1000}
        .mail__modal-inner{width:min(760px,92vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;border:1px solid #e5e7eb;box-shadow:0 20px 60px rgba(0,0,0,.25)}
        .mail__modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f3f4f6;font-weight:700}
        .mail__modal-body{display:grid;gap:10px;padding:12px 14px}
        .mail__modal-body label{display:grid;gap:6px;font-size:13px}
        .mail__modal-body input, .mail__modal-body textarea{
          width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:10px; font:inherit;
        }
        .mail__modal-actions{display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #f3f4f6}
        .mail__modal-actions .is-primary{background:#2563eb;color:#fff;border:1px solid #2563eb}
        .mail__modal-actions button{padding:8px 10px;border-radius:10px;border:1px solid #d1d5db;background:#fff;cursor:pointer}
        .mail__modal-actions button:hover{background:#f9fafb}

        @media (max-width: 980px){
          .mail__body{grid-template-columns: 1fr;}
          .mail__list{max-height:40vh}
          .mail__viewer{min-height:40vh}
        }
      `}</style>
    </div>
  );
}
