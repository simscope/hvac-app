// client/src/components/chat/MessageList.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

/**
 * Вспомогательные компоненты:
 *  - галочки (✓/✓✓) с подсказкой кто прочитал
 *  - предпросмотр файла (автогенерация signed URL для storage пути)
 */

function Ticks({ mine, stats, memberNames }) {
  if (!mine) return null;
  const delivered = stats?.delivered && stats.delivered.size > 0;
  const read = stats?.read && stats.read.size > 0;

  const readers = read ? Array.from(stats.read).map(id => memberNames?.[id] || id) : [];
  const title = readers.length
    ? `Прочитали: ${readers.join(', ')}`
    : (delivered ? 'Доставлено' : 'Отправлено');

  return (
    <span title={title} style={{ marginLeft: 6, fontSize: 12, userSelect: 'none' }}>
      {!delivered && '✓'}
      {delivered && !read && '✓✓'}
      {delivered && read && <span style={{ color: '#1a73e8' }}>✓✓</span>}
    </span>
  );
}

function InlineFile({ pathOrUrl, fileName, fileType, fileSize, bucket = 'chat-attachments' }) {
  const [url, setUrl] = useState(null);
  const isHttp = /^https?:\/\//i.test(pathOrUrl || '');

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!pathOrUrl) return;
      if (isHttp) { setUrl(pathOrUrl); return; }
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(pathOrUrl, 3600);
        if (!error && mounted) setUrl(data?.signedUrl || null);
      } catch {
        /* noop */
      }
    })();
    return () => { mounted = false; };
  }, [pathOrUrl, bucket, isHttp]);

  const isImage = (fileType || '').startsWith('image/');
  return (
    <div>
      {isImage ? (
        <a href={url || '#'} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img src={url || ''} style={{ maxWidth: '50%', borderRadius: 6 }} />
        </a>
      ) : (
        <a href={url || '#'} target="_blank" rel="noreferrer">
          {fileName || 'file'} {fileSize ? `(${Math.round(fileSize / 1024)} KB)` : ''}
        </a>
      )}
    </div>
  );
}

const fmtTime = (ts) => {
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
};

/**
 * MessageList
 *
 * Props:
 * - messages: массив сообщений (id, chat_id, author_id, body, file_* ...)
 * - loading: флаг загрузки
 * - currentUserId: id текущего пользователя (тот же тип, что и author_id)
 * - receipts: { [messageId]: { delivered:Set, read:Set } }
 * - onMarkVisibleRead?: (ids: string[]) => void
 * - memberNames?: { [userId]: string }
 */
export default function MessageList({
  messages,
  loading,
  currentUserId,
  receipts = {},
  onMarkVisibleRead,
  memberNames = {}
}) {
  const bottomRef = useRef(null);
  const observerRef = useRef(null);
  const pendingToReadRef = useRef(new Set());

  // автоскролл вниз при появлении новых
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  // наблюдаем появление НЕ своих сообщений в вьюпорте и помечаем read
  useEffect(() => {
    if (!messages?.length || !onMarkVisibleRead) return;

    try { observerRef.current?.disconnect(); } catch {}

    const flush = () => {
      const ids = Array.from(pendingToReadRef.current);
      pendingToReadRef.current.clear();
      if (ids.length) onMarkVisibleRead(ids);
    };
    const flushDebounced = (() => {
      let t = null;
      return () => { clearTimeout(t); t = setTimeout(flush, 300); };
    })();

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.getAttribute('data-mid');
        const mine = e.target.getAttribute('data-mine') === '1';
        if (id && !mine) {
          pendingToReadRef.current.add(id);
          flushDebounced();
        }
      }
    }, { root: null, rootMargin: '0px 0px -20% 0px', threshold: 0.5 });

    setTimeout(() => {
      document.querySelectorAll('[data-mid]').forEach((el) => io.observe(el));
    }, 0);

    observerRef.current = io;
    return () => { try { io.disconnect(); } catch {} };
  }, [messages, onMarkVisibleRead, currentUserId]);

  if (loading) return <div style={{ padding: 12 }}>Загрузка…</div>;
  if (!messages?.length) return <div style={{ padding: 12, color:'#6b7280' }}>Сообщений пока нет</div>;

  return (
    <div>
      {messages.map((m) => {
        const mine = (m.author_id || m.sender_id) === currentUserId;
        const stats = receipts[m.id];

        return (
          <div
            key={m.id}
            data-mid={m.id}
            data-mine={mine ? '1' : '0'}
            style={{ margin: '8px 0', display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}
          >
            <div style={{
              maxWidth: '72%',
              background: mine ? '#e8f0fe' : '#f5f5f5',
              borderRadius: 10,
              padding: '8px 10px',
              wordBreak: 'break-word'
            }}>
              {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}

              {(m.file_url || m.attachment_url) && (
                <div style={{ marginTop: 6 }}>
                  {m.file_url ? (
                    <InlineFile
                      pathOrUrl={m.file_url}
                      fileName={m.file_name}
                      fileType={m.file_type}
                      fileSize={m.file_size}
                      bucket="chat-attachments"
                    />
                  ) : (
                    <a href={m.attachment_url} target="_blank" rel="noreferrer">
                      {m.attachment_url}
                    </a>
                  )}
                </div>
              )}

              <div style={{ fontSize: 11, color: '#888', marginTop: 6, display: 'flex', alignItems: 'center' }}>
                {fmtTime(m.created_at)}
                <Ticks mine={mine} stats={stats} memberNames={memberNames} />
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
