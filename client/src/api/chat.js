// client/src/api/chat.js
import { supabase } from '../supabaseClient';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Отправка сообщения:
 * 1) гарантируем членство (через RPC add_self_to_chat → technicians.auth_user_id)
 * 2) шлём сообщение через RPC send_message
 */
export async function sendMessage(chatId, text, fileUrl = null) {
  if (!UUID_RE.test(String(chatId))) throw new Error(`Invalid chatId: ${chatId}`);
  const body = String(text ?? '').trim();
  if (!body) throw new Error('Пустое сообщение');

  // Проверим авторизацию
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) throw new Error('Not authenticated');

  // 1) Корректное «вступление» в чат (членство через technicians → chat_members)
  const { error: addErr } = await supabase.rpc('add_self_to_chat', { p_chat_id: chatId });
  if (addErr) throw addErr;

  // 2) Отправка
  const { data, error } = await supabase.rpc('send_message', {
    p_chat_id: chatId,
    p_body: body,
    p_file_url: fileUrl ?? null,
  });
  if (error) throw error;
  return data;
}

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
