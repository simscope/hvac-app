import React, { useRef, useState } from 'react';

export default function MessageInput({
  chatId,
  currentUser,
  disabledSend,
  onTyping,     // (name) => void
  onSend,       // async ({ text, files }) => void
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const handleSend = async () => {
    if (busy || disabledSend) return;
    const trimmed = text.trim();
    const files = Array.from(fileRef.current?.files || []);
    if (!trimmed && files.length === 0) return;

    try {
      setBusy(true);
      await onSend({ text: trimmed, files });
      setText('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      console.error('onSend error:', e);
      alert(e?.message || 'Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (onTyping) onTyping(currentUser?.name || 'Пользователь');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Написать сообщение…"
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8 }}
          disabled={disabledSend || busy}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          id="msg-file"
        />
        <label
          htmlFor="msg-file"
          style={{
            padding: '8px 10px',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            cursor: disabledSend || busy ? 'not-allowed' : 'pointer',
            background: '#fff',
            opacity: disabledSend || busy ? 0.6 : 1,
            userSelect: 'none'
          }}
        >
          📎
        </label>
      </div>

      <button
        type="button"
        onClick={handleSend}
        disabled={disabledSend || busy}
        style={{
          padding: '8px 14px',
          borderRadius: 10,
          border: '1px solid #2563eb',
          background: '#2563eb',
          color: '#fff',
          fontWeight: 700,
          cursor: disabledSend || busy ? 'not-allowed' : 'pointer',
          opacity: disabledSend || busy ? 0.6 : 1
        }}
      >
        Отправить
      </button>
    </div>
  );
}
