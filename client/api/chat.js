// client/api/chat.js
import { supabase } from '../supabaseClient';

export async function sendMessage(chatId, text, fileUrl = null) {
  const { data, error } = await supabase.rpc('send_message', {
    p_chat_id: chatId,
    p_body: text,
    p_file_url: fileUrl,
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
