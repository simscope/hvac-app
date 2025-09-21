// client/src/api/chat.js
import { supabase } from '../supabaseClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sendMessageDirect(chatId, authorId, text) {
  const body = String(text || '').trim();
  if (!UUID_RE.test(String(chatId))) throw new Error(`Invalid chatId: ${chatId}`);
  if (!UUID_RE.test(String(authorId))) throw new Error(`Invalid author: ${authorId}`);
  if (!body) throw new Error('Пустое сообщение');

  // 1) создаём запись сообщения
  const { data: msg, error: insErr } = await supabase
    .from('chat_messages')
    .insert({ chat_id: chatId, author_id: authorId, body })
    .select()
    .single();

  if (insErr) throw insErr;

  // 2) создаём уведомления через RPC (SECURITY DEFINER – обходит RLS корректно)
  const { error: notifErr } = await supabase.rpc('notify_chat_new_message', {
    p_chat_id: chatId,
    p_message_id: msg.id,
    p_author: authorId,
    p_text: body,
  });
  if (notifErr) {
    // не падаем отправкой – логни и продолжай
    console.warn('notify_chat_new_message error', notifErr);
  }

  return msg;
}

export async function upsertReceiptDelivered(chatId, messageId, userId) {
  // уникальность по (message_id, user_id, status) – как в БД
  return supabase.from('message_receipts').upsert([{
    chat_id: chatId,
    message_id: messageId,
    user_id: userId,
    status: 'delivered',
  }], { onConflict: 'message_id,user_id,status' });
}

export async function upsertReceiptRead(chatId, ids, userId) {
  if (!ids?.length) return;
  const rows = ids.map(message_id => ({
    chat_id: chatId,
    message_id,
    user_id: userId,
    status: 'read',
  }));
  return supabase.from('message_receipts').upsert(rows, {
    onConflict: 'message_id,user_id,status',
  });
}
