// src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../supabaseClient';

/* ====== КОНСТАНТЫ ====== */
const SIGNATURE =
  `\n\n—\nSim HVAC & Appliance repair\n📍 New York City, NY\n📞 Phone: (929) 412-9042\n🌐 Website: https://appliance-hvac-repair.com\nHVAC • Appliance Repair\nServices Licensed & Insured | Serving NYC and NJ`;

const PAYMENT_OPTIONS =
  `\n\nPayment Options:
💸 Zelle: 929-412-9042
🏦 ACH Transfer
Account number 918130706
Routing number 021000021
💳 Credit/Debit Card (5% processing fee)
🧾 Check
Payable to: Sim Scope Inc.
Mailing address: 1587E 19th St Apt6F Brooklyn, NY 11230`;

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

  sectionTitle: {
    padding: '10px 12px',
    fontWeight: 700,
    color: '#0f172a',
    background: '#f9fbff',
    borderBottom: `1px solid ${colors.border}`
  },

  collapsibleHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    userSelect: 'none',
    background: '#f9fbff',
    borderBottom: `1px solid ${colors.border}`,
    fontWeight: 700,
    color: '#0f172a'
  },
  caret: { width: 18, textAlign: 'center' },

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
  overlayBase: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflow: 'auto',
  },
  // подняли z-index, чтобы быть выше TopNav
  readOverlay: { zIndex: 200 },
  composeOverlay: { zIndex: 210 },

  composeModal: {
    width: 720, maxWidth: '90vw',
    background: colors.white, borderRadius: 12,
    border: `1px solid ${colors.border}`, padding: 16
  },
  readModal: {
    width: 860, maxWidth: '95vw',
    background: colors.white, borderRadius: 12,
    border: `1px solid ${colors.border}`,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '90vh',
  },
  readHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    borderBottom: `1px solid ${colors.border}`,
    paddingBottom: 8,
    position: 'sticky',
    top: 0,
    background: colors.white,
    zIndex: 1,
  },
  readMeta: { color: colors.subtext, margin: '6px 0 8px' },
  readBody: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },

  formRow: { marginBottom: 10 },
  input: { width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${colors.border}` },
  btnLine: { display: 'flex', gap: 8, marginTop: 8 },
  btnPrimary: { padding: '8px 14px', borderRadius: 10, background: colors.blue, color: '#fff', border: 'none', cursor: 'pointer' },
  btn: { padding: '8px 14px', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, cursor: 'pointer' },
  signatureHint: { fontSize: 12, color: colors.subtext, marginTop: 6, whiteSpace: 'pre-wrap' },
};
/* ================== */

const LABELS = [
  { id: 'inbox', title: 'Входящие', icon: '📥' },
  { id: 'sent', title: 'Отправленные', icon: '📤' },
  { id: 'drafts', title: 'Черновики', icon: '📝' },
  { id: 'spam', title: 'Спам', icon: '🚫' },
];

/* ====== INLINE-IMAGES ====== */
function hydrateCidImages(message) {
  if (!message?.html || !Array.isArray(message.attachments)) return message;
  const urlMap = {}; const revoke = [];
  for (const a of message.attachments) {
    if (!a?.contentId || !a?.dataBase64) continue;
    const cid = String(a.contentId).replace(/[<>]/g, '');
    try {
      const bin = atob(a.dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: a.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      urlMap[cid] = url; revoke.push(url);
    } catch {}
  }
  let html = message.html;
  html = html.replace(/src=["']cid:([^"']+)["']/gi, (m, cidRaw) => {
    const key = String(cidRaw).replace(/[<>]/g, '');
    const url = urlMap[key];
    return url ? `src="${url}"` : m;
  });
  return { ...message, html, _blobUrlsToRevoke: revoke };
}

/* ====== HTML WRAP ====== */
const nl2br = (s) => String(s).replace(/\n/g, '<br>');
function wrapHtmlTimes(contentHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Email</title>
<style>
body{font-family:"Times New Roman",Times,serif;font-size:14px;line-height:1.45;color:#111}
a{color:#1d4ed8}p{margin:0 0 10px}
</style></head><body>${contentHtml}</body></html>`;
}

