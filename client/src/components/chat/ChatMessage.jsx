import React from 'react';
import { sendMessage, listMessages, subscribeToChat } from '../../api/chat';

export default function ChatMessage({ m, isMine, receipts }) {
  const r = receipts[m.id] || { delivered:new Set(), read:new Set() };
  const delivered = r.delivered && r.delivered.size > 0;
  const read = r.read && r.read.size > 0;

  return (
    <div style={{ display:'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', margin:'4px 0' }}>
      <div style={{
        maxWidth: '70%', padding:'8px 10px', borderRadius:10,
        background: isMine ? '#dbeafe' : '#f1f5f9'
      }}>
        {m.body && <div style={{whiteSpace:'pre-wrap'}}>{m.body}</div>}
        <div style={{display:'flex', gap:6, alignItems:'center', color:'#94a3b8', fontSize:11, marginTop:4}}>
          <span>{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          {isMine && (
            <span>{read ? '✔✔' : delivered ? '✔✔' : '✔'}</span>  {/* хотите — раскрасьте read */}
          )}
        </div>
      </div>
    </div>
  );
}
