// client/components/chat/MessageInput.jsx
import React, { useState } from 'react';
import { sendMessage } from '../../api/chat';

export default function MessageInput({ chatId, onSent }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = !sending && text.trim() && chatId;

  async function handleSend(e) {
    e?.preventDefault?.();
    if (!canSend) return;
    try {
      setSending(true);
      const msg = await sendMessage(chatId, text.trim(), null);
      setText('');
      onSent?.(msg);
    } catch (err) {
      console.error('Message send error:', err);
      alert(err.message || 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSend} style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
      <input
        type="text"
        placeholder="Напишите сообщение…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sending}
        style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 12px' }}
      />
      <button
        type="submit"
        disabled={!canSend}
        style={{
          padding:'10px 16px', borderRadius:8, border:'none',
          background: canSend ? '#2563eb' : '#cbd5e1', color:'#fff', fontWeight:600
        }}
      >
        Отправить
      </button>
    </form>
  );
}
