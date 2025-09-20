import React, { useState, useRef } from 'react';
import { supabase } from '../../supabaseClient';

export default function MessageInput({ chatId, currentUserId, disabledSend }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const send = async () => {
    const body = text.trim();
    if (!chatId || !currentUserId || (!body && !fileRef.current?.files?.length)) return;
    setBusy(true);
    try {
      // 1) создаём сообщение
      const { data: msg, error } = await supabase
        .from('chat_messages')
        .insert({ chat_id: chatId, author_id: currentUserId, body: body || null })
        .select()
        .single();
      if (error) throw error;

      // 2) первая выбранная «вложуха» — в поля file_*
      const file = fileRef.current?.files?.[0];
      if (file) {
        const clean = file.name.replace(/[^0-9A-Za-z._-]+/g, '_');
        const path = `${chatId}/${msg.id}/${Date.now()}_${clean}`;
        const up = await supabase.storage.from('chat-attachments').upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false
        });
        if (!up.error) {
          await supabase.from('chat_messages')
            .update({
              file_url: path,
              file_name: clean,
              file_type: file.type,
              file_size: file.size
            })
            .eq('id', msg.id);
        }
        fileRef.current.value = '';
      }
      setText('');
    } catch (e) {
      console.error('send msg', e);
      alert('Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8}}>
      <div style={{display:'flex', gap:8}}>
        <input
          type="file"
          ref={fileRef}
          style={{alignSelf:'center'}}
        />
        <textarea
          rows={1}
          disabled={disabledSend || busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={disabledSend ? 'Отправка недоступна' : 'Напишите сообщение…'}
          style={{flex:'1 1 auto', resize:'none', padding:'10px', border:'1px solid #e5e7eb', borderRadius:10}}
        />
      </div>
      <button
        onClick={send}
        disabled={disabledSend || busy}
        style={{padding:'10px 14px', borderRadius:10, border:'1px solid #2563eb', background:'#2563eb', color:'#fff', fontWeight:700}}
      >
        Отправить
      </button>
    </div>
  );
}
