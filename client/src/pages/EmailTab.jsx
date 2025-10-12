import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

// ── ENV для CRA
const SUPABASE_URL = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/+$/, "");
const FUNCTIONS_BASE =
  (process.env.REACT_APP_SUPABASE_FUNCTIONS_URL || "").replace(/\/+$/, "") ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "");

// общий ящик
const SHARED_EMAIL = "simscope.office@gmail.com";

// ── Простые «вшитые» шаблоны и подпись (редактируйте здесь один раз)
const SIGNATURE_TEXT =
  "--\nSim Scope — HVAC\n+1 (555) 123-4567\nsimscope.office@gmail.com";

const TEMPLATES = [
  {
    id: "thanks",
    name: "Спасибо за обращение",
    subject: "Спасибо за обращение",
    text:
      "Здравствуйте!\n\nСпасибо за обращение. Мы получили ваш запрос и вернёмся с ответом в ближайшее время.\n\nХорошего дня!",
  },
  {
    id: "invoice",
    name: "Счёт на обслуживание",
    subject: "Счёт на обслуживание",
    text:
      "Здравствуйте!\n\nВысылаем счёт за выполненное обслуживание. Если будут вопросы — просто ответьте на это письмо.",
  },
];

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleString();
};
const toArr = (v) => (Array.isArray(v) ? v : (v || "").split(/[,\s;]+/).filter(Boolean));

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

  const needConnect = useMemo(() => !FUNCTIONS_BASE || errList === "MAIL_ACCOUNT_NOT_FOUND", [errList]);

  // ── общий helper для Edge-функций
  const api = async (path, payload) => {
    if (!FUNCTIONS_BASE) throw new Error("Не задан URL функций");
    const r = await fetch(`${FUNCTIONS_BASE}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload || {}),
    });
    return r;
  };

  // ── список
  const loadList = async (opts = {}) => {
    setLoadingList(true);
    setErrList(null);
    try {
      const r = await api("gmail_list", {
        shared_email: SHARED_EMAIL,
        q: opts.q ?? q,
        pageToken: opts.pageToken ?? null,
      });
      if (r.status === 404) {
        const t = await r.text();
        if (t.includes("MAIL_ACCOUNT_NOT_FOUND")) setErrList("MAIL_ACCOUNT_NOT_FOUND");
        else setErrList(t || "Not found");
        setList({ items: [], nextPageToken: null });
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setList({ items: j.items || [], nextPageToken: j.nextPageToken || null });
    } catch (e) {
      setErrList(e?.message || "Failed to fetch");
      setList({ items: [], nextPageToken: null });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [FUNCTIONS_BASE]);

  // ── письмо
  const loadMessage = async (id) => {
    if (!id) return;
    setLoadingMsg(true);
    setErrMsg(null);
    setSelected(null);
    try {
      const r = await api("gmail_get", { shared_email: SHARED_EMAIL, message_id: id });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setSelected(j);
    } catch (e) {
      setErrMsg(e?.message || "Failed to fetch");
    } finally {
      setLoadingMsg(false);
    }
  };

  // ── пометки: только прочитано/непрочитано (БЕЗ удаления)
  const modify = async (id, action) => {
    if (!id) return;
    if (!["read", "unread"].includes(action)) return; // страховка
    setBusyAction(true);
    try {
      const r = await api("gmail_modify", { shared_email: SHARED_EMAIL, message_id: id, action });
      if (!r.ok) throw new Error(await r.text());
      await loadList();
      if (selected?.id === id) setSelected({ ...selected, isUnread: action === "unread" });
    } catch (e) {
      alert(e?.message || "Ошибка операции");
    } finally {
      setBusyAction(false);
    }
  };

  // ── скачивание вложений
  const downloadAttachment = async (att) => {
    try {
      const r = await api("gmail_attachment", {
        message_id: selected.id,
        attachment_id: att.attachmentId,
        filename: att.filename,
        access_token: selected.access_token, // обычно возвращается из gmail_get
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = att.filename || "file";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      alert(e?.message || "Не удалось скачать файл");
    }
  };

  // ── Compose (plain only) + шаблоны + вложения, подпись добавляем автоматически
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState({ to: "", cc: "", bcc: "", subject: "", text: "", attachments: [] });
  const fileInputRef = useRef(null);

  const openCompose = (prefill = {}) => {
    setDraft({
      to: prefill.to || "",
      cc: prefill.cc || "",
      bcc: prefill.bcc || "",
      subject: prefill.subject || "",
      text: prefill.text || "",
      attachments: [],
    });
    setComposeOpen(true);
  };

  const openReply = () => {
    if (!selected) return;
    openCompose({
      to: selected.from || "",
      subject: selected.subject?.startsWith("Re:") ? selected.subject : `Re: ${selected.subject || ""}`,
      text: `\n\n----- Original message -----\n${selected.text || ""}`,
    });
  };

  const openReplyAll = () => {
    if (!selected) return openReply();
    const dedup = new Set([
      selected.from,
      ...(selected.to || []),
      ...(selected.cc || []),
    ].filter(Boolean));
    dedup.delete(SHARED_EMAIL);
    openCompose({
      to: Array.from(dedup).join(", "),
      subject: selected.subject?.startsWith("Re:") ? selected.subject : `Re: ${selected.subject || ""}`,
      text: `\n\n----- Original message -----\n${selected.text || ""}`,
    });
  };

  const openForward = () => {
    if (!selected) return;
    openCompose({
      subject: selected.subject?.startsWith("Fwd:") ? selected.subject : `Fwd: ${selected.subject || ""}`,
      text: `\n\n----- Forwarded message -----\nFrom: ${selected.from}\nDate: ${fmtDate(selected.date_human)}\nTo: ${(selected.to || []).join(", ")}\n\n${selected.text || ""}`,
    });
  };

  const applyTemplate = (tplId) => {
    const t = TEMPLATES.find((x) => x.id === tplId);
    if (!t) return;
    setDraft((d) => ({
      ...d,
      subject: d.subject || t.subject || "",
      text: (t.text || "") + (d.text ? `\n\n${d.text}` : ""),
    }));
  };

  const pickFiles = () => fileInputRef.current?.click();
  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    const mapped = await Promise.all(
      files.map(
        (f) =>
          new Promise((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => {
              const base64 = String(rd.result).split(",")[1] || "";
              resolve({
                filename: f.name,
                mimeType: f.type || "application/octet-stream",
                base64,
              });
            };
            rd.onerror = reject;
            rd.readAsDataURL(f);
          })
      )
    );
    setDraft((d) => ({ ...d, attachments: [...d.attachments, ...mapped] }));
    e.target.value = "";
  };

  const sendMail = async () => {
    const to = toArr(draft.to),
      cc = toArr(draft.cc),
      bcc = toArr(draft.bcc);
    if (!to.length) return alert("Укажите получателя");

    // автоматически приклеиваем подпись (один раз)
    const withSign = draft.text?.includes(SIGNATURE_TEXT)
      ? draft.text
      : (draft.text ? `${draft.text}\n\n${SIGNATURE_TEXT}` : SIGNATURE_TEXT);

    setBusyAction(true);
    try {
      const r = await api("gmail_send", {
        shared_email: SHARED_EMAIL,
        from: SHARED_EMAIL,
        to,
        cc,
        bcc,
        subject: draft.subject || "",
        text: withSign,
        html: "", // HTML не используем
        attachments: draft.attachments || [],
      });
      if (!r.ok) throw new Error(await r.text());
      setComposeOpen(false);
      setDraft({ to: "", cc: "", bcc: "", subject: "", text: "", attachments: [] });
      await loadList();
    } catch (e) {
      alert(e?.message || "Не удалось отправить");
    } finally {
      setBusyAction(false);
    }
  };

  // ── OAuth connect
  const connectGmail = () => {
    if (!FUNCTIONS_BASE) return alert("Не задан REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_FUNCTIONS_URL");
    window.open(`${FUNCTIONS_BASE}/oauth_google_start`, "_blank", "width=480,height=640");
  };

  // ── безопасный просмотр html/text
  const iframeRef = useRef(null);
  useEffect(() => {
    if (!iframeRef.current || !selected) return;
    const safeText = (selected.text || "").replace(/[&<>]/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[s]));
    const html = selected.html && selected.html.trim().length
      ? selected.html
      : `<pre style="white-space:pre-wrap;font:14px system-ui">${safeText}</pre>`;
    iframeRef.current.srcdoc = html;
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
          <button onClick={() => openCompose()}>Написать</button>

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
        {/* список */}
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

        {/* просмотр */}
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
                  {!!selected.cc?.length && <div className="mail__row"><span>Копия:</span> {selected.cc.join(", ")}</div>}
                  <div className="mail__row"><span>Дата:</span> {fmtDate(selected.date_human)}</div>
                </div>

                <div className="mail__viewer-actions">
                  <button onClick={openReply}>Ответить</button>
                  <button onClick={openReplyAll}>Ответить всем</button>
                  <button onClick={openForward}>Переслать</button>
                  <button disabled={busyAction} onClick={() => modify(selected.id, "read")}>Прочитано</button>
                  <button disabled={busyAction} onClick={() => modify(selected.id, "unread")}>Не прочитано</button>
                  {/* УДАЛЕНИЕ УБРАНО */}
                </div>

                {!!selected.attachments?.length && (
                  <div className="mail__atts">
                    Вложения:&nbsp;
                    {selected.attachments.map((a, i) => (
                      <button key={i} onClick={() => downloadAttachment(a)}>
                        {a.filename || "file"} ({Math.round((a.size || 0)/1024)} кБ)
                      </button>
                    ))}
                  </div>
                )}
              </header>

              <div className="mail__viewer-body">
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

      {/* Compose (plain + шаблоны + вложения; подпись добавится автоматически) */}
      {composeOpen && (
        <div className="mail__modal">
          <div className="mail__modal-inner">
            <div className="mail__modal-head">
              Новое письмо
              <button onClick={() => setComposeOpen(false)}>✕</button>
            </div>
            <div className="mail__modal-body">
              <label>Кому
                <input
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  placeholder="email1@example.com, email2@example.com"
                />
              </label>
              <label>Копия (CC)
                <input value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} />
              </label>
              <label>Скрытая копия (BCC)
                <input value={draft.bcc} onChange={(e) => setDraft({ ...draft, bcc: e.target.value })} />
              </label>
              <label>Тема
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </label>

              <div className="mail__tpls">
                <select onChange={(e) => applyTemplate(e.target.value)} defaultValue="">
                  <option value="" disabled>Вставить шаблон…</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button onClick={pickFiles}>+ Файл</button>
                <input type="file" ref={fileInputRef} multiple hidden onChange={onFiles} />
              </div>

              {!!draft.attachments.length && (
                <div className="mail__attlist">
                  {draft.attachments.map((a, i) => (
                    <div key={i} className="mail__att">
                      {a.filename}
                      <button
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            attachments: d.attachments.filter((_, k) => k !== i),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label>Текст (plain)
                <textarea
                  rows={10}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  placeholder="Напишите сообщение…"
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
        .mail__item-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#4b5563;margin-top:4px}
        .mail__item-snippet{font-size:12px;color:#6b7280;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mail__empty,.mail__error{padding:16px;font-size:14px}
        .mail__error{color:#b91c1c}

        .mail__viewer{border:1px solid #e5e7eb;border-radius:12px;background:#fff;display:flex;flex-direction:column;overflow:hidden}
        .mail__placeholder{padding:24px;color:#6b7280}
        .mail__viewer-head{padding:14px;border-bottom:1px solid #f3f4f6;display:grid;row-gap:8px}
        .mail__viewer-subj{font-weight:800;font-size:18px}
        .mail__viewer-meta{display:grid;gap:4px;font-size:13px;color:#374151}
        .mail__row span{color:#6b7280;margin-right:6px}
        .mail__viewer-actions{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
        .mail__viewer-actions button{padding:8px 10px;border:1px solid #d1d5db;background:#fff;border-radius:10px;cursor:pointer}
        .mail__viewer-actions button:hover{background:#f9fafb}
        .mail__atts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
        .mail__atts button{padding:4px 8px;border:1px solid #d1d5db;border-radius:10px;background:#fff}

        .mail__viewer-body{flex:1;overflow:auto}
        .mail__iframe{width:100%;height:100%;border:0;display:block}

        .mail__modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:1000}
        .mail__modal-inner{width:min(860px,92vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;border:1px solid #e5e7eb;box-shadow:0 20px 60px rgba(0,0,0,.25)}
        .mail__modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f3f4f6;font-weight:700}
        .mail__modal-body{display:grid;gap:10px;padding:12px 14px}
        .mail__modal-body input, .mail__modal-body textarea, .mail__modal-body select{width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:10px; font:inherit}
        .mail__tpls{display:flex;gap:8px;align-items:center}
        .mail__attlist{display:flex;gap:8px;flex-wrap:wrap}
        .mail__att{display:flex;gap:6px;align-items:center;padding:4px 8px;border:1px solid #e5e7eb;border-radius:10px}
        .mail__modal-actions{display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #f3f4f6}
        .mail__modal-actions .is-primary{background:#2563eb;color:#fff;border:1px solid #2563eb}
        .mail__modal-actions button{padding:8px 10px;border-radius:10px;border:1px solid #d1d5db;background:#fff;cursor:pointer}
        .mail__modal-actions button:hover{background:#f9fafb}

        @media (max-width: 980px){
          .mail__body{grid-template-columns: 1fr}
          .mail__list{max-height:40vh}
          .mail__viewer{min-height:40vh}
        }
      `}</style>
    </div>
  );
}
