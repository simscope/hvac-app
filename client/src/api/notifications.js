// client/src/api/notifications.js
import { supabase } from '../supabaseClient';

/**
 * Получить первые уведомления и количество непрочитанных.
 */
export async function fetchNotifications({ limit = 20 } = {}) {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) return { items: [], unread: 0, user: null };

  const [{ data: items, error }, { count, error: cntErr }] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null),
  ]);
  if (error) throw error;
  if (cntErr) throw cntErr;

  return { items: items ?? [], unread: count ?? 0, user };
}

/**
 * Подписаться на новые уведомления текущего юзера (INSERT).
 * Возвращает функцию отписки.
 */
export async function subscribeNotifications(onNew) {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) return () => {};

  const channel = supabase
    .channel('notifications_' + user.id)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => onNew?.(payload.new)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/** Пометить уведомление прочитанным */
export async function markNotificationRead(id) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Пометить все прочитанными */
export async function markAllRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}
