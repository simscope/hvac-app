// client/src/pages/TasksTodayPage.jsx
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(tz);

const NY = 'America/New_York';

/* ===== UI ===== */
const PAGE = { padding: 16, display: 'grid', gap: 12 };
const ROW = { display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 };
const BOX = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const H = { margin: '6px 0 10px', fontWeight: 700, fontSize: 18 };
const BTN = { padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#111827', color: '#fff', cursor: 'pointer' };
const BTN_L = { ...BTN, background: '#fff', color: '#111827' };
const INPUT = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 10 };
const TA = { ...INPUT, minHeight: 80 };
const CHIP = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 999, cursor: 'pointer', background: '#fff' };

/** Сегодня (DATE) в зоне NY */
function nyToday() { return dayjs().tz(NY).format('YYYY-MM-DD'); }
/** Дата/время формы -> ISO (NY) */
function toNYTzISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = dayjs.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm', NY);
  return d.isValid() ? d.toISOString() : null;
}

/* «Это неоплатный таск?» — определяем по type и тегам */
function isPaymentTask(t) {
  const tp = String(t?.type || '').toLowerCase();
  const tags = Array.isArray(t?.tags) ? t.tags.map((s) => String(s).toLowerCase()) : [];
  const typeHit = ['payment', 'payment_due', 'unpaid', 'scf', 'invoice'].some(k => tp.includes(k));
  const tagHit = tags.some(s => /payment|invoice|scf|оплат/i.test(s));
  return typeHit || tagHit;
}

