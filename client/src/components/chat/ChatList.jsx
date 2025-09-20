// client/src/components/chat/ChatList.jsx
import React from 'react';

/**
 * Простой список чатов.
 * Ожидаемые поля элемента:
 *  - id ИЛИ chat_id
 *  - title
 *  - last_body (опционально)
 *  - last_at   (опционально, ISO)
 *  - unread_count (опционально, число)
 */
export default function ChatList({
  chats = [],
  activeChatId = null,
  onSelect = () => {},
}) {
  const items = Array.isArray(chats) ? chats : [];

  const fmtTime = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleString();
    } catch {
      return '';
    }
  };

  if (!items.length) {
    return (
      <div style={{ padding: 12, color: '#6b7280', fontSize: 14 }}>
        Нет чатов
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items
        .slice() // на всякий случай не мутируем исходный массив
        .sort((a, b) => new Date(b?.last_at || 0) - new Date(a?.last_at || 0))
        .map((c) => {
          const id = c?.id ?? c?.chat_id; // поддерживаем обе схемы
          if (!id) return null;

          const title = c?.title || '—';
          const last = c?.last_body || '';
          const time = fmtTime(c?.last_at);
          const unread = Number(c?.unread_count || 0);
          const isActive = id === activeChatId;

          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                borderBottom: '1px solid #eee',
                background: isActive ? '#f3f4f6' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title}
                </div>

                {/* бейдж непрочитанных */}
                {unread > 0 && (
                  <span
                    style={{
                      marginLeft: 8,
                      background: '#ef4444',
                      color: '#fff',
                      borderRadius: 9999,
                      padding: '0px 6px',
                      fontSize: 12,
                      fontWeight: 700,
                      minWidth: 18,
                      textAlign: 'center',
                      lineHeight: '18px',
                      height: 18,
                    }}
                  >
                    {unread}
                  </span>
                )}
              </div>

              {/* последняя строка: превью + время */}
              <div
                style={{
                  marginTop: 4,
                  display: 'flex',
                  gap: 8,
                  color: '#6b7280',
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    flex: '1 1 auto',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={last}
                >
                  {last}
                </div>
                <div style={{ whiteSpace: 'nowrap' }}>{time}</div>
              </div>
            </button>
          );
        })}
    </div>
  );
}
