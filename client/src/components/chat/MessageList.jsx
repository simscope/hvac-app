// client/src/components/chat/MessageList.jsx
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

/* -------------------- Вспомогалки -------------------- */

function getStats(receiptsObj, messageId) {
  if (!receiptsObj || typeof receiptsObj !== 'object') return undefined;
  return receiptsObj[messageId];
}

const fmtTime = (ts) => {
  try {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  } catch {
    return '';
  }
};

/* Галочки доставки/прочтения */
function Ticks({ mine, stats, memberNames }) {
  if (!mine) return null;

  const deliveredSet = stats?.delivered instanceof Set ? stats.delivered : undefined;
  const readSet = stats?.read instanceof Set ? stats.read : undefined;

  const delivered = deliveredSet?.size > 0;
  const read = readSet?.size > 0;

  const readers = read
    ? Array.from(readSet).map((id) => memberNames?.[id] || id)
    : [];

  const title = readers.length
    ? `Прочитали: ${readers.join(', ')}`
    : delivered
      ? 'Доставлено'
      : 'Отправлено';

  return (
    <span title={title} style={{ marginLeft: 6, fontSize: 12, userSelect: 'none' }}>
      {!delivered && '✓'}
      {delivered && !read && '✓✓'}
      {delivered && read && <span style={{ color: '#1a73e8' }}>✓✓</span>}
    </span>
  );
}

/* Один файл внутри сообщения */
function InlineFile({ pathOrUrl, fileName, fileType, fileSize, bucket = 'chat-attachments' }) {
  const [url, setUrl] = useState(null);
  const isHttp = /^https?:\/\//i.test(pathOrUrl || '');

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!pathOrUrl) return;
      if (isHttp) {
        if (mounted) setUrl(pathOrUrl);
        return;
      }
      const { data, error } = await supabase
        .storage
        .from(bucket)
        .createSignedUrl(pathOrUrl, 3600);
      if (!error && mounted) setUrl(data?.signedUrl || null);
    })();
    return () => { mounted = false; };
  }, [pathOrUrl, bucket, isHttp]);

  const isImage = (fileType || '').startsWith('image/');
  return (
    <div>
      {isImage ? (
        <a href={url || '#'} target="_blank" rel="noreferrer">
          <img src={url || ''} alt={fileName || 'image'} style={{ maxWidth: '50%', borderRadius: 6 }} />
        </a>
      ) : (
        <a href={url || '#'} target="_blank" rel="noreferrer">
          {fileName || 'file'} {fileSize ? `(${Math.round(fileSize / 1024)} KB)` : ''}
        </a>
      )}
    </div>
  );
}

/* -------------------- Компонент списка сообщений -------------------- */

export default function MessageList({
  messages = [],
  loading = false,
  currentUserId = null,
  receipts = {},               // может прийти undefined — обрабатываем внутри
  onMarkVisibleRead = () => {},
  memberNames = {},
}) {
  const list = Array.isArray(messages) ? messages : [];
  const bottomRef = useRef(null);
  const observerRef = useRef(null);
  const pendingToReadRef = useRef(new Set());

  // автоскролл вниз при появлении новых сообщений
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [list.length]);

  // отмечаем как read, когда сообщение появляется в зоне видимости
  useEffect(() => {
    if (!list.length || typeof onMarkVisibleRead !== 'function') return;

    // Сброс старого observer
    if (observerRef.current) {
      try { observerRef.current.disconnect(); } catch {}
      observerRef.current = null;
    }

    const flush = () => {
      const ids = Array.from(pendingToReadRef.current);
      pendingToReadRef.current.clear();
      if (ids.length) onMarkVisibleRead(ids);
    };

    // небольшой дебаунс, чтобы не спамить БД
    let timer = null;
    const flushDebounced = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, 250);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = e.target.getAttribute('data-mid');
          const mine = e.target.getAttribute('data-mine') === '1';
          if (id && !mine) {
            pendingToReadRef.current.add(id);
            flushDebounced();
          }
        }
      },
      { root: null, rootMargin: '0px 0px -20% 0px', threshold: 0.5 }
    );

    // Подцепим к DOM после рендера
    setTimeout(() => {
      document.querySelectorAll('[data-mid]').forEach((el) => io.observe(el));
    }, 0);

    observerRef.current = io;
    return () => {
      clearTimeout(timer);
      try { io.disconnect(); } catch {}
    };
  }, [list, onMarkVisibleRead, currentUserId]);

  if (loading) return <div>Загрузка…</div>;
  if (!list.length) return <div>Сообщений пока нет</div>;

  return (
    <div>
      {list.map((m) => {
        // ключ и безопасные поля
        const key = String(m?.id ?? m?.message_id ?? '');
        if (!key) return null;

        const authorId = m?.author_id ?? m?.sender_id ?? null;
        const mine = currentUserId != null && authorId === currentUserId;

        const stats = getStats(receipts, key);

        const hasModernFile = !!m?.file_url;
        const hasLegacyAttachment = !!m?.attachment_url;

        return (
          <div
            key={key}
            data-mid={key}
            data-mine={mine ? '1' : '0'}
            style={{
              margin: '8px 0',
              display: 'flex',
              justifyContent: mine ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '72%',
                background: mine ? '#e8f0fe' : '#f5f5f5',
                borderRadius: 10,
                padding: '8px 10px',
                wordBreak: 'break-word',
              }}
            >
              {m?.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}

              {(hasModernFile || hasLegacyAttachment) && (
                <div style={{ marginTop: 6 }}>
                  {hasModernFile ? (
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
                {fmtTime(m?.created_at)}
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
