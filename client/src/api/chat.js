// client/src/api/chat.js
import { supabase } from '../supabaseClient';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Отправка текстового сообщения в чат.
 * - гарантирует членство (RPC add_self_to_chat)
 * - создает запись в chat_messages
 * - дергает RPC notify_chat_new_message для уведомлений (не блокирует отправку)
 */
export async function sendMessage(chatId, text, fileUrl = null) {
  if (!UUID_RE.test(String(chatId))) throw new Error(`Invalid chatId: ${chatId}`);
  const body = String(text || '').trim();
  if (!body && !fileUrl) throw new Error('Пустое сообщение');

  // авторизация
  const { data: userRes, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = userRes?.user;
  if (!user) throw new Error('Not authenticated');

  // 1) гарантируем членство
  const { error: addErr } = await supabase.rpc('add_self_to_chat', {
    p_chat_id: chatId,
  });
  if (addErr) throw addErr;

  // 2) создаем сообщение
  const { data: msg, error: msgErr } = await supabase
    .from('chat_messages')
    .insert({
      chat_id: chatId,
      author_id: user.id,
      body: body || null,
      file_url: fileUrl ?? null,
    })
    .select()
    .single();

  if (msgErr) throw msgErr;

  // 3) уведомления — НЕ блокируем отправку (ловим в try/catch)
  try {
    await supabase.rpc('notify_chat_new_message', {
      p_chat_id: chatId,
      p_message_id: msg.id,
      p_author_id: user.id,
      p_text: body || null,
    });
  } catch (e) {
    // не мешаем пользователю, просто лог
    // eslint-disable-next-line no-console
    console.warn('notify rpc failed:', e?.message || e);
  }

  return msg;
}

export async function listMessages(chatId, limit = 200) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(
      'id, chat_id, author_id, body, attachment_url, created_at, file_url, file_name, file_type, file_size'
    )
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export function subscribeToChat(chatId, onInsert) {
  const ch = supabase
    .channel(`chat_${chatId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`,
      },
      (payload) => onInsert?.(payload.new)
    )
    .subscribe();

  return () => supabase.removeChannel(ch);
}
