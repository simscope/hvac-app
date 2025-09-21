// client/src/components/notifications/NotificationsBell.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import * as notif from '../../api/notifications'; // ← namespace-импорт

export default function NotificationsBell() {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = useMemo(
    () => items.filter(n => !n.read_at).length,
    [items]
  );

  // auth
  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user ?? null);
      sub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    })();
    return () => { try { sub?.data?.subscription?.unsubscribe(); } catch {} };
  }, []);

  // начальная загрузка + RT
  useEffect(() => {
    if (!user?.id) { setItems([]); return; }

    let mounted = true;
    (async () => {
      setLoading(true);
      const { data } = await notif.listMyNotifications(50);
      if (mounted) setItems(data || []);
      setLoading(false);
    })();

    const ch = supabase
      .channel('notif-rt')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => setItems(prev => [payload.new, ...prev].slice(0, 200))
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => setItems(prev => prev.map(i => i.id === payload.new.id ? payload.new : i))
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [user?.id]);

  // синхронизация бейджа в шапке
  useEffect(() => {
    const total = unreadCount;
    localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail:{ total } }));
  }, [unreadCount]);

  const markAllVisibleAsRead = async () => {
    const unreadIds = items.filter(n => !n.read_at).map(n => n.id);
    if (!unreadIds.length) return;
    const { error } = await notif.markManyAsReadByIds(unreadIds);
    if (!error) {
      const now = new Date().toISOString();
      setItems(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, read_at: now } : n));
    }
  };

  const onClickItem = async (n) => {
    if (!n) return;

    if (!n.read_at) {
      const { error } = await notif.markManyAsReadByIds([n.id]);
      if (!error) {
        setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      }
    }

    const chatId = n.payload?.chat_id;
    const messageId = n.payload?.message_id;
    window.dispatchEvent(new CustomEvent('open-chat-message', { detail: { chatId, messageId } }));
    setOpen(false);
  };

  return (
    <div style={{ position:'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Уведомления"
        style={{ width:36,height:36,borderRadius:9999,border:'1px solid #e5e7eb', background:'#fff',position:'relative',cursor:'pointer' }}
      >
        🔔
        {!!unreadCount && (
          <span style={{
            position:'absolute', top:-4, right:-4,
            background:'#ef4444', color:'#fff', borderRadius:9999,
            padding:'1px 6px', fontSize:12, fontWeight:700, minWidth:18, textAlign:'center'
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position:'absolute', right:0, top:44, width:360, maxHeight:480,
            background:'#fff', border:'1px solid #e5e7eb', borderRadius:12,
            boxShadow:'0 10px 20px rgba(0,0,0,.08)', overflow:'auto', zIndex:100
          }}
        >
          <div style={{ padding:'10px 14px', fontWeight:800, display:'flex', justifyContent:'space-between' }}>
            <span>Уведомления</span>
            <button
              onClick={markAllVisibleAsRead}
              style={{ fontSize:12, border:'none', background:'transparent', color:'#2563eb', cursor:'pointer' }}
              disabled={!unreadCount || loading}
            >
              Пометить всё прочитанным
            </button>
          </div>

          {loading && <div style={{ padding:14, color:'#6b7280' }}>Загрузка…</div>}
          {!loading && !items.length && <div style={{ padding:14, color:'#6b7280' }}>Нет уведомлений</div>}

          {items.map(n => (
            <div
              key={n.id}
              onClick={() => onClickItem(n)}
              style={{
                padding:'10px 14px', borderTop:'1px solid #f3f4f6', cursor:'pointer',
                background: n.read_at ? '#fff' : '#eef2ff'
              }}
            >
              <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Новое сообщение</div>
              <div style={{ color:'#374151', fontSize:14, marginBottom:6 }}>
                {n.payload?.text || 'Сообщение'}
              </div>
              <div style={{ color:'#6b7280', fontSize:12 }}>
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
