// client/src/components/notifications/NotificationsBell.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

function Item({ n, onOpen }) {
  const payload = n?.payload || {};
  const title = n?.type === 'chat:new_message' ? 'Новое сообщение' : (n?.type || 'Событие');
  const text  = payload?.text || '';
  const dt = n?.created_at ? new Date(n.created_at).toLocaleString() : '';

  const unread = !n.read_at;

  return (
    <button
      onClick={() => onOpen?.(n)}
      style={{
        width:'100%', textAlign:'left', padding:'10px 12px', border:'none', background:'#fff',
        borderBottom:'1px solid #eee', cursor:'pointer'
      }}
    >
      <div style={{fontWeight:700, color: unread ? '#111827' : '#6b7280'}}>{title}</div>
      {text && <div style={{color:'#374151', marginTop:4}}>{text}</div>}
      <div style={{fontSize:12, color:'#9ca3af', marginTop:4}}>{dt}</div>
    </button>
  );
}

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const userIdRef = useRef(null);

  // загрузка пользователя
  useEffect(() => {
    let unsubAuth;
    (async () => {
      const { data } = await supabase.auth.getUser();
      userIdRef.current = data?.user?.id || null;
      await load();
      // realtime подписка только на свои уведомления
      sub();
    })();

    function sub() {
      const ch = supabase
        .channel('notif-self')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userIdRef.current}` },
          async () => load(true)
        )
        .subscribe();
      return () => supabase.removeChannel(ch);
    }

    return () => {
      try { unsubAuth?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(silent=false) {
    if (!userIdRef.current) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userIdRef.current)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) setRows(data || []);

    // синхронизируем бейдж в top-nav через кастомное событие
    const total = (data || []).filter(x => !x.read_at).length;
    localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
    window.dispatchEvent(new CustomEvent('chat-unread-changed', { detail: { total } }));
  }

  const unread = useMemo(() => rows.filter(r => !r.read_at).length, [rows]);

  async function markAllRead() {
    if (!userIdRef.current) return;
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userIdRef.current)
      .is('read_at', null);

    load(true);
  }

  async function openOne(n) {
    // помечаем прочитанным и открываем чат+сообщение
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', n.id);

    const chatId = n?.payload?.chat_id;
    const msgId  = n?.payload?.message_id; // если есть
    if (chatId) {
      const url = msgId ? `/chat?chat=${chatId}&mid=${msgId}` : `/chat?chat=${chatId}`;
      window.location.assign(url);
    }
    setOpen(false);
  }

  return (
    <div style={{ position:'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          position:'relative',
          width:40, height:40, borderRadius:9999, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer'
        }}
        title="Уведомления"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position:'absolute', top:-6, right:-6,
            background:'#ef4444', color:'#fff', borderRadius:9999, padding:'2px 6px',
            fontSize:12, fontWeight:700, minWidth:18, textAlign:'center'
          }}>{unread}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position:'absolute', right:0, marginTop:6, width:330, maxHeight:400,
            overflow:'auto', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,.08)', zIndex:50
          }}
        >
          <div style={{padding:'10px 12px', fontWeight:800, borderBottom:'1px solid #eee', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div>Уведомления</div>
            {unread > 0 && (
              <button onClick={markAllRead} style={{border:'none', background:'transparent', color:'#2563eb', cursor:'pointer', fontWeight:700}}>
                Отметить прочитанными
              </button>
            )}
          </div>

          {rows.length === 0 && <div style={{padding:20, color:'#6b7280'}}>Нет уведомлений</div>}
          {rows.map(n => <Item key={n.id} n={n} onOpen={openOne} />)}
        </div>
      )}
    </div>
  );
}
