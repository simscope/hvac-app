// client/src/components/chat/MessageList.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

/* ========================= helpers ========================= */

const fmtTime = (ts) => {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const isHttpUrl = (v) => /^https?:\/\//i.test(String(v || ''));

/* ========================= ticks ========================= */
/** Галочки статуса (без хуков внутри). Показываются только для своих сообщений. */
function Ticks({ mine, stats, memberNames }) {
  if (!mine) return null;

  const delivered = stats?.delivered && stats.delivered.size > 0;
  const read = stats?.read && stats.read.size > 0;

  const readers = useMemo(
    () => (read ? Array.from(stats.read).map((id) => memberNames?.[id] || id) : []),
    [read, stats, memberNames]
  );

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

/* ========================= inline file ========================= */
/** Один файл внутри сообщения (поддержка путей в бакете и внешних URL). */
function InlineFile({ pathOrUrl, fileName, fileType, fileSize, bucket = 'chat-attachments' }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!pathOrUrl) return;
      if (isHttpUrl(pathOrUrl)) {
        if (mounted) setUrl(pathOrUrl);
        return;
      }
      // pathOrUrl ожидается как ПУТЬ внутри бакета (без имени бакета)
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(pathOrUrl, 3600);
      if (!error && mounted) setUrl(data?.signedUrl || null);
    })();
    return () => {
      mounted = false;
    };
  }, [pathOrUrl, bucket]);

  const isImage = (fileType || '').startsWith('image/');

  return (
    <div style={{ marginTop: 6 }}>
      {isImage ? (
        <a href={url || '#'} target="_blank" rel="noreferrer">
          {/* фиксируем размеры, чтобы не прыгал список */}
          <img
            src={url || ''}
            alt={fileName || 'image'}
            style={{ maxWidth: '60%', borderRadius: 6, display: 'block' }}
          />
        </a>
      ) : (
        <a href={url || '#'} target="_blank" rel="noreferrer">
          {fileName || 'file'} {fileSize ? `(${Math.round(fileSize / 1024)} KB)` : ''}
        </a>
      )}
    </div>
  );
}

/* ========================= main list ========================= */

export default function MessageList({
  messages,
  loading,
  currentUserId,
  receipts = {},
  onMarkVisibleRead, // (ids: string[])
  memberNames = {},
}) {
  const bottomRef = useRef(null);
  const ioRef = useRef(null);
  const queuedToReadRef = useRef(new Set());

  // аккуратный автоскролл: если мы и так внизу — скроллим "smooth", иначе без анимации
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;

    const nearBottom =
      Math.abs(window.scrollY + window.innerHeight - document.body.scrollHeight) < 120;

    el.scrollIntoView({ behavior: nearBottom ? 'smooth' : 'auto' });
  }, [messages?.length]);

  // пометка "прочитано" только для ЧУЖИХ сообщений, попавших в viewport
  useEffect(() => {
    if (!messages?.length || !onMarkVisibleRead) return;

    // снять старый observer
    try {
      ioRef.current?.disconnect();
    } catch {}
    ioRef.current = null;

    const flush = () => {
      const ids = Array.from(queuedToReadRef.current);
      queuedToReadRef.current.clear();
      if (ids.length) onMarkVisibleRead(ids);
    };
    const debouncedFlush = (() => {
      let t = null;
      return () => {
        clearTimeout(t);
        t = setTimeout(flush, 250);
      };
    })();

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = e.target.getAttribute('data-mid');
          const mine = e.target.getAttribute('data-mine') === '1';
          if (id && !mine) {
            queuedToReadRef.current.add(id);
            debouncedFlush();
          }
        }
      },
      // небольшой отрицательный bottom-margin, чтобы считать "прочитанным"
      // когда карточка реально видна, а не на границе
      { root: null, rootMargin: '0px 0px -20% 0px', threshold: 0.6 }
    );

    // Подвешиваем после вставки DOM-узлов
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-mid]').forEach((el) => io.observe(el));
    });

    ioRef.current = io;
    return () => {
      try {
        io.disconnect();
      } catch {}
    };
  }, [messages, onMarkVisibleRead]);

  if (loading) return <div style={{ color: '#64748b' }}>Загрузка…</div>;
  if (!messages?.length) return <div style={{ color: '#94a3b8' }}>Сообщений пока нет</div>;

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
              {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}

              {/* вложение: приоритет file_*; fallback на legacy attachment_url */}
              {(m.file_url || m.attachment_url) && (
                <div>
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

              <div
                style={{
                  fontSize: 11,
                  color: '#888',
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
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