export default function TasksTodayPage() {
  const mounted = useRef(true);
  const lastTick = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  const [me, setMe] = useState(null);
  const [managers, setManagers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [comments, setComments] = useState({});
  const [notif, setNotif] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);

  /* ---------- auth ---------- */
  useEffect(() => {
    let unsub = null;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (mounted.current) setMe(s?.session?.user ?? null);
      const { data } = supabase.auth.onAuthStateChange((_e, session) => {
        if (mounted.current) setMe(session?.user ?? null);
      });
      unsub = data?.subscription;
    })();
    return () => unsub?.unsubscribe?.();
  }, []);

  /* ---------- managers ---------- */
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['admin', 'manager'])
        .order('role', { ascending: true });
      if (!error && mounted.current) setManagers(data || []);
    })();
  }, []);

  /* ---------- load today ---------- */
  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    const today = nyToday();

    try {
      // серверная логика
      await supabase.rpc('rollover_open_tasks_to_today');
      await supabase.rpc('ensure_payment_tasks_for_today', { p_user: me.id });
      await supabase.rpc('tick_task_reminders');

      // выборка задач на сегодня (DATE)
      const { data: t, error: tErr } = await supabase
        .from('tasks')
        .select('id,title,details,status,type,job_id,job_number,due_date,assignee_id,priority,tags,reminder_at,remind_every_minutes,last_reminded_at,created_at,updated_at')
        .eq('due_date', today)
        .order('status', { ascending: true })
        .order('updated_at', { ascending: false });

      if (tErr) throw tErr;
      if (mounted.current) setTasks(t || []);

      // комментарии
      let commentsMap = {};
      if ((t || []).length) {
        const ids = t.map(x => x.id);
        const { data: cs, error: cErr } = await supabase
          .from('task_comments')
          .select('id,task_id,body,author_id,created_at, profiles:author_id (full_name)')
          .in('task_id', ids)
          .order('created_at', { ascending: false });

        if (!cErr) {
          (cs || []).forEach(c => {
            (commentsMap[c.task_id] ||= []).push({
              id: c.id,
              task_id: c.task_id,
              body: c.body,
              author_id: c.author_id,
              author_name: c?.profiles?.full_name || (c.author_id || '').slice(0, 8),
              created_at: c.created_at
            });
          });
          if (mounted.current) setComments(commentsMap);
        } else if (mounted.current) {
          setComments({});
        }
      } else if (mounted.current) {
        setComments({});
      }

      // 🛠 Самоисправление: если "неоплатный" таск активен, но у него уже есть комменты — закрываем.
      const toClose = (t || []).filter(x =>
        x.status === 'active' && isPaymentTask(x) && (commentsMap[x.id]?.length > 0)
      );
      if (toClose.length) {
        await supabase
          .from('tasks')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .in('id', toClose.map(x => x.id));
        // перезагрузим, чтобы увидеть изменения
        const { data: t2 } = await supabase
          .from('tasks')
          .select('id,title,details,status,type,job_id,job_number,due_date,assignee_id,priority,tags,reminder_at,remind_every_minutes,last_reminded_at,created_at,updated_at')
          .eq('due_date', today)
          .order('status', { ascending: true })
          .order('updated_at', { ascending: false });
        if (mounted.current && t2) setTasks(t2);
      }
    } catch (e) {
      console.error('[TasksToday] load error:', e);
      if (mounted.current) { setTasks([]); setComments({}); }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => { if (me) load(); }, [me]);

  /* ---------- background reminders tick ---------- */
  useEffect(() => {
    if (!me) return;
    let timer = null;
    const TICK_MS = 30 * 60 * 1000;

    const tick = async () => {
      if (!mounted.current) return;
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastTick.current < TICK_MS - 250) return;
      lastTick.current = now;
      try {
        await supabase.rpc('tick_task_reminders');
      } catch (e) {
        console.warn('tick_task_reminders failed', e?.message || e);
      }
    };

    const alignAndStart = () => {
      const now = Date.now();
      const halfHour = 30 * 60 * 1000;
      const offset = halfHour - (now % halfHour);
      setTimeout(() => {
        tick();
        timer = setInterval(tick, halfHour);
      }, offset);
    };

    alignAndStart();

    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [me]);

  /* ---------- realtime ---------- */
  useEffect(() => {
    if (!me) return;
    const today = nyToday();
    const ch = supabase
      .channel(`tasks_today_${today}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `due_date=eq.${today}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_notifications', filter: `user_id=eq.${me.id}` }, (p) => setNotif(p.new))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me, load]);

  /* ---------- derived ---------- */
  const active = useMemo(() => (tasks || []).filter(t => t.status === 'active'), [tasks]);
  const done   = useMemo(() => (tasks || []).filter(t => t.status === 'done'  ), [tasks]);

  /* ---------- actions ---------- */
  const toggleStatus = async (t) => {
    const next = t.status === 'active' ? 'done' : 'active';
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: next } : x));
    const { error } = await supabase.from('tasks').update({ status: next, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) console.error('toggleStatus error:', error);
    await load();
  };

  // ⚙️ Добавление комментария: если таск «неоплата» — сразу делаем его done
  const addComment = async (task, text) => {
    if (!text?.trim() || !me) return;
    const taskId = task.id;

    const tmp = {
      id: `tmp_${Math.random().toString(36).slice(2)}`,
      task_id: taskId,
      body: text.trim(),
      author_id: me.id,
      author_name: me.user_metadata?.full_name || (me.id || '').slice(0, 8),
      created_at: new Date().toISOString()
    };
    setComments(prev => {
      const arr = prev[taskId] ? [tmp, ...prev[taskId]] : [tmp];
      return { ...prev, [taskId]: arr };
    });

    const { error } = await supabase.from('task_comments').insert({ task_id: taskId, body: text.trim(), author_id: me.id });
    if (error) {
      console.error('addComment error:', error);
      return;
    }

    // Если это «неоплата» — перевести в done
    if (isPaymentTask(task) && task.status === 'active') {
      const { error: uErr } = await supabase
        .from('tasks')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (uErr) console.error('auto close payment-task error:', uErr);
    }

    await load();
  };

  // уведомления (Web Notifications с запасным alert)
  useEffect(() => {
    if (!notif) return;
    const msg = notif.payload?.message || 'Активные задачи';

    const showFallback = () => { try { alert(msg); } catch {} };

    (async () => {
      if ('Notification' in window) {
        try {
          if (Notification.permission === 'default') {
            await Notification.requestPermission();
          }
          if (Notification.permission === 'granted') {
            const n = new Notification('Напоминание', { body: msg });
            setTimeout(() => n.close?.(), 8000);
          } else {
            showFallback();
          }
        } catch {
          showFallback();
        }
      } else {
        showFallback();
      }
    })();

    supabase.from('task_notifications').update({ read_at: new Date().toISOString() }).eq('id', notif.id);
  }, [notif]);

  return (
    <div style={PAGE}>
      <div style={ROW}>
        <h2 style={H}>Задачи на сегодня ({dayjs().tz(NY).format('DD.MM.YYYY')})</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={BTN_L} onClick={load} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить'}</button>
          <button style={BTN} onClick={() => setShowCreate(true)}>+ Новая задача</button>
        </div>
      </div>

      {/* Активные */}
      <div style={BOX}>
        <div style={{ ...H, margin: 0 }}>Активные</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {active.length === 0 ? <div style={{ color: '#6b7280' }}>Нет активных задач</div> :
            active.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                comments={comments[t.id] || []}
                onToggle={() => toggleStatus(t)}
                onAddComment={(taskObj, txt) => addComment(taskObj, txt)}
              />
            ))
          }
        </div>
      </div>

      {/* Завершённые */}
      <div style={BOX}>
        <div style={{ ...H, margin: 0 }}>Завершённые (сегодня)</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {done.length === 0 ? <div style={{ color: '#6b7280' }}>Нет</div> :
            done.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                comments={comments[t.id] || []}
                onToggle={() => toggleStatus(t)}
                onAddComment={(taskObj, txt) => addComment(taskObj, txt)}
              />
            ))
          }
        </div>
      </div>

      {showCreate && (
        <CreateTaskModal
          me={me}
          managers={managers}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

/* ===== helpers ===== */
function PriBadge({ p }) {
  const map = { low: '#d1fae5', normal: '#e5e7eb', high: '#fee2e2' };
  const txt = { low: '#065f46', normal: '#374151', high: '#991b1b' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: 999, background: map[p] || '#e5e7eb', color: txt[p] || '#374151', fontSize: 12 }}>
      {p || 'normal'}
    </span>
  );
}

