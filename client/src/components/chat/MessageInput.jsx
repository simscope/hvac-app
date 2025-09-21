// client/src/components/chat/MessageInput.jsx
import React, { useState, useRef } from 'react';
import { sendMessage } from '../../api/chat';

export default function MessageInput({ chatId, onSent }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const composingRef = useRef(false); // для IME (рус/кит и т.п.)

  const canSend = !sending && text.trim() && chatId;

  async function doSend(e) {
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

  function onKeyDown(e) {
    // Отправка по Enter (без Shift/Alt/Ctrl), при этом не мешаем IME
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !composingRef.current) {
      doSend(e);
    }
  }

  return (
    <form onSubmit={doSend} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
      <input
        type="text"
        placeholder="Напишите сообщение…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={() => (composingRef.current = false)}
        disabled={sending}
        style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}
      />
      <button
        type="submit"
        disabled={!canSend}
        style={{
          padding: '10px 16px',
          borderRadius: 8,
          border: 'none',
          background: canSend ? '#2563eb' : '#cbd5e1',
          color: '#fff',
          fontWeight: 600,
        }}
      >
        Отправить
      </button>
    </form>
  );
}
