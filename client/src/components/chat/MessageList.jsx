// client/src/components/chat/MessageList.jsx
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

/* ---------- helpers ---------- */

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

/* ---------- main component ---------- */

export default function MessageList({
  chatId,
  messages,
  loading,
  currentUserId,
  receipts = {},             // { [messageId]: { delivered:Set<userId>, read:Set<userId> } }
  memberNames = {},
  enableAutoRead = true,     // можно выключить автопометку прочитанным
  onReadSent,                // коллбек после отправки "read" (не обязателен)
}) {
  const bottomRef = useRef(null);
  const observerRef = useRef(null);
  const pendingToReadRef = useRef(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  // Помечаем прочитанными сообщения, попавшие в вьюпорт (только чужие)
  useEffect(() => {
    if (!enableAutoRead || !messages?.length || !chatId) return;

    // создаём/обновляем наблюдателя
    try { observerRef.current?.disconnect(); } catch {}
    const flush = async () => {
      const ids = Array.from(pendingToReadRef.current);
      pendingToReadRef.current.clear();
      if (!ids.length) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // строим строки для upsert (обновляем статус на 'read')
        const rows = ids.map((message_id) => ({
          chat_id: chatId,
          message_id,
          user_id: user.id,
          status: 'read',
        }));

        const { error } = await supabase
          .from('message_receipts')
          .upsert(rows, {
            onConflict: 'chat_id,message_id,user_id', // совпадает с нашим уникальным ключом
            // ignoreDuplicates не указываем → будет DO UPDATE (delivered -> read)
          });

        if (error) console.error('mark read error', error);
        onReadSent?.(ids);
      } catch (e) {
        console.error('mark read error', e);
      }
    };

    const flushDebounced = (() => {
      let t = null;
      return () => { clearTimeout(t); t = setTimeout(flush, 250); };
    })();

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.getAttribute('data-mid');
        const mine = e.target.getAttribute('data-mine') === '1';
        if (!id || mine) continue;

        // уже прочитано мной? — не шлём повторно
        const alreadyReadByMe = receipts[id]?.read?.has?.(currentUserId);
        if (alreadyReadByMe) continue;

        pendingToReadRef.current.add(id);
        flushDebounced();
      }
    }, { root: null, rootMargin: '0px 0px -20% 0px', threshold: 0.5 });

    // подписываем все сообщения
    setTimeout(() => {
      document.querySelectorAll('[data-mid]').forEach((el) => io.observe(el));
    }, 0);

    observerRef.current = io;
    return () => { try { io.disconnect(); } catch {} };
  }, [chatId, messages, currentUserId, enableAutoRead, receipts, onReadSent]);

  if (loading) return <div>Загрузка…</div>;
  if (!messages?.length) return <div>Сообщений пока нет</div>;

  return (
    <div>
      {messages.map((m) => {
        const authorId = m.author_id || m.sender_id;
        const mine = authorId === currentUserId;
        const stats = receipts[m.id];

        return (
          <div
            key={m.id}
            data-mid={m.id}
            data-mine={mine ? '1' : '0'}
            style={{ margin: '8px 0', display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}
          >
            <div
              style={{
                maxWidth: '72%',
                background: mine ? '#e8f0fe' : '#f5f5f5',
                borderRadius: 10,
                padding: '8px 10px',
                wordBreak: 'break-word'
              }}
            >
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
