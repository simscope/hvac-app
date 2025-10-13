import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../supabaseClient';

/* ====== СТИЛИ ====== */
const colors = {
  border: '#e5e7eb',
  subtext: '#64748b',
  muted: '#94a3b8',
  bg: '#f8fafc',
  white: '#ffffff',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
  danger: 'crimson',
  star: '#f59e0b',
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
  account: { fontSize: 13, color: colors.subtext, margin: '4px 0 10px' },
  compose: {
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    padding: '10px 16px',
    borderRadius: 24,
    background: colors.white,
    border: `1px solid ${colors.border}`,
    cursor: 'pointer',
    fontWeight: 600,
    marginBottom: 12,
  },
  menu: { display: 'flex', flexDirection: 'column', gap: 2 },
  menuItem: (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 20,
    cursor: 'pointer',
    background: active ? '#e0ecff' : 'transparent',
    color: active ? colors.blue : '#111827',
    border: '1px solid transparent',
  }),
  menuIcon: { width: 18, textAlign: 'center' },
  connectBtn: {
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 10,
    background: '#eaffea',
    border: `1px solid #bde5bd`,
    cursor: 'pointer',
  },
  error: { color: colors.danger, marginTop: 8, whiteSpace: 'pre-wrap' },

  /* RIGHT */
  right: { display: 'grid', gridTemplateRows: 'auto auto 1fr', minWidth: 0, background: colors.white },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottom: `1px solid ${colors.border}`,
  },
  search: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: 24,
    padding: '8px 12px',
  },
  searchInput: { flex: 1, outline: 'none', border: 'none', background: 'transparent' },
  btn: { padding: '8px 14px', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, cursor: 'pointer' },

  header: { padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, color: colors.subtext },

  table: { display: 'grid', gridTemplateColumns: '1fr 180px', overflow: 'auto' },
  row: { display: 'contents', borderBottom: `1px solid ${colors.border}` },
  cellMain: { padding: '10px 12px', borderBottom: `1px solid ${colors.border}`, display: 'flex', minWidth: 0 },
  from: { fontWeight: 600 },
  subject: { color: '#111827', marginLeft: 8 },
  snippet: { color: colors.subtext, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellDate: { padding: '10px 12px', borderBottom: `1px solid ${colors.border}`, color: colors.subtext, textAlign: 'right' },
  rowHover: { background: '#f1f5f9', cursor: 'pointer' },

  /* READER */
  reader: { display: 'grid', gridTemplateRows: 'auto auto 1fr', height: '100%', background: colors.white },
  readerHead: { padding: 16, borderBottom: `1px solid ${colors.border}` },
  readerMeta: { padding: '8px 16px', borderBottom: `1px solid ${colors.border}`, color: colors.subtext },
  readerBody: { padding: 16, overflow: 'auto' },

  /* MODAL */
  modalWrap: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  modal: { width: 720, maxWidth: '90vw', background: colors.white, borderRadius: 12, border: `1px solid ${colors.border}`, padding: 16 },
  formRow: { marginBottom: 10 },
  input: { width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${colors.border}` },
  btnLine: { display: 'flex', gap: 8, marginTop: 8 },
  btnPrimary: { padding: '8px 14px', borderRadius: 10, background: colors.blue, color: '#fff', border: 'none', cursor: 'pointer' },
};

/* ====== МЕНЮ ====== */
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

  // чтение письма
  const [openId, setOpenId] = useState(null);
  const [openMsg, setOpenMsg] = useState(null);
  const [openLoading, setOpenLoading] = useState(false);

  // compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const toRef = useRef(); const subjectRef = useRef(); const textRef = useRef(); const filesRef = useRef();

  const API = useMemo(() => ({
    list: `${FUNCTIONS_URL}/gmail_list`,
    send: `${FUNCTIONS_URL}/gmail_send`,
    get: `${FUNCTIONS_URL}/gmail_get`,
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

  /* ======= DATA LOAD ======= */
  async function loadList() {
    try {
      setError('');
      setListLoading(true);
      setOpenId(null); setOpenMsg(null);
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

  async function openMessage(id) {
    try {
      setOpenLoading(true);
      setOpenId(id);
      setOpenMsg(null);
      const r = await authedFetch(API.get, { method: 'POST', body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error(`gmail_get: ${r.status} ${await r.text()}`);
      const data = await r.json();
      setOpenMsg(data); // { id, from, to, subject, date, text, html }
    } catch (e) {
      alert(e.message || String(e));
      setOpenId(null); setOpenMsg(null);
    } finally {
      setOpenLoading(false);
    }
  }

  /* ======= SEND ======= */
  async function onSubmit(e) {
    e.preventDefault();
    try {
      setSending(true);
      const to = (toRef.current?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const subject = subjectRef.current?.value || '';
      const text = textRef.current?.value || '';
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
    const t = setInterval(() => { if (!w || w.closed) { clearInterval(t); loadList(); } }, 800);
  }

  /* ======= RENDER ======= */
  const currentTitle = LABELS.find(l => l.id === folder)?.title || '';

  // список или читатель
  const rightList = (
    <>
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
        <button style={styles.btn} onClick={loadList} disabled={listLoading}>Обновить</button>
      </div>

      <div style={styles.header}>{currentTitle}</div>

      <div style={{ overflow: 'auto' }}>
        {listLoading ? (
          <div style={{ padding: 16, color: colors.subtext }}>Загрузка…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 16, color: colors.subtext }}>Писем нет</div>
        ) : (
          <div style={styles.table}>
            {list.map(m => (
              <React.Fragment key={m.id}>
                <div
                  style={{ ...styles.cellMain, ...styles.rowHover }}
                  onClick={() => openMessage(m.id)}
                  title="Открыть"
                >
                  <span style={styles.from}>{m.from || '(без отправителя)'}</span>
                  <span style={styles.subject}>{m.subject || '(без темы)'}</span>
                  <span style={styles.snippet}>— {m.snippet || ''}</span>
                </div>
                <div style={{ ...styles.cellDate, ...styles.rowHover }} onClick={() => openMessage(m.id)}>
                  {m.date ? new Date(m.date).toLocaleString() : ''}
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const rightReader = (
    <div style={styles.reader}>
      <div style={styles.readerHead}>
        <button style={styles.btn} onClick={() => { setOpenId(null); setOpenMsg(null); }}>← Назад</button>
      </div>
      <div style={styles.readerMeta}>
        {openLoading ? 'Загрузка…' : (
          openMsg ? (
            <>
              <div><b>Тема:</b> {openMsg.subject || '(без темы)'}</div>
              <div><b>От:</b> {openMsg.from}</div>
              <div><b>Кому:</b> {openMsg.to}</div>
              <div><b>Дата:</b> {openMsg.date ? new Date(openMsg.date).toLocaleString() : ''}</div>
            </>
          ) : null
        )}
      </div>
      <div style={styles.readerBody}>
        {openLoading ? null : openMsg?.html
          ? <div dangerouslySetInnerHTML={{ __html: openMsg.html }} />
          : <pre style={{ whiteSpace: 'pre-wrap' }}>{openMsg?.text || ''}</pre>}
      </div>
    </div>
  );

  return (
    <div style={styles.app}>
      {/* LEFT */}
      <aside style={styles.left}>
        <div style={styles.account}>simscope.office@gmail.com</div>
        <button style={styles.compose} onClick={() => setComposeOpen(true)}>
          <span>✉️</span> <span>Написать</span>
        </button>

        <nav style={styles.menu}>
          {LABELS.map(l => (
            <div key={l.id} style={styles.menuItem(folder === l.id)} onClick={() => setFolder(l.id)} role="button">
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
        {openId ? rightReader : rightList}
      </section>

      {/* COMPOSE MODAL */}
      {composeOpen && (
        <div style={styles.modalWrap} onClick={() => setComposeOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Новое письмо</h3>
            <form onSubmit={onSubmit}>
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
                <textarea ref={textRef} rows={8} style={styles.input} />
              </div>
              <div style={styles.formRow}>
                <div>Вложения</div>
                <input ref={filesRef} type="file" multiple />
              </div>
              <div style={styles.btnLine}>
                <button type="submit" style={styles.btnPrimary} disabled={sending}>Отправить</button>
                <button type="button" style={styles.btn} onClick={() => setComposeOpen(false)} disabled={sending}>Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
