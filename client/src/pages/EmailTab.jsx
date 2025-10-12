// client/src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, FUNCTIONS_URL, SHARED_EMAIL } from '../supabaseClient';

export default function EmailTab() {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const toRef = useRef();
  const subjectRef = useRef();
  const textRef = useRef();
  const filesRef = useRef();

  // Готовые URL для edge-функций
  const API = useMemo(
    () => ({
      list: `${FUNCTIONS_URL}/gmail_list`,
      send: `${FUNCTIONS_URL}/gmail_send`,
      unreadByChat: `${FUNCTIONS_URL}/get_unread_by_chat`,
    }),
    []
  );

  async function load() {
    try {
      setError('');
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const r = await fetch(API.list, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          shared_email: SHARED_EMAIL, // ВАЖНО: прокидываем общую почту
          q: '',
        }),
      });

      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`gmail_list: ${r.status} ${txt}`);
      }

      const data = await r.json();
      setList(data?.messages || []);
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!FUNCTIONS_URL) {
      setError('Не задан FUNCTIONS_URL. Проверьте переменные окружения.');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(e) {
    e.preventDefault();
    setError('');

    const to = (toRef.current?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const subject = subjectRef.current?.value || '';
    const text = textRef.current?.value || '';

    // вложения -> base64
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

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const r = await fetch(API.send, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          shared_email: SHARED_EMAIL, // ВАЖНО
          from: SHARED_EMAIL,         // многие реализации ожидают ещё и from
          to,
          subject,
          text,
          attachments,
        }),
      });

      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`gmail_send: ${r.status} ${txt}`);
      }

      setComposeOpen(false);
      await load();
      alert('Письмо отправлено');
    } catch (e2) {
      console.error(e2);
      setError(e2.message || String(e2));
      alert(e2.message || String(e2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Email</h1>

      {error && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>
          Ошибка: {error}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => load()} disabled={loading}>
          Обновить
        </button>{' '}
        <button onClick={() => setComposeOpen(true)} disabled={loading}>
          Написать
        </button>
      </div>

      {composeOpen && (
        <div
          style={{
            border: '1px solid #ddd',
            padding: 12,
            borderRadius: 8,
            maxWidth: 620,
            marginBottom: 16,
          }}
        >
          <h3>Новое письмо</h3>
          <form onSubmit={send}>
            <div style={{ marginBottom: 8 }}>
              <div>Кому (через запятую)</div>
              <input ref={toRef} style={{ width: '100%' }} />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div>Тема</div>
              <input ref={subjectRef} style={{ width: '100%' }} />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div>Текст</div>
              <textarea ref={textRef} rows={6} style={{ width: '100%' }} />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div>Вложения</div>
              <input ref={filesRef} type="file" multiple />
            </div>

            <div>
              <button type="submit" disabled={loading}>
                Отправить
              </button>{' '}
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                disabled={loading}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ opacity: loading ? 0.6 : 1 }}>
        {list?.length ? (
          <ul>
            {list.map((m) => (
              <li key={m.id}>
                <code>{m.id}</code> — {m.snippet || '(без темы)'}
              </li>
            ))}
          </ul>
        ) : (
          <div>Писем нет</div>
        )}
      </div>
    </div>
  );
}
