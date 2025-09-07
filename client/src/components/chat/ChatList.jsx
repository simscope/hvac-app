import React from 'react';

export default function ChatList({ chats, activeChatId, onSelect }) {
  return (
    <div>
      {(chats || []).map((c) => {
        const isActive = c.chat_id === activeChatId;
        return (
          <div
            key={c.chat_id}
            onClick={() => onSelect(c.chat_id)}
            style={{
              padding:'10px 12px',
              cursor:'pointer',
              background: isActive ? '#f5f7fb' : 'transparent',
              borderBottom:'1px solid #f1f1f1'
            }}
          >
            <div style={{fontWeight:600}}>
              {c.title || (c.is_group ? 'Групповой чат' : 'Диалог')}
            </div>
            <div style={{fontSize:12, color:'#777', marginTop:4}}>
              {c.last_body ? String(c.last_body).slice(0, 48) : 'Нет сообщений'}
            </div>
            {c.unread_count > 0 && (
              <div style={{marginTop:6, fontSize:12, color:'#d00'}}>
                Непрочитано: {c.unread_count}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
