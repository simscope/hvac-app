// src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, FUNCTIONS_URL } from '../supabaseClient';

const styles = {
  wrap: { display: 'flex', gap: 16, padding: 16 },
  left: {
    width: 320,
    borderRight: '1px solid #e5e7eb',
    paddingRight: 16,
  },
  right: { flex: 1 },
  row: { marginBottom: 8 },
  input: { width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 },
  btn: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    background: '#f7f7f7',
    cursor: 'pointer',
  },
  danger: { color: 'crimson' },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  listItem: {
    padding: '10px 12px',
    border: '1px solid #eee',
    borderRadius: 8,
    marginBottom: 8,
    background: '#fff',
  },
  modal: {
    border: '1px solid #ddd',
    padding: 12,
    borderRadius: 8,
    maxWidth: 720,
    background: '#fff',
  },
};

export default function EmailTab() {
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(true); // если получим 401/404 — станет false
  const [folder, setFolder] = useState('inbox'); // inbox | sent
  const [q, setQ] = useState('');

  const [composeOpen, setComposeOpen] = useState(false);
  const toRef = useRef();
  const subjectRef = useRef();
  const textRef = useRef();
  const filesRef = useRef();

  const API = useMemo(() => {
    return {
      list: `${FUNCTIONS_URL}/gmail_list`,
      send: `${FUNCTIONS_URL}/gmail_send`,
      // вспомогательно — дернуть и понять «привязан ли аккаунт»
      get: `${FUNCTIONS_URL}/gmail_get`,
      oauthStart: `${FUNCTIONS_URL}/oauth_google_start`,
    };
  }, []);

  // Универсальный хелпер с авторизацией
  async function authedFetch(url, options = {}) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };

    return fetch(url, { ...options, headers });
  }

  // ------------------ загрузка писем -------------------
  async function loadList() {
    if (!FUNCTIONS_URL) {
      setError('Не задан FUNCTIONS_URL. Проверьте переменные окружения.');
      return;
    }

    try {
      setError('');
      setConnected(true);
      setListLoading(true);

      const r = await authedFetch(API.list, {
        method: 'POST',
        body: JSON.stringify({ folder, q }),
      });

      if (!r.ok) {
        // Обработка типовых ситуаций
        const txt = await r.text();
        if (r.status === 404 && txt.includes('MAIL_ACCOUNT_NOT_FOUND')) {
          setConnected(false);
          throw new Error('Аккаунт Gmail не привязан.');
        }
        if (r.status === 401) {
          setConnected(false);
          throw new Error('Требуется повторная авторизация Gmail (401).');
        }
        throw new Error(`gmail_list: ${r.status} ${txt}`);
      }

      const data = await r.json();
      setList(data?.messages || []);
    } catch (e) {
      console.error(e);
      setList([]);
      setError(e.message || String(e));
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // ------------------ отправка письма -------------------
  async function send(e) {
    e.preventDefault();
    setError('');

    const to = (toRef.current?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const subject = subjectRef.current?.value || '';
    const text = textRef.current?.value || '';

    // вложения
    const files = Array.from(filesRef.current?.files || []);
    const attachments = await Promise.all(
      files.map(
        (f) =>
          new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onerror = () => rej(new Error('File read error'));
            fr.onload = () =>
              res({
                filename: f.name,
                mimeType: f.type || 'application/octet-stream',
                base64: btoa(String.fromCharCode(...new Uint8Array(fr.result))),
              });
            fr.readAsArrayBuffer(f);
          })
      )
    );

    try {
      setLoading(true);

      const r = await authedFetch(API.send, {
        method: 'POST',
        body: JSON.stringify({
          to,
          subject,
          text,
          attachments,
        }),
      });

      if (!r.ok) {
        const txt = await r.text();
        // Если refresh_token протух, сервер может вернуть 401/500 — показываем понятный текст
        if (r.status === 401 && txt.includes('NEEDS_RELINK')) {
          setConnected(false);
        }
        throw new Error(`gmail_send: ${r.status} ${txt}`);
      }

      alert('Письмо отправлено');
      setComposeOpen(false);
      // после отправки — покажем «Отправленные»
      setFolder('sent');
      await loadList();
    } catch (e2) {
      console.error(e2);
      setError(e2.message || String(e2));
      alert(e2.message || String(e2));
    } finally {
      setLoading(false);
    }
  }

  // ------------------ привязка (OAuth) -------------------
  async function connectGmail() {
    setError('');
    try {
      // открываем окно oauth_start
      const w = window.open(API.oauthStart, 'oauth_gmail', 'width=600,height=700');
      // ждём закрытия и затем пробуем получить список
      const timer = setInterval(() => {
        if (!w || w.closed) {
          clearInterval(timer);
          loadList();
        }
      }, 800);
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
    }
  }

  // ------------------ UI -------------------
  return (
    <div style={styles.wrap}>
      {/* ЛЕВАЯ ПАНЕЛЬ */}
      <aside style={styles.left}>
        <h2 style={{ marginTop: 0 }}>Email</h2>

        {!connected && (
          <div style={{ ...styles.row, ...styles.danger }}>
            Gmail не подключён. Нажмите «Подключить Gmail».
          </div>
        )}

        <div style={styles.row}>
          <label>Папка:&nbsp;</label>
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            style={{ padding: 6, borderRadius: 6 }}
          >
            <option value="inbox">Входящие</option>
            <option value="sent">Отправленные</option>
          </select>
        </div>

        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="Поиск (gmail-синтаксис: from:, subject:, has:attachment, …)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.btn} onClick={loadList} disabled={listLoading}>
            Обновить
          </button>
          <button
            style={{ ...styles.btn, background: '#eef6ff', borderColor: '#cfe1ff' }}
            onClick={() => setComposeOpen(true)}
            disabled={listLoading || !connected}
          >
            Написать
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            style={{ ...styles.btn, background: '#eaffea', borderColor: '#bde5bd' }}
            onClick={connectGmail}
          >
            Подключить Gmail
          </button>
        </div>

        {error && (
          <div style={{ ...styles.row, ...styles.danger, whiteSpace: 'pre-wrap' }}>
            Ошибка: {error}
          </div>
        )}
      </aside>

      {/* ПРАВАЯ ПАНЕЛЬ */}
      <main style={styles.right}>
        {composeOpen && (
          <div style={styles.modal}>
            <h3 style={{ marginTop: 0 }}>Новое письмо</h3>
            <form onSubmit={send}>
              <div style={styles.row}>
                <div>Кому (через запятую)</div>
                <input ref={toRef} style={styles.input} />
              </div>

              <div style={styles.row}>
                <div>Тема</div>
                <input ref={subjectRef} style={styles.input} />
              </div>

              <div style={styles.row}>
                <div>Текст</div>
                <textarea ref={textRef} rows={8} style={styles.input} />
              </div>

              <div style={styles.row}>
                <div>Вложения</div>
                <input ref={filesRef} type="file" multiple />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" style={styles.btn} disabled={loading}>
                  Отправить
                </button>
                <button
                  type="button"
                  style={styles.btn}
                  disabled={loading}
                  onClick={() => setComposeOpen(false)}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        <h3 style={{ marginTop: 8, marginBottom: 12 }}>
          {folder === 'inbox' ? 'Входящие' : 'Отправленные'}
        </h3>

        <div style={{ opacity: listLoading ? 0.6 : 1 }}>
          {list?.length ? (
            <ul style={styles.list}>
              {list.map((m) => (
                <li key={m.id} style={styles.listItem}>
                  <div style={{ color: '#64748b', fontSize: 12 }}>
                    <code>{m.id}</code>
                  </div>
                  <div>{m.snippet || '(без темы)'} </div>
                </li>
              ))}
            </ul>
          ) : (
            <div>Писем нет</div>
          )}
        </div>
      </main>
    </div>
  );
}