/* ====== HELPERS ====== */
function parseEmailAddress(display) {
  if (!display) return '';
  const m = String(display).match(/<([^>]+)>/);
  return m ? m[1].trim() : String(display).trim();
}
function htmlToText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = tmp.innerText || tmp.textContent || '';
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function quoteBlock(s) {
  return String(s).split('\n').map(l => (l.trim() ? '> ' + l : '>')).join('\n');
}

/* ====== ГРУППИРОВКА ====== */
function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthTitle(d) { return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); }
function buildGroups(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  const { start, end } = todayRange();
  const today = []; const map = new Map();
  for (const m of arr) {
    const dd = m?.date ? new Date(m.date) : null;
    if (!dd) continue;
    if (dd >= start && dd <= end) { today.push(m); continue; }
    const key = monthKey(dd);
    if (!map.has(key)) {
      map.set(key, { key, title: monthTitle(dd), items: [], sortTime: new Date(dd.getFullYear(), dd.getMonth(), 1).getTime() });
    }
    map.get(key).items.push(m);
  }
  const months = Array.from(map.values()).sort((a,b)=>b.sortTime-a.sortTime);
  return { today, months };
}

export default function EmailTab() {
  /* STATE */
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [connected, setConnected] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [appending, setAppending] = useState(false);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [error, setError] = useState('');

  // compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [includePaymentOptions, setIncludePaymentOptions] = useState(false);
  const toRef = useRef(); const subjectRef = useRef(); const textRef = useRef(); const filesRef = useRef();

  // read
  const [readOpen, setReadOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const [reading, setReading] = useState(false);
  const readBodyRef = useRef(null);

  // ► кэш получателей для отправленных
  const [recipients, setRecipients] = useState({}); // { [id]: "to@addr, ..." }

  // ► по умолчанию месяцы закрыты
  const [expandedByFolder, setExpandedByFolder] = useState({
    inbox: new Set(),
    sent: new Set(),
  });

  const API = useMemo(() => ({
    list: `${FUNCTIONS_URL}/gmail_list`,
    send: `${FUNCTIONS_URL}/gmail_send`,
    get:  `${FUNCTIONS_URL}/gmail_get`,
    oauthStart: `${FUNCTIONS_URL}/oauth_google_start`,
  }), []);

  /* DATA */
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

  async function loadList({ append = false, pageToken = null } = {}) {
    try {
      setError('');
      if (append) setAppending(true); else { setListLoading(true); setNextPageToken(null); }

      const r = await authedFetch(API.list, {
        method: 'POST',
        body: JSON.stringify({ folder, q, pageToken }),
      });

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
      const token = data?.nextPageToken || null;

      if (append) {
        setList(prev => [...prev, ...emails]);
      } else {
        setList(emails);
      }
      setNextPageToken(token);
      setConnected(true);
    } catch (e) {
      console.error(e);
      if (!append) setList([]);
      setError(e.message || String(e));
    } finally {
      if (append) setAppending(false); else setListLoading(false);
    }
  }

  // при смене папки или поисковой строки — загружаем первую страницу
  useEffect(() => {
    loadList({ append: false, pageToken: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, q]);

  // ► лениво догружаем "Кому" для отправленных, если в списке поле пустое
  useEffect(() => {
    if (folder !== 'sent' || !Array.isArray(list) || list.length === 0) return;
    const need = list.filter(m => !m.to && !recipients[m.id]).slice(0, 25);
    if (need.length === 0) return;

    (async () => {
      try {
        const pairs = await Promise.all(
          need.map(async (m) => {
            try {
              const r = await authedFetch(API.get, { method: 'POST', body: JSON.stringify({ id: m.id }) });
              if (!r.ok) throw new Error(await r.text());
              const data = await r.json();
              return [m.id, data?.to || ''];
            } catch {
              return [m.id, ''];
            }
          })
        );
        setRecipients(prev => {
          const next = { ...prev };
          for (const [id, to] of pairs) if (to) next[id] = to;
          return next;
        });
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, list]);

  /* OPEN / READ */
  async function openMail(id) {
    setCurrent(null); setReadOpen(true); setReading(true);
    try {
      const r = await authedFetch(API.get, { method: 'POST', body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error(`gmail_get: ${r.status} ${await r.text()}`);
      const data = await r.json();
      setCurrent(hydrateCidImages(data || {}));
    } catch (e) {
      console.error(e);
      const m = list.find(x => x.id === id);
      setCurrent({
        id,
        from: m?.from,
        to: recipients[id] || m?.to || '',
        subject: m?.subject,
        date: m?.date,
        text: m?.snippet || '(не удалось загрузить тело письма)',
        attachments: []
      });
    } finally { setReading(false); }
  }
  useEffect(() => { if (readOpen && readBodyRef.current) readBodyRef.current.scrollTop = 0; }, [readOpen, current, reading]);

  function openComposerWith({ to = '', subject = '', body = '' } = {}) {
    if (readOpen) setReadOpen(false);
    setTimeout(() => {
      setComposeOpen(true);
      setTimeout(() => {
        if (toRef.current) toRef.current.value = to;
        if (subjectRef.current) subjectRef.current.value = subject;
        if (textRef.current) textRef.current.value = body;
      }, 0);
    }, 0);
  }

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const { start, end } = todayRange();
    return d >= start && d <= end
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString();
  };

  function onReply() {
    const m = current; if (!m) return;
    const to = parseEmailAddress(m.from);
    const subj = (m.subject || ''); const subject = subj.toLowerCase().startsWith('re:') ? subj : `Re: ${subj}`;
    const plain = m.text?.trim() || htmlToText(m.html || '');
    const when = m.date ? new Date(m.date).toLocaleString() : '';
    const quoted = `\n\n${SIGNATURE}\n\n----\nOn ${when}, ${m.from} wrote:\n` + quoteBlock(plain || '(пустое сообщение)');
    openComposerWith({ to, subject, body: quoted });
  }
  function onForward() {
    const m = current; if (!m) return;
    const subj = (m.subject || ''); const subject = subj.toLowerCase().startsWith('fwd:') ? subj : `Fwd: ${subj}`;
    const plain = m.text?.trim() || htmlToText(m.html || '');
    const when = m.date ? new Date(m.date).toLocaleString() : '';
    const header =
      `\n\n${SIGNATURE}\n\n---- Forwarded message ----\n` +
      `From: ${m.from || ''}\n` +
      (m.to ? `To: ${m.to}\n` : '') +
      `Date: ${when}\n` +
      `Subject: ${m.subject || ''}\n\n`;
    openComposerWith({ to: '', subject, body: header + plain });
  }
  function closeRead() {
    if (current?._blobUrlsToRevoke) current._blobUrlsToRevoke.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    setReadOpen(false);
  }

  /* ROW (для Sent показываем адресата, для Inbox — отправителя) */
  const MailRow = ({ m }) => {
    const peer = (folder === 'sent')
      ? (recipients[m.id] || m.to || '(без получателя)')
      : (m.from || '(без отправителя)');
    return (
      <div key={m.id} style={styles.row} onClick={() => openMail(m.id)} role="button" title="Открыть">
        <div style={{ minWidth: 0 }}>
          <span style={styles.from}>{peer}</span>
          <span style={styles.subject}> {m.subject || '(без темы)'}</span>
          <span style={styles.snippet}> — {m.snippet || ''}</span>
        </div>
        <div style={styles.date}>{fmtDate(m.date)}</div>
      </div>
    );
  };

  /* GROUPS */
  const { today, months } = useMemo(() => buildGroups(list), [list]);
  const expandedSet = expandedByFolder[folder] || new Set();
  function toggleMonth(key) {
    setExpandedByFolder(prev => {
      const copy = { ...prev };
      const set = new Set(copy[folder] || []);
      if (set.has(key)) set.delete(key); else set.add(key);
      copy[folder] = set;
      return copy;
    });
  }

  /* RENDER */
  return (
    <div style={styles.app}>
      {/* LEFT */}
      <aside style={styles.left}>
        <div style={styles.account}>{ACCOUNT_EMAIL}</div>
        <button style={styles.compose} onClick={() => openComposerWith({})}>
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
          <button
            style={styles.connectBtn}
            onClick={() => {
              const w = window.open(`${FUNCTIONS_URL}/oauth_google_start`, 'oauth_gmail', 'width=600,height=700');
              if (!w) return;
              const t = setInterval(() => { if (!w || w.closed) { clearInterval(t); loadList(); } }, 800);
            }}
          >
            Подключить Gmail
          </button>
        )}

        {error && <div style={styles.error}>Ошибка: {error}</div>}
      </aside>

      {/* RIGHT */}
      <section style={styles.right}>
        <div style={styles.topbar}>
          <div style={styles.search}>
            <span>🔎</span>
            <input
              style={styles.searchInput}
              placeholder="Поиск (gmail: from:, to:, subject:, has:attachment …)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadList({ append: false, pageToken: null })}
            />
          </div>
          <button
            style={styles.btn}
            onClick={() => loadList({ append: false, pageToken: null })}
            disabled={listLoading}
          >
            Обновить
          </button>
        </div>

        <div style={styles.listHead}>
          {LABELS.find(l => l.id === folder)?.title || ''}{q ? ` — поиск: ${q}` : ''}
        </div>

        <div style={styles.table}>
          {listLoading && !appending ? (
            <div style={{ padding: 16, color: colors.subtext }}>Загрузка…</div>
          ) : (list.length === 0 ? (
            <div style={{ padding: 16, color: colors.subtext }}>Писем нет</div>
          ) : (
            <>
              {(['inbox','sent'].includes(folder) && !q) ? (
                <>
                  <div style={styles.sectionTitle}>
                    Сегодня {today.length ? `(${today.length})` : ''}
                  </div>
                  {today.length === 0 ? (
                    <div style={{ padding: 12, color: colors.muted }}>Нет писем за сегодня</div>
                  ) : (
                    today.map(m => <MailRow key={m.id} m={m} />)
                  )}

                  {months.map(g => {
                    const expanded = expandedSet.has(g.key);
                    return (
                      <div key={g.key}>
                        <div
                          style={styles.collapsibleHead}
                          onClick={() => toggleMonth(g.key)}
                          role="button"
                          title={expanded ? 'Свернуть' : 'Развернуть'}
                        >
                          <span style={styles.caret}>{expanded ? '▾' : '▸'}</span>
                          <span>{g.title} {g.items.length ? `(${g.items.length})` : ''}</span>
                        </div>
                        {expanded && (
                          g.items.length === 0
                            ? <div style={{ padding: 12, color: colors.muted }}>Нет писем</div>
                            : g.items.map(m => <MailRow key={m.id} m={m} />)
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                list
                  .slice()
                  .sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
                  .map(m => <MailRow key={m.id} m={m} />)
              )}

              {/* КНОПКА ПОДГРУЗКИ СЛЕДУЮЩЕЙ СТРАНИЦЫ */}
              {nextPageToken && (
                <div style={{ padding: 12, textAlign: 'center' }}>
                  <button
                    style={styles.btn}
                    onClick={() => loadList({ append: true, pageToken: nextPageToken })}
                    disabled={appending}
                  >
                    {appending ? 'Загрузка…' : 'Загрузить ещё письма'}
                  </button>
                </div>
              )}
            </>
          ))}
        </div>
      </section>

      {/* COMPOSE */}
      {composeOpen && (
        <div style={{ ...styles.overlayBase, ...styles.composeOverlay }} onClick={() => setComposeOpen(false)}>
          <div style={styles.composeModal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Новое письмо</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  // Нормально парсим Кому: поддержка вставки с именем, ; и переносами строк
                  const rawTo = toRef.current?.value || '';

                  const to = rawTo
                    .split(/[,;\n]/)
                    .map(s => s.trim())
                    .map(parseEmailAddress)
                    .filter(Boolean);

                  if (!to.length) {
                    alert('Укажите хотя бы один email получателя');
                    return;
                  }

                  const subject = subjectRef.current?.value || '';
                  const baseText = textRef.current?.value || '';

                  let text = baseText;

                  if (includeSignature && !text.includes('Sim HVAC & Appliance repair')) {
                    text = `${text}${SIGNATURE}`;
                  }
                  if (includePaymentOptions && !text.includes('Payment Options:')) {
                    text = `${text}${PAYMENT_OPTIONS}`;
                  }

                  const html = wrapHtmlTimes(`<div>${nl2br(text)}</div>`);
                  const files = Array.from(filesRef.current?.files || []);
                  const attachments = await Promise.all(
                    files.map(f => new Promise((res, rej) => {
                      const fr = new FileReader();
                      fr.onerror = () => rej(new Error('File read error'));
                      fr.onload = () => res({
                        filename: f.name,
                        mimeType: f.type || 'application/octet-stream',
                        base64: btoa(String.fromCharCode(...new Uint8Array(fr.result)))
                      });
                      fr.readAsArrayBuffer(f);
                    }))
                  );

                  const { data: { session } = {} } = await supabase.auth.getSession();

                  const r = await fetch(`${FUNCTIONS_URL}/gmail_send`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      apikey: SUPABASE_ANON_KEY,
                      Authorization: `Bearer ${session?.access_token || ''}`
                    },
                    body: JSON.stringify({ to, subject, text, html, attachments })
                  });

                  if (!r.ok) throw new Error(`gmail_send: ${r.status} ${await r.text()}`);
                  setComposeOpen(false);
                  setFolder('sent');
                  loadList({ append: false, pageToken: null });
                } catch (err) {
                  alert(err.message || String(err));
                }
              }}
            >
              <div style={styles.formRow}>
                <div>От</div>
                <input value={ACCOUNT_EMAIL} disabled style={styles.input} />
              </div>
              <div style={styles.formRow}>
                <div>Кому (через запятую)</div>
                <input
                  ref={toRef}
                  style={styles.input}
                  placeholder="user@example.com, ..."
                />
              </div>
              <div style={styles.formRow}>
                <div>Тема</div>
                <input ref={subjectRef} style={styles.input} />
              </div>
              <div style={styles.formRow}>
                <div>Текст</div>
                <textarea ref={textRef} rows={8} style={styles.input} placeholder="Сообщение..." />

                {/* ДВЕ КОЛОНКИ: слева подпись, справа способы оплаты */}
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    marginTop: 8,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <input
                        type="checkbox"
                        checked={includeSignature}
                        onChange={(e)=>setIncludeSignature(e.target.checked)}
                      />
                      Добавлять подпись компании
                    </label>
                    <div style={styles.signatureHint}>
                      Подпись будет добавлена в конец письма:{SIGNATURE}
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 260 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <input
                        type="checkbox"
                        checked={includePaymentOptions}
                        onChange={(e)=>setIncludePaymentOptions(e.target.checked)}
                      />
                      Добавлять блок со способами оплаты
                    </label>
                    <div style={styles.signatureHint}>
                      Блок способов оплаты (будет после подписи):{PAYMENT_OPTIONS}
                    </div>
                  </div>
                </div>
              </div>

              <div style={styles.formRow}>
                <div>Вложения</div>
                <input ref={filesRef} type="file" multiple />
              </div>
              <div style={styles.btnLine}>
                <button type="submit" style={styles.btnPrimary}>Отправить</button>
                <button type="button" style={styles.btn} onClick={() => setComposeOpen(false)}>Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* READ */}
      {readOpen && (
        <div style={{ ...styles.overlayBase, ...styles.readOverlay }} onClick={closeRead}>
          <div style={styles.readModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.readHeader}>
              <h3 style={{ margin: 0 }}>{current?.subject || '(без темы)'}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={styles.btn} onClick={onReply} disabled={!current || reading}>Ответить</button>
                <button style={styles.btn} onClick={onForward} disabled={!current || reading}>Переслать</button>
                <button style={styles.btn} onClick={closeRead}>Закрыть</button>
              </div>
            </div>
            <div style={styles.readMeta}>
              <div><b>От:</b> {current?.from || ''}</div>
              {current?.to ? <div><b>Кому:</b> {current.to}</div> : null}
              <div><b>Дата:</b> {current?.date ? new Date(current.date).toLocaleString() : ''}</div>
            </div>
            <div style={styles.readBody} ref={readBodyRef}>
              {reading ? (
                <div style={{ color: colors.subtext }}>Загрузка письма…</div>
              ) : current?.html ? (
                <>
                  <style>{`.email-body *{max-width:100%;box-sizing:border-box}.email-body img{height:auto}.email-body table{width:100%}.email-body pre{white-space:pre-wrap}`}</style>
                  <div className="email-body" dangerouslySetInnerHTML={{ __html: current.html }} />
                </>
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap' }}>{current?.text || '(пустое письмо)'}</pre>
              )}
              {Array.isArray(current?.attachments) && current.attachments.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <b>Вложения:</b>
                  <ul style={{ marginTop: 6 }}>
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