function RemBadge({ at, every }) {
  if (!at) return null;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 999, background: '#e0e7ff', color: '#4338ca', fontSize: 12 }}>
      напоминание {dayjs(at).tz(NY).format('HH:mm')}{every ? ` / ${every}м` : ''}
    </span>
  );
}

function TagList({ tags }) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((t, i) => <span key={i} style={{ ...CHIP, padding: '4px 8px', fontSize: 12 }}>{t}</span>)}
    </div>
  );
}

function TaskRow({ task, comments, onToggle, onAddComment }) {
  const [txt, setTxt] = useState('');
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>{task.title}</div>
            <PriBadge p={task.priority} />
            <RemBadge at={task.reminder_at} every={task.remind_every_minutes} />
          </div>
          {task.details && <div style={{ color: '#6b7280', fontSize: 14 }}>{task.details}</div>}
          {(task.job_number || task.job_id) && (
            <div style={{ fontSize: 12, color: '#2563eb' }}>
              Связано с заявкой #{task.job_number || String(task.job_id).slice(0, 8)}
            </div>
          )}
          <TagList tags={task.tags} />
          {isPaymentTask(task) && task.status === 'active' && (
            <div style={{ fontSize: 12, color: '#b45309' }}>⏳ Таск по неоплате — закроется автоматически после комментария</div>
          )}
        </div>
        <button style={BTN_L} onClick={onToggle}>
          {task.status === 'active' ? 'Завершить' : 'В активные'}
        </button>
      </div>

      {/* Комментарии */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Комментарии</div>
        {(comments || []).slice(0, 5).map(c => (
          <div key={c.id} style={{ fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{c.author_name}:</span>{' '}
            {c.body}{' '}
            <span style={{ color: '#6b7280', fontSize: 12 }}>
              {dayjs(c.created_at).tz(NY).format('DD.MM HH:mm')}
            </span>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input
            style={INPUT}
            placeholder="Оставь комментарий, что сделано…"
            value={txt}
            onChange={e => setTxt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && txt.trim()) {
                onAddComment(task, txt);
                setTxt('');
              }
            }}
          />
          <button style={BTN} onClick={() => { onAddComment(task, txt); setTxt(''); }}>Добавить</button>
        </div>
      </div>
    </div>
  );
}

function CreateTaskModal({ me, managers, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [jobId, setJobId] = useState('');
  const [jobNumber, setJobNumber] = useState('');
  const [assignee, setAssignee] = useState('me');
  const [dateStr, setDateStr] = useState(nyToday());
  const [timeStr, setTimeStr] = useState('');
  const [repeatMins, setRepeatMins] = useState('');
  const [priority, setPriority] = useState('normal');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  // подставляем номер по UUID
  useEffect(() => {
    let alive = true;
    (async () => {
      const id = (jobId || '').trim();
      if (!id) return;
      const { data, error } = await supabase.from('jobs').select('id, job_number').eq('id', id).maybeSingle();
      if (!alive) return;
      if (!error && !jobNumber && data?.job_number != null) setJobNumber(String(data.job_number));
    })();
    return () => { alive = false; };
  }, [jobId]);

  const applyTemplate = (name) => {
    if (name === 'parts') {
      setTitle(jobNumber ? `Найти детали к заявке #${jobNumber}` : 'Найти детали к заявке');
      setDetails('Проверить схемы/мануалы, подобрать аналоги');
      setPriority('high');
      setTags('детали,поиск');
    }
    if (name === 'call') {
      setTitle(jobNumber ? `Позвонить в супплай-хаус по заявке #${jobNumber}` : 'Позвонить в супплай-хаус');
      setDetails('Уточнить наличие/цену, оформить заказ');
      setPriority('normal');
      setTags('звонок,супплай');
    }
    if (name === 'self') {
      setTitle('Личное напоминание');
      setDetails('—');
      setPriority('normal');
      setTags('напоминание');
    }
  };

  useEffect(() => {
    if (!jobNumber) return;
    if (/заявк/i.test(title) && !/#\s*\d+/.test(title)) setTitle(t => `${t.trim()} #${jobNumber}`);
  }, [jobNumber, title]);

  const save = async () => {
    if (!me) return;
    setSaving(true);
    try {
      let job_id = (jobId || '').trim() || null;
      let job_number = (jobNumber || '').trim() || null;

      if (!job_id && job_number) {
        const { data } = await supabase.from('jobs').select('id, job_number').eq('job_number', job_number).maybeSingle();
        if (data?.id) job_id = data.id;
      }
      if (job_id && !job_number) {
        const { data } = await supabase.from('jobs').select('job_number').eq('id', job_id).maybeSingle();
        if (data?.job_number != null) job_number = String(data.job_number);
      }

      let finalTitle = (title || '').trim();
      if (job_number && /заявк/i.test(finalTitle) && !/#\s*\d+/.test(finalTitle)) finalTitle = `${finalTitle} #${job_number}`;

      const reminder_at = timeStr ? toNYTzISO(dateStr, timeStr) : null;
      const tagsArr = tags ? tags.split(',').map(s => s.trim()).filter(Boolean) : [];
      const assignee_id = assignee === 'me' ? me.id : assignee;

      const { error } = await supabase.from('tasks').insert({
        title: finalTitle || 'Задача',
        details: details.trim() || null,
        status: 'active',
        type: 'general',
        job_id: job_id,
        job_number: job_number || null,
        due_date: dateStr,
        created_by: me.id,
        assignee_id,
        priority,
        tags: tagsArr,
        reminder_at,
        remind_every_minutes: repeatMins ? Number(repeatMins) : null,
        last_reminded_at: null
      });
      if (!error) { onCreated?.(); onClose?.(); }
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ width: 620, background: '#fff', borderRadius: 16, padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Новая задача</div>
          <button style={BTN_L} onClick={onClose}>Закрыть</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={CHIP} onClick={() => applyTemplate('parts')}>Найти детали к заявке</button>
          <button style={CHIP} onClick={() => applyTemplate('call')}>Позвонить в супплай-хаус</button>
          <button style={CHIP} onClick={() => applyTemplate('self')}>Личное напоминание</button>
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Заголовок</div>
          <input style={INPUT} value={title} onChange={e => setTitle(e.target.value)} placeholder="Что сделать?" />
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Детали</div>
          <textarea style={TA} value={details} onChange={e => setDetails(e.target.value)} placeholder="Кратко что именно сделать…" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>UUID заявки (опц.)</div>
            <input style={INPUT} value={jobId} onChange={e => setJobId(e.target.value)} placeholder="UUID заявки" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Номер заявки (опц.)</div>
            <input style={INPUT} value={jobNumber} onChange={e => setJobNumber(e.target.value)} placeholder="Напр. 1024" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Исполнитель</div>
            <select style={INPUT} value={assignee} onChange={e => setAssignee(e.target.value)}>
              <option value="me">Я</option>
              {(managers || []).map(m => (
                <option key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 8)} {m.role === 'admin' ? '(admin)' : '(mgr)'}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Дата (NY)</div>
            <input type="date" style={INPUT} value={dateStr} onChange={e => setDateStr(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Время напоминания (опц.)</div>
            <input type="time" style={INPUT} value={timeStr} onChange={e => setTimeStr(e.target.value)} placeholder="09:30" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Повтор каждые, мин (опц.)</div>
            <input type="number" min="5" step="5" style={INPUT} value={repeatMins} onChange={e => setRepeatMins(e.target.value)} placeholder="Напр. 30" />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Теги (через запятую)</div>
          <input style={INPUT} value={tags} onChange={e => setTags(e.target.value)} placeholder="детали, звонок, напоминание" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
          <div />
          <button style={BTN} onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Сохраняю…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
