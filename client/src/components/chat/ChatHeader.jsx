// client/src/components/chat/ChatHeader.jsx
import React from 'react';

export default function ChatHeader({
  chat,
  typingText,
  members = [],       // [{id, name}]
  selfId,             // текущий участник (technicians.id или auth.uid)
  onCallTo,           // (memberId) => void
  canCall = true
}) {
  return (
    <div style={{
      padding:'10px 12px',
      borderBottom:'1px solid #eee',
      display:'flex',
      alignItems:'center',
      justifyContent:'space-between',
      gap:12
    }}>
      <div style={{minWidth:0}}>
        <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
          {chat?.title || 'Диалог'}
        </div>
        {!!typingText && (
          <div style={{fontSize:12, color:'#888', marginTop:2, overflow:'hidden', textOverflow:'ellipsis'}}>
            {typingText}
          </div>
        )}
      </div>

      <div style={{display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end'}}>
        {members
          .filter(m => m.id && m.id !== selfId)
          .map(m => (
            <button
              key={m.id}
              onClick={() => onCallTo?.(m.id)}
              disabled={!canCall}
              title={!canCall ? 'Вход не выполнен' : `Позвонить: ${m.name}`}
              style={{padding:'6px 10px', borderRadius:8, border:'1px solid #e5e5e5', background:'#fff', cursor: canCall ? 'pointer' : 'not-allowed'}}
            >
              📞 {m.name}
            </button>
        ))}
      </div>
    </div>
  );
}
