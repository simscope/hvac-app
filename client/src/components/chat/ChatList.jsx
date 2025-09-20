import React from 'react';

export default function ChatList({ chats, activeChatId, unreadByChat, onSelect }) {
  return (
    <div style={{display:'grid', gap:8}}>
      {chats.map((c) => {
        const unread = unreadByChat[c.id] || 0;
        const active = c.id === activeChatId;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              textAlign:'left',
              padding:'10px 12px',
              border:'1px solid #e5e7eb',
              borderRadius:10,
              background: active ? '#eef2ff' : '#fff',
              cursor:'pointer',
              display:'flex',
              alignItems:'center',
              justifyContent:'space-between'
            }}
          >
            <div style={{fontWeight:600}}>{c.title || 'Без названия'}</div>
            {unread > 0 && (
              <span style={{
                background:'#ef4444', color:'#fff', borderRadius:9999,
                padding:'2px 8px', fontSize:12, fontWeight:800, minWidth:18, textAlign:'center'
              }}>
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
