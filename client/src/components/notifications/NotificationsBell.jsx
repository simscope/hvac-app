import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]); // rows из public.notifications
  const [userId, setUserId] = useState(null);
  const subRef = useRef(null);
  const nav = useNavigate();

  // кто я
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data?.user?.id || null);
    })();
  }, []);

  // загрузка + realtime подписка
  useEffect(() => {
    if (!userId) return;

    const load = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error) setItems(data || []);
    };
    load();

    if (subRef.current) supabase.removeChannel(subRef.current);
    const ch = supabase
      .channel(`noti-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();
    subRef.current = ch;

    const h = () => load();
    window.addEventListener('notifications-changed', h);

    return () => {
      window.removeEventListener('notifications-changed', h);
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const unread = useMemo(() => (items || []).filter(i => !i.read_at).length, [items]);

  const openNotification = async (n) => {
    if (!n) return;

    // ставим read_at мгновенно (и локально тоже) — без перезагрузки
    const now = new Date().toISOString();
    await supabase.from('notifications').update({ read_at: now }).eq('id', n.id);
    setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: now } : x));
    window.dispatchEvent(new CustomEvent('notifications-changed'));

    const chatId = n.payload?.chat_id || n.chat_id; // на случай старых записей
    const messageId = n.payload?.message_id || null;

    // переходим в чат и (опционально) подсвечиваем сообщение
    nav('/chat', { state: { chatId, highlightMessageId: messageId } });
    setOpen(false);
  };

  // по открытию колокола — можно прочитать ВСЁ (опционально)
  const markAllRead = async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('user_id', userId)
      .is('read_at', null);
    setItems(prev => prev.map(x => x.read_at ? x : { ...x, read_at: now }));
    window.dispatchEvent(new CustomEvent('notifications-changed'));
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { const next = !open; setOpen(next); if (next) markAllRead(); }}
        title="Уведомления"
        style={{
          position:'relative',
          width:36, height:36, borderRadius:18, border:'1px solid #e5e7eb',
          background:'#fff', cursor:'pointer'
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position:'absolute', top:-4, right:-4,
            background:'#ef4444', color:'#fff', borderRadius:9999, padding:'2px 6px',
            fontSize:12, fontWeight:700, minWidth:18, textAlign:'center'
          }}>{unread}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position:'absolute', right:0, top:44, width:360, maxHeight:420, overflow:'auto',
            background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, boxShadow:'0 10px 30px rgba(0,0,0,.08)', zIndex:50
          }}
        >
          <div style={{ padding:'10px 12px', fontWeight:800 }}>Уведомления</div>
          {(items?.length ? items : []).map(n => (
            <div
              key={n.id}
              onClick={() => openNotification(n)}
              style={{
                padding:'10px 12px', cursor:'pointer',
                background: n.read_at ? '#fff' : '#eef2ff',
                borderTop:'1px solid #f3f4f6'
              }}
            >
              <div style={{ fontWeight:700 }}>Новое сообщение</div>
              <div style={{ color:'#374151' }}>{n.payload?.text || 'Сообщение в чате'}</div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
          {!items?.length && <div style={{ padding:12, color:'#6b7280' }}>Нет уведомлений</div>}
        </div>
      )}
    </div>
  );
}
