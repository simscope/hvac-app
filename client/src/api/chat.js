// client/src/api/chat.js
import { supabase } from '../supabaseClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function throwDetailed(error, ctx = '') {
  // раскрываем ошибку Supabase/PostgREST целиком
  const msg = (error && (error.message || error.error_description || error.hint || error.details)) || 'Unknown error';
  console.error('RPC error', { ctx, error });
  throw new Error(msg);
}

/** Отправка сообщения: гарантируем членство → RPC */
export async function sendMessage(chatId, text, fileUrl = null) {
  if (!UUID_RE.test(String(chatId))) throw new Error(`Invalid chatId: ${chatId}`);
  if (!text || !String(text).trim()) throw new Error('Пустое сообщение');

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throwDetailed(authErr, 'getUser');
  if (!user) throw new Error('Not authenticated');

  // 1) самовступление (требует политики insert на chat_members для authenticated)
  const { error: upsertErr } = await supabase
    .from('chat_members')
    .upsert({ chat_id: chatId, member_id: user.id }, { onConflict: 'chat_id,member_id' });
  if (upsertErr) throwDetailed(upsertErr, 'chat_members.upsert');

  // 2) вызов RPC
  const { data, error } = await supabase.rpc('send_message', {
    p_chat_id: chatId,
    p_body: String(text).trim(),
    p_file_url: fileUrl ?? null,
  });
  if (error) throwDetailed(error, 'rpc.send_message');
  return data;
}

/** История сообщений */
export async function listMessages(chatId, limit = 200) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
  .limit(limit);
  if (error) throwDetailed(error, 'listMessages');
  return data;
}

/** Realtime-подписка на новые сообщения */
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
