// client/api/chat.js
import { supabase } from '../supabaseClient';

/** Отправка сообщения через RPC, автоматически создаёт квитанции */
export async function sendMessage(chatId, text, fileUrl = null) {
  const { data, error } = await supabase.rpc('send_message', {
    p_chat_id: chatId,
    p_body: text,
    p_file_url: fileUrl,
  });
  if (error) throw error;
  return data;
}

/** Загрузка истории сообщений */
export async function listMessages(chatId, limit = 200) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Подписка на новые сообщения (Realtime) */
export function subscribeToChat(chatId, onInsert) {
  const ch = supabase
    .channel(`chat_${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${chatId}` },
      (payload) => onInsert?.(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/** Отметить сообщения прочитанными текущим пользователем */
export async function markRead(chatId, messageIds) {
  if (!messageIds?.length) return;
  const { data: { user } } = await supabase.auth.getUser();
  const rows = messageIds.map(id => ({
    chat_id: chatId,
    message_id: id,
    user_id: user.id,
    status: 'read',
    read_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('message_receipts')
    .upsert(rows, { onConflict: 'chat_id,message_id,user_id' });
  if (error) throw error;
}
