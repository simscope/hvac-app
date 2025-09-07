import React from 'react';


export default function ChatHeader({ chat, typingText, onCall }) {
return (
<div style={{borderBottom:'1px solid #eee', padding:'8px 12px', display:'flex', alignItems:'center', gap:12}}>
<div style={{fontWeight:700, fontSize:16, flex:'0 0 auto'}}>
{chat?.title || (chat?.is_group ? 'Групповой чат' : 'Диалог')}
</div>
<div style={{flex:'1 1 auto', color:'#777', fontSize:13}}>
{typingText}
</div>
<button onClick={onCall} disabled={!chat} title="Аудио звонок">🎙️ Аудио</button>
</div>
);
}