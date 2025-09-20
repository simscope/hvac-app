import React from 'react';

export default function ChatList({ chats, activeChatId, onSelect }) {
  return (
    <div style={{ display: 'grid' }}>
      {(!chats || chats.length === 0) && (
        <div style={{ color: '#6b7280', padding: 12 }}>Чатов пока нет</div>
      )}
      {chats.map((c) => {
        const active = c.chat_id === activeChatId;
        return (
          <button
            key={c.chat_id}
            onClick={() => onSelect(c.chat_id)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid #f1f5f9',
              background: active ? '#eef2ff' : '#fff',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            <div style={{ fontWeight: 700 }}>{c.title || 'Без названия'}</div>
            {c.last_body && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.last_body}
              </div>
            )}

            {!!c.unread_count && c.unread_count > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 12,
                  background: '#ef4444',
                  color: '#fff',
                  borderRadius: 9999,
                  padding: '2px 6px',
                  fontSize: 12,
                  fontWeight: 800,
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {c.unread_count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
