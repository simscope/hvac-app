// client/src/components/chat/ChatList.jsx
import React from 'react';
import { sendMessage } from '../../api/chat';

export default function ChatList({ chats, activeChatId, onSelect, unreadByChat = {} }) {
  if (!chats?.length) {
    return <div style={{ padding: 12, color: '#888' }}>Чатов пока нет</div>;
  }

  return (
    <div>
      {chats.map((c) => {
        const unread = unreadByChat[c.chat_id] || 0;
        const active = c.chat_id === activeChatId;

        return (
          <div
            key={c.chat_id}
            onClick={() => onSelect?.(c.chat_id)}
            style={{
              cursor: 'pointer',
              padding: '10px 12px',
              background: active ? '#eef2ff' : '#fff',
              borderBottom: '1px solid #f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title || 'Без названия'}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                {c.last_at ? new Date(c.last_at).toLocaleString() : '—'}
              </div>
            </div>

            {unread > 0 && (
              <span style={{
                background:'#ef4444', color:'#fff', borderRadius:9999, padding:'2px 8px',
                fontSize:12, fontWeight:700, minWidth:22, textAlign:'center'
              }}>
                {unread}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}



