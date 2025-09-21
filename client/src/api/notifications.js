// client/src/api/notifications.js
import { supabase } from '../supabaseClient';

/** Получить последние уведомления текущего пользователя */
export async function listMyNotifications(limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/** Пометить список уведомлений прочитанными */
export async function markManyAsReadByIds(ids = []) {
  if (!ids?.length) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids);
  return { error };
}

/** Пометить все уведомления по конкретному чату прочитанными */
export async function markByChatIdAsRead(chatId) {
  if (!chatId) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .filter('payload->>chat_id', 'eq', String(chatId));
  return { error };
}

// На всякий случай — default-экспорт теми же функциями,
// чтобы любой способ импорта работал.
const api = {
  listMyNotifications,
  markManyAsReadByIds,
  markByChatIdAsRead,
};
export default api;
