import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

/** Галочки для моих сообщений */
function Ticks({ mine, stats, memberNames }) {
  if (!mine) return null;
  const delivered = stats?.delivered?.size > 0;
  const read = stats?.read?.size > 0;
  const readers = read ? Array.from(stats.read).map(id => memberNames?.[id] || id) : [];
  const title = read
    ? `Прочитали: ${readers.join(', ')}`
    : delivered ? 'Доставлено' : 'Отправлено';
  return (
    <span title={title} style={{ marginLeft: 6, fontSize: 12, userSelect: 'none' }}>
      {!delivered && '✓'}
      {delivered && !read && '✓✓'}
      {delivered && read && <span style={{ color: '#1a73e8' }}>✓✓</span>}
    </span>
  );
}

/** ссылка/миниатюра для вложений */
function InlineFile({ pathOrUrl, fileName, fileType, fileSize, bucket = 'chat-attachments' }) {
  const [url, setUrl] = useState(null);
  const isHttp = /^https?:\/\//i.test(pathOrUrl || '');
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!pathOrUrl) return;
      if (isHttp) { setUrl(pathOrUrl); return; }
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(pathOrUrl, 3600);
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

const fmtTime = (ts) => {
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
};

export default function MessageList({
  messages,
  loading,
  currentUserId,
  receiptsMap,          // { [messageId]: { delivered:Set, read:Set } }
  onMarkVisibleRead,    // (ids:number[]) => void
  memberNames = {}
}) {
  const bottomRef = useRef(null);
  const observerRef = useRef(null);
  const pendingToReadRef = useRef(new Set());

  // автоскролл вниз
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages?.length]);

  // наблюдаем за видимостью сообщений и сдаём «read» пачками
  useEffect(() => {
    if (!messages?.length || !onMarkVisibleRead) return;

    if (observerRef.current) {
      try { observerRef.current.disconnect(); } catch {}
      observerRef.current = null;
    }

    const flush = () => {
      const ids = Array.from(pendingToReadRef.current);
      pendingToReadRef.current.clear();
      if (ids.length) onMarkVisibleRead(ids);
    };
    let t = null;
    const debounced = () => { clearTimeout(t); t = setTimeout(flush, 200); };

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.getAttribute('data-mid');
        const mine = e.target.getAttribute('data-mine') === '1';
        if (id && !mine) {
          pendingToReadRef.current.add(id);
          debounced();
        }
      }
    }, { root: null, rootMargin: '0px 0px -20% 0px', threshold: 0.5 });

    // подвесим после рендера
    setTimeout(() => {
      document.querySelectorAll('[data-mid]').forEach((el) => io.observe(el));
    }, 0);

    observerRef.current = io;
    return () => { try { io.disconnect(); } catch {}; };
  }, [messages, onMarkVisibleRead, currentUserId]);

  if (loading) return <div>Загрузка…</div>;
  if (!messages?.length) return <div>Сообщений пока нет</div>;

  return (
    <div>
      {messages.map((m) => {
        const mine = (m.author_id || m.sender_id) === currentUserId;
        const stats = receiptsMap[m.id] || { delivered:new Set(), read:new Set() };
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
                    />
                  ) : (
                    <a href={m.attachment_url} target="_blank" rel="noreferrer">{m.attachment_url}</a>
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
