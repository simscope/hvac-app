import React from 'react';

export default function ChatList({ chats, activeChatId, onSelect }) {
  return (
    <div style={{display:'grid'}}>
      {chats.map(c => (
        <button
          key={c.chat_id}
          onClick={() => onSelect(c.chat_id)}
          style={{
            textAlign:'left', padding:'10px 12px', border:'none',
            borderBottom:'1px solid #f1f5f9',
            background: c.chat_id === activeChatId ? '#f8fafc' : '#fff',
            cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'
          }}
        >
          <div style={{minWidth:0}}>
            <div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.title || 'Чат'}</div>
            <div style={{color:'#94a3b8', fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {c.last_body || '—'}
            </div>
          </div>
          {!!c.unread_count && (
            <span style={{background:'#ef4444', color:'#fff', borderRadius:9999, padding:'2px 8px',
              fontSize:12, fontWeight:700, marginLeft:8, minWidth:20, textAlign:'center'}}>
              {c.unread_count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
