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
  greenBg: '#eaffea',
  greenBorder: '#bde5bd',
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
    background: colors.greenBg,
    border: `1px solid ${colors.greenBorder}`,
    cursor: 'pointer',
  },
  error: { color: colors.danger, marginTop: 8, whiteSpace: 'pre-wrap' },

  /* RIGHT */
  right: { display: 'flex', flexDirection: 'column', minWidth: 0, background: colors.white },
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
  searchInput: {
    flex: 1,
    outline: 'none',
    border: 'none',
    background: 'transparent',
  },
  listHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    borderBottom: `1px solid ${colors.border}`,
  },
  table: { flex: 1, overflow: 'auto' },
  row: { display: 'grid', gridTemplateColumns: '40px 28px 1fr 180px', padding: '10px 12px', borderBottom: `1px solid ${colors.border}` },
  rowUnread: { background: '#f1f5f9' },
  from: { fontWeight: 600 },
  subject: { color: '#111827' },
  snippet: { color: colors.subtext, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  date: { textAlign: 'right', color: colors.subtext },
  star: (on) => ({ cursor: 'pointer', color: on ? colors.star : colors.muted }),

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
  btn: { padding: '8px 14px', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, cursor: 'pointer' },
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
  const [checked, setChecked] = useState({});
  const [stars, setStars] = useState({});
  const [connected, setConnected] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');

  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const toRef = useRef(); const subjectRef = useRef(); const textRef = useRef(); const filesRef = useRef();

  const API = useMemo(() => ({
    list: `${FUNCTIONS_URL}/gmail_list`,
    send: `${FUNCTIONS_URL}/gmail_send`,
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
      setChecked({});
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
    const t = setInterval(() => {
      if (!w || w.closed) { clearInterval(t); loadList(); }
    }, 800);
  }

  /* ======= UI UTILS ======= */
  function toggleAll(checkedAll) {
    const map = {};
    if (checkedAll) list.forEach(m => (map[m.id] = true));
    setChecked(map);
  }
  function toggleOne(id) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleStar(id) {
    setStars(prev => ({ ...prev, [id]: !prev[id] }));
  }

  /* ======= RENDER ======= */
  return (
    <div style={styles.app}>
      {/* LEFT */}
      <aside style={styles.left}>
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

        <button style={styles.connectBtn} onClick={connectGmail}>
          Подключить Gmail
        </button>

        {!connected && <div style={styles.error}>Gmail не подключён. Нажмите «Подключить Gmail».</div>}
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
          <input
            type="checkbox"
            onChange={(e) => toggleAll(e.target.checked)}
            checked={list.length > 0 && Object.keys(checked).length === list.length}
            aria-label="Выбрать все"
          />
          <span style={{ color: colors.subtext }}>Выбрано: {Object.keys(checked).length}</span>
          <div style={{ marginLeft: 'auto', color: colors.subtext }}>
            {LABELS.find(l => l.id === folder)?.title || ''}
          </div>
        </div>

        {/* Table */}
        <div style={styles.table}>
          {listLoading ? (
            <div style={{ padding: 16, color: colors.subtext }}>Загрузка…</div>
          ) : list.length === 0 ? (
            <div style={{ padding: 16, color: colors.subtext }}>Писем нет</div>
          ) : (
            list.map((m) => (
              <div
                key={m.id}
                style={{
                  ...styles.row,
                  ...(m.unread ? styles.rowUnread : null),
                }}
              >
                <div>
                  <input
                    type="checkbox"
                    checked={!!checked[m.id]}
                    onChange={() => toggleOne(m.id)}
                    aria-label="select"
                  />
                </div>

                <div
                  title={stars[m.id] ? 'Снять звёздочку' : 'Пометить звёздочкой'}
                  onClick={() => toggleStar(m.id)}
                  style={styles.star(!!stars[m.id])}
                >
                  ★
                </div>

                <div style={{ minWidth: 0 }}>
                  <span style={styles.from}>{m.from || '(без отправителя)'}</span>
                  <span style={styles.snippet}>
                    &nbsp;—&nbsp;
                    <span style={styles.subject}>{m.subject || '(без темы)'}</span>
                    &nbsp;{m.snippet || ''}
                  </span>
                </div>

                <div style={styles.date}>
                  {m.date ? new Date(m.date).toLocaleString() : ''}
                </div>
              </div>
            ))
          )}
        </div>
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
    </div>
  );
}
