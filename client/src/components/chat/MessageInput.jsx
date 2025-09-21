// client/src/components/chat/MessageInput.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Простой инпут сообщений с:
 * - отправкой по Enter (Shift+Enter — новая строка)
 * - выбором/сбросом файлов (первые файлы отправляются вместе с текстом)
 * - колбэком onTypingPulse() для "печатает…" (вызывается с лёгким дебаунсом)
 *
 * Props:
 * - chatId: UUID активного чата
 * - disabled?: boolean
 * - onSend: ({ text, files }) => Promise<void> | void
 * - onSent?: (msgLike) => void   // опционально
 * - onTypingPulse?: () => void   // опционально
 * - canSend?: boolean            // переопределение disabled логики
 */
export default function MessageInput({
  chatId,
  disabled = false,
  onSend,
  onSent,
  onTypingPulse,
  canSend, // если не задан — вычисляется из локального состояния
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);

  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const normalizedCanSend = useMemo(() => {
    const hasContent = text.trim().length > 0 || files.length > 0;
    return canSend ?? (!disabled && !sending && !!chatId && hasContent);
  }, [canSend, disabled, sending, chatId, text, files]);

  // Дебаунс для onTypingPulse
  const typingDebounceRef = useRef(null);
  const pulseTyping = useCallback(() => {
    if (!onTypingPulse) return;
    clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      try { onTypingPulse(); } catch {}
    }, 300);
  }, [onTypingPulse]);

  useEffect(() => () => clearTimeout(typingDebounceRef.current), []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChooseFiles = (e) => {
    const chosen = Array.from(e.target.files || []);
    if (!chosen.length) return;
    setFiles(prev => [...prev, ...chosen]);
  };

  const removeFileAt = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    // вернуть фокус в поле ввода
    inputRef.current?.focus();
  };

  const clearForm = () => {
    setText('');
    setFiles([]);
    try { if (fileRef.current) fileRef.current.value = ''; } catch {}
  };

  const submit = async () => {
    if (!normalizedCanSend || !onSend) return;
    const payload = {
      text: text.trim(),
      files
    };
    try {
      setSending(true);
      await onSend(payload);
      onSent?.(payload);
      clearForm();
    } catch (err) {
      console.error('Message send error:', err);
      alert(err?.message || 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
      // вернуть фокус
      inputRef.current?.focus();
    }
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <textarea
          ref={inputRef}
          rows={2}
          placeholder="Напишите сообщение… (Enter — отправить, Shift+Enter — новая строка)"
          value={text}
          onChange={(e) => { setText(e.target.value); pulseTyping(); }}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending || !chatId}
          style={{
            width:'100%',
            resize:'none',
            border:'1px solid #e5e7eb',
            borderRadius:8,
            padding:'10px 12px',
            outline:'none'
          }}
        />

        {files.length > 0 && (
          <div style={{
            display:'flex', flexWrap:'wrap', gap:8,
            background:'#f9fafb', border:'1px dashed #e5e7eb', borderRadius:8, padding:8
          }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:8,
                border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 8px', background:'#fff'
              }}>
                <span style={{ fontSize:12, color:'#374151' }}>
                  {f.name} {f.size ? `(${Math.round(f.size/1024)} KB)` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => removeFileAt(i)}
                  style={{
                    border:'none', background:'transparent', color:'#ef4444',
                    cursor:'pointer', fontWeight:700, fontSize:12
                  }}
                  title="Убрать"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label
            style={{
              display:'inline-flex', alignItems:'center', gap:6,
              border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 10px',
              cursor:'pointer', background:'#fff', fontWeight:600
            }}
          >
            📎 Файл
            <input
              ref={fileRef}
              type="file"
              multiple
              onChange={handleChooseFiles}
              style={{ display:'none' }}
              disabled={disabled || sending || !chatId}
            />
          </label>

          <button
            type="button"
            onClick={submit}
            disabled={!normalizedCanSend}
            style={{
              padding:'10px 16px',
              borderRadius:8,
              border:'none',
              background: normalizedCanSend ? '#2563eb' : '#cbd5e1',
              color:'#fff',
              fontWeight:700,
              cursor: normalizedCanSend ? 'pointer' : 'not-allowed'
            }}
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
