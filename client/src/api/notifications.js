// client/src/api/notifications.js
import { supabase } from '../supabaseClient';

/**
 * Возвращает список уведомлений текущего пользователя.
 * Важно: chat_id берём из payload->>chat_id (псевдополем chat_id).
 */
export async function listMyNotifications({ onlyUnread = false, limit = 50 } = {}) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return [];

  let q = supabase
    .from('notifications')
    .select('id, type, payload, read_at, created_at, chat_id:payload->>chat_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (onlyUnread) q = q.is('read_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Пометить одно уведомление прочитанным.
 */
export async function markNotificationRead(id) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Пометить прочитанными ВСЕ уведомления по данному чату текущего пользователя.
 * Тут ключевое — фильтрация по payload->>chat_id.
 */
export async function markChatRead(chatId) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId || !chatId) return;

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
    .filter('payload->>chat_id', 'eq', chatId);

  if (error) throw error;
}

/**
 * Количество непрочитанных уведомлений.
 */
export async function unreadCount() {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return 0;

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw error;
  return count || 0;
}

/**
 * Realtime подписка на новые уведомления.
 * В колбэке фильтруем по user_id (PostgREST-фильтр на канал не повесить).
 */
export function subscribeMyNotifications(onInsert) {
  const ch = supabase
    .channel('notif-feed')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      async (payload) => {
        const row = payload.new;
        try {
          const { data: auth } = await supabase.auth.getUser();
          const userId = auth?.user?.id;
          if (row?.user_id && row.user_id === userId) onInsert?.(row);
        } catch {}
      }
    )
    .subscribe();
  return () => supabase.removeChannel(ch);
}
