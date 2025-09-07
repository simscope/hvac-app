import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function ChatInput({ chatId, onAdded, onSent }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text && !file) return;
    setSending(true);

    try {
      let fileMeta = {};

      if (file) {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = authData?.user;
        if (!user) throw new Error('Не авторизован');

        const path = `${user.id}/${Date.now()}_${file.name}`;

        const { error: uploadErr } = await supabase
          .storage
          .from('chat_uploads')
          .upload(path, file, {
            upsert: false,
            contentType: file.type,
          });
        if (uploadErr) throw uploadErr;

        const { data: signed, error: urlErr } = await supabase
          .storage
          .from('chat_uploads')
          .createSignedUrl(path, 60 * 60);
        if (urlErr) throw urlErr;

        fileMeta = {
          file_url: signed?.signedUrl || null,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          storage_path: path,
        };
      }

      const payload = {
        chat_id: chatId,
        text: text || null,
        ...fileMeta,
      };

      // Сразу получаем вставленную строку обратно
      const { data: inserted, error: insErr } = await supabase
        .from('chat_messages')
        .insert(payload)
        .select()
        .single();

      if (insErr) throw insErr;

      // Мгновенно добавляем в ленту
      onAdded?.(inserted);

      setText('');
      setFile(null);
      onSent?.();
    } catch (e) {
      alert('Ошибка отправки: ' + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
      <input
        type="text"
        placeholder="Сообщение…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sending}
      />
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={sending}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar"
      />
      <button onClick={handleSend} disabled={sending}>
        Отправить
      </button>
    </div>
  );
}
