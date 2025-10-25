// src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../supabaseClient';

/* ====== КОНСТАНТЫ ====== */
const SIGNATURE =
  `\n\n—\nSim HVAC & Appliance repair\n📍 New York City, NY\n📞 Phone: (929) 412-9042\n🌐 Website: https://appliance-hvac-repair.com\nHVAC • Appliance Repair\nServices Licensed & Insured | Serving NYC and NJ`;

const ACCOUNT_EMAIL = 'simscope.office@gmail.com';

/* ====== СТИЛИ ====== */
const colors = {
  border: '#e5e7eb',
  subtext: '#64748b',
  muted: '#94a3b8',
  bg: '#f8fafc',
  white: '#ffffff',
  blue: '#2563eb',
  danger: 'crimson',
};

const styles = {
  app: { display: 'grid', gridTemplateColumns: '260px 1fr', height: 'calc(100vh - 120px)' },

  /* LEFT */
  left: {
    borderRight: `1px solid ${colors.border}`,
    background: colors.bg,
    padding: 12,
    overflow: 'auto',
  },
  account: { fontSize: 13, color: colors.subtext, marginBottom: 8, paddingLeft: 4 },
  compose: {
    display: 'inline-flex', gap: 8, alignItems: 'center',
    padding: '10px 16px', borderRadius: 24, background: colors.white,
    border: `1px solid ${colors.border}`, cursor: 'pointer',
    fontWeight: 600, marginBottom: 12,
  },
  menu: { display: 'flex', flexDirection: 'column', gap: 2 },
  menuItem: (active) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', borderRadius: 20, cursor: 'pointer',
    background: active ? '#e0ecff' : 'transparent',
    color: active ? '#1d4ed8' : '#111827',
  }),
  menuIcon: { width: 18, textAlign: 'center' },
  connectBtn: {
    marginTop: 12, padding: '8px 12px', borderRadius: 10,
    background: '#eaffea', border: '1px solid #bde5bd', cursor: 'pointer',
  },
  error: { color: colors.danger, marginTop: 8, whiteSpace: 'pre-wrap' },

  /* RIGHT */
  right: { display: 'flex', flexDirection: 'column', minWidth: 0, background: colors.white },
  topbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: 12, borderBottom: `1px solid ${colors.border}`,
  },
  search: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
    background: colors.bg, border: `1px solid ${colors.border}`,
    borderRadius: 24, padding: '8px 12px',
  },
  searchInput: { flex: 1, outline: 'none', border: 'none', background: 'transparent' },
  listHead: { padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, color: colors.subtext },

  table: { flex: 1, overflow: 'auto' },
  sectionTitle: { padding: '10px 12px', fontWeight: 700, color: '#0f172a', background: '#f9fbff', borderBottom: `1px solid ${colors.border}` },

  row: {
    display: 'grid', gridTemplateColumns: '1fr 180px',
    padding: '12px', borderBottom: `1px solid ${colors.border}`,
    cursor: 'pointer',
  },
  from: { fontWeight: 600, marginRight: 8 },
  subject: { color: '#111827' },
  snippet: { color: colors.subtext, marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  date: { textAlign: 'right', color: colors.subtext },

  /* MODALS */
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },

  // ✨ Изменено: модалка чтения стала колонкой с ограничением по высоте
  readModal: {
    width: 860,
    maxWidth: '95vw',
    background: colors.white,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '85vh', // чтобы помещалась на экран
  },

  // ✨ Новое: прокручиваемая область тела письма
  readBody: {
    flex: 1,
    overflow: 'auto',
    marginTop: 8,
    paddingRight: 4,
    borderTop: `1px solid ${colors.border}`,
  },

  composeModal: { width: 720, maxWidth: '90vw', background: colors.white, borderRadius: 12, border: `1px solid ${colors.border}`, padding: 16 },
  formRow: { marginBottom: 10 },
  input: { width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${colors.border}` },
  btnLine: { display: 'flex', gap: 8, marginTop: 8 },
  btnPrimary: { padding: '8px 14px', borderRadius: 10, background: colors.blue, color: '#fff', border: 'none', cursor: 'pointer' },
  btn: { padding: '8px 14px', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, cursor: 'pointer' },
  signatureHint: { fontSize: 12, color: colors.subtext, marginTop: 6, whiteSpace: 'pre-wrap' },

  // ✨ Новое: обёртка для HTML письма (ломаем длинные слова, сжимаем контент)
  htmlContainer: {
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    lineHeight: 1.5,
  },
};
/* ================== */

const LABELS = [
  { id: 'inbox', title: 'Входящие', icon: '📥' },
  { id: 'sent', title: 'Отправленные', icon: '📤' },
  { id: 'drafts', title: 'Черновики', icon: '📝' },
  { id: 'spam', title: 'Спам', icon: '🚫' },
];

export default function EmailTab() {
  /* ======= STATE ======= */
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [connected, setConnected] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');

  // compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [includeSignature, setIncludeSignature] = useState(true);
  const toRef = useRef(); const subjectRef = useRef(); const textRef = useRef(); const filesRef = useRef();

  // read
  const [readOpen, setReadOpen] = useState(false);
  const [current, setCurrent] = useState(null);   // {id, from, to, subject, date, text/html, attachments}
  const [reading, setReading] = useState(false);

  const API = useMemo(() => ({
    list: `${FUNCTIONS_URL}/gmail_list`,
    send: `${FUNCTIONS_URL}/gmail_send`,
    get:  `${FUNCTIONS_URL}/gmail_get`,
    oauthStart: `${FUNCTIONS_URL}/oauth_google_start`,
  }), []);

  /* ======= HELPERS ======= */
  async function authedFetch(url, options = {}) {
    const { data: { session } = {} } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Нет сессии Supabase. Войдите и повторите.');
    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
  }

  // формат даты: для сегодняшних показываем только время, для остальных — локальную дату
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (d >= startOfToday && d <= endOfToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString();
  };

  // группировка: сегодня / ранее (только для inbox)
  const { todayList, olderList } = useMemo(() => {
    if (folder !== 'inbox') return { todayList: [], olderList: [] };

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const safeList = Array.isArray(list) ? list : [];

    const t = [];
    const o = [];
    for (const m of safeList) {
      const d = m?.date ? new Date(m.date) : null;
      if (d && d >= startOfToday && d <= endOfToday) t.push(m);
      else o.push(m);
    }

    // сортировка по убыванию даты
    const byDesc = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);

    return { todayList: t.sort(byDesc), olderList: o.sort(byDesc) };
  }, [list, folder]);

  /* ======= DATA LOAD ======= */
  async function loadList() {
    try {
      setError('');
      setListLoading(true);
      const r = await authedFetch(API.list, { method: 'POST', body: JSON.stringify({ folder, q }) });
      if (!r.ok) {
        const txt = await r.text();
        if (r.status === 404 && txt.includes('MAIL_ACCOUNT_NOT_FOUND')) {
          setConnected(false);
          throw new Error('Аккаунт Gmail не привязан.');
        }
        throw new Error(`gmail_list: ${r.status} ${txt}`);
      }
      const data = await r.json();
      const emails = Array.isArray(data?.emails) ? data.emails : [];
      setList(emails);
      setConnected(true);
    } catch (e) {
      console.error(e);
      setList([]);
      setError(e.message || String(e));
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [folder]);

  /* ======= OPEN / READ ======= */
  async function openMail(id) {
    setCurrent(null);
    setReadOpen(true);
    setReading(true);
    try {
      const r = await authedFetch(API.get, { method: 'POST', body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error(`gmail_get: ${r.status} ${await r.text()}`);
      const data = await r.json();
      setCurrent(data || {});
    } catch (e) {
      console.error(e);
      const m = list.find(x => x.id === id);
      setCurrent({
        id,
        from: m?.from, to: '', subject: m?.subject, date: m?.date,
        text: m?.snippet || '(не удалось загрузить тело письма)',
        attachments: [],
      });
    } finally {
      setReading(false);
    }
  }

  /* ======= SEND ======= */
  async function onSubmit(e) {
    e.preventDefault();
    try {
      setSending(true);
      const to = (toRef.current?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const subject = subjectRef.current?.value || '';
      const baseText = textRef.current?.value || '';

      // Добавляем подпись при отправке (если включена и её ещё нет в тексте)
      const shouldAppend = includeSignature && !baseText.includes('Sim HVAC & Appliance repair');
      const text = shouldAppend ? `${baseText}${SIGNATURE}` : baseText;

      const files = Array.from(filesRef.current?.files || []);
      const attachments = await Promise.all(files.map(f => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onerror = () => rej(new Error('File read error'));
        fr.onload = () => res({ filename: f.name, mimeType: f.type || 'application/octet-stream', base64: btoa(String.fromCharCode(...new Uint8Array(fr.result))) });
        fr.readAsArrayBuffer(f);
      })));

      const r = await authedFetch(API.send, { method: 'POST', body: JSON.stringify({ to, subject, text, attachments }) });
      if (!r.ok) throw new Error(`gmail_send: ${r.status} ${await r.text()}`);
      setComposeOpen(false);
      setFolder('sent');
      await loadList();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setSending(false);
    }
  }

  /* ======= OAUTH ======= */
  function connectGmail() {
    const w = window.open(API.oauthStart, 'oauth_gmail', 'width=600,height=700');
    if (!w) { setError('Разрешите всплывающие окна и попробуйте снова.'); return; }
    const t = setInterval(() => {
      if (!w || w.closed) { clearInterval(t); loadList(); }
    }, 800);
  }

  /* ======= РЕНДЕР ПОЧТОВОЙ СТРОКИ ======= */
  const MailRow = ({ m }) => (
    <div
      key={m.id}
      style={styles.row}
      onClick={() => openMail(m.id)}
      role="button"
      title="Открыть"
    >
      <div style={{ minWidth: 0 }}>
        <span style={styles.from}>{m.from || '(без отправителя)'}</span>
        <span style={styles.subject}>{m.subject || '(без темы)'}</span>
        <span style={styles.snippet}> — {m.snippet || ''}</span>
      </div>
      <div style={styles.date}>
        {fmtDate(m.date)}
      </div>
    </div>
  );

  // ✨ Инлайн-стили для HTML-писем (картинки/таблицы адаптивно)
  const responsiveEmailCss =
    `<style>
      img{max-width:100%;height:auto}
      table{max-width:100%;width:auto;border-collapse:collapse}
      pre{white-space:pre-wrap}
      body{margin:0;padding:0}
    </style>`;

  /* ======= RENDER ======= */
  return (
    <div style={styles.app}>
      {/* LEFT */}
      <aside style={styles.left}>
        <div style={styles.account}>{ACCOUNT_EMAIL}</div>
        <button style={styles.compose} onClick={() => setComposeOpen(true)}>
          <span>✉️</span> <span>Написать</span>
        </button>

        <nav style={styles.menu}>
          {LABELS.map(l => (
            <div
              key={l.id}
              style={styles.menuItem(folder === l.id)}
              onClick={() => setFolder(l.id)}
              role="button"
            >
              <span style={styles.menuIcon}>{l.icon}</span>
              <span>{l.title}</span>
            </div>
          ))}
        </nav>

        {!connected && (
          <button style={styles.connectBtn} onClick={connectGmail}>
            Подключить Gmail
          </button>
        )}

        {error && <div style={styles.error}>Ошибка: {error}</div>}
      </aside>

      {/* RIGHT */}
      <section style={styles.right}>
        {/* Top bar with search */}
        <div style={styles.topbar}>
          <div style={styles.search}>
            <span>🔎</span>
            <input
              style={styles.searchInput}
              placeholder="Поиск (gmail: from:, subject:, has:attachment …)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadList()}
            />
          </div>
          <button style={styles.btn} onClick={loadList} disabled={listLoading}>
            Обновить
          </button>
        </div>

        {/* List head */}
        <div style={styles.listHead}>
          {LABELS.find(l => l.id === folder)?.title || ''}{q ? ` — поиск: ${q}` : ''}
        </div>

        {/* Table */}
        <div style={styles.table}>
          {listLoading ? (
            <div style={{ padding: 16, color: colors.subtext }}>Загрузка…</div>
          ) : (list.length === 0 ? (
            <div style={{ padding: 16, color: colors.subtext }}>Писем нет</div>
          ) : (
            folder === 'inbox' && !q
              ? (
                <>
                  <div style={styles.sectionTitle}>
                    Сегодня {todayList.length ? `(${todayList.length})` : ''}
                  </div>
                  {todayList.length === 0 ? (
                    <div style={{ padding: 12, color: colors.muted }}>Нет писем за сегодня</div>
                  ) : (
                    todayList.map(m => <MailRow key={m.id} m={m} />)
                  )}

                  <div style={styles.sectionTitle} >
                    Ранее {olderList.length ? `(${olderList.length})` : ''}
                  </div>
                  {olderList.length === 0 ? (
                    <div style={{ padding: 12, color: colors.muted }}>Старых писем нет</div>
                  ) : (
                    olderList.map(m => <MailRow key={m.id} m={m} />)
                  )}
                </>
              )
              : (
                // Для остальных папок или когда идёт поиск — обычный плоский список
                list
                  .slice() // копия
                  .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                  .map(m => <MailRow key={m.id} m={m} />)
              )
          ))}
        </div>
      </section>

      {/* COMPOSE MODAL */}
      {composeOpen && (
        <div style={styles.overlay} onClick={() => setComposeOpen(false)}>
          <div style={styles.composeModal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Новое письмо</h3>
            <form onSubmit={onSubmit}>
              <div style={styles.formRow}>
                <div>От</div>
                <input value={ACCOUNT_EMAIL} disabled style={styles.input} />
              </div>
              <div style={styles.formRow}>
                <div>Кому (через запятую)</div>
                <input ref={toRef} style={styles.input} placeholder="user@example.com, ..." />
              </div>
              <div style={styles.formRow}>
                <div>Тема</div>
                <input ref={subjectRef} style={styles.input} />
              </div>
              <div style={styles.formRow}>
                <div>Текст</div>
                <textarea ref={textRef} rows={8} style={styles.input} placeholder="Сообщение..." />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.target.checked)}
                  />
                  Добавлять подпись компании
                </label>
                <div style={styles.signatureHint}>
                  Подпись будет добавлена в конец письма:
                  {SIGNATURE}
                </div>
              </div>
              <div style={styles.formRow}>
                <div>Вложения</div>
                <input ref={filesRef} type="file" multiple />
              </div>
              <div style={styles.btnLine}>
                <button type="submit" style={styles.btnPrimary} disabled={sending}>
                  Отправить
                </button>
                <button type="button" style={styles.btn} onClick={() => setComposeOpen(false)} disabled={sending}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* READ MODAL */}
      {readOpen && (
        <div style={styles.overlay} onClick={() => setReadOpen(false)}>
          <div style={styles.readModal} onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>{current?.subject || '(без темы)'}</h3>
              <button style={styles.btn} onClick={() => setReadOpen(false)}>Закрыть</button>
            </div>

            {/* meta */}
            <div style={{ color: colors.subtext }}>
              <div><b>От:</b> {current?.from || ''}</div>
              {current?.to ? <div><b>Кому:</b> {current.to}</div> : null}
              <div><b>Дата:</b> {current?.date ? new Date(current.date).toLocaleString() : ''}</div>
            </div>

            {/* ✨ ПРОКРУЧИВАЕМОЕ ТЕЛО ПИСЬМА */}
            <div style={styles.readBody}>
              {reading ? (
                <div style={{ color: colors.subtext }}>Загрузка письма…</div>
              ) : current?.html ? (
                <div
                  style={styles.htmlContainer}
                  dangerouslySetInnerHTML={{
                    __html: responsiveEmailCss + current.html
                  }}
                />
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap' }}>{current?.text || '(пустое письмо)'}</pre>
              )}

              {Array.isArray(current?.attachments) && current.attachments.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <b>Вложения:</b>
                  <ul>
                    {current.attachments.map((a, i) => (
                      <li key={i}>{a.filename} {a.size ? `(${a.size}B)` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
