// client/src/api/notifications.js
import { supabase } from '../supabaseClient';

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user || null;
}

/** Список последних уведомлений пользователя */
export async function listMyNotifications(limit = 50) {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,payload,chat_id,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Кол-во непрочитанных */
export async function countMyUnread() {
  const user = await getCurrentUser();
  if (!user) return 0;
  const { data, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) throw error;
  return data?.length ? data.length : (error?.count ?? 0);
}

/** Пометить прочитанными ВСЁ */
export async function markAllRead() {
  const user = await getCurrentUser();
  if (!user) return;
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
}

/** Пометить прочитанными по чату */
export async function markChatRead(chatId) {
  const user = await getCurrentUser();
  if (!user || !chatId) return;
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('chat_id', chatId)
    .is('read_at', null);
}

/** РТ-подписка на новые уведомления текущего пользователя */
export async function subscribeMyNotifications(onInsert) {
  const user = await getCurrentUser();
  if (!user) return () => {};
  const ch = supabase.channel(`notifs:${user.id}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
      (payload) => onInsert?.(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(ch);
}
