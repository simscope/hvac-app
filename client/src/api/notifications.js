// клиентские помощники для уведомлений
import { supabase } from '../supabaseClient';

/**
 * Вернёт непрочитанные уведомления текущего пользователя.
 * Можно ограничить по типу/чату.
 */
export async function listMyNotifications({ type, chatId } = {}) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) return [];

  let q = supabase.from('notifications').select('*')
    .eq('user_id', user.id)
    .is('read_at', null)
    .order('created_at', { ascending: false });

  if (type)   q = q.eq('type', type);
  if (chatId) q = q.eq('chat_id', chatId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Пометить набор уведомлений прочитанными. */
export async function markRead(ids = []) {
  if (!ids.length) return;
  const { error } = await supabase.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}

/** Пометить ВСЕ уведомления по чату прочитанными. */
export async function markChatRead(chatId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !chatId) return;

  const { error } = await supabase.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('chat_id', chatId)
    .eq('type', 'chat:new_message')
    .is('read_at', null);
  if (error) console.warn('notif markChatRead error', error);
}

/** Пересчитать общий счётчик и распространить событие наверх (для TopNav). */
export async function recalcAndDispatchUnreadTotal() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  const total = error ? 0 : (count ?? 0);
  try { localStorage.setItem('CHAT_UNREAD_TOTAL', String(total)); } catch {}
  const ev = new CustomEvent('chat-unread-changed', { detail: { total } });
  window.dispatchEvent(ev);
  return total;
}
