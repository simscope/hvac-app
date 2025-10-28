// client/src/pages/TasksTodayPage.jsx
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(tz);

const NY = 'America/New_York';

/* ========== UI STYLES (минималист) ========== */
const PAGE = { padding: 16, display: 'grid', gap: 12, maxWidth: 1100, margin: '0 auto' };
const ROW = { display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 };
const BOX = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const H = { margin: '6px 0 10px', fontWeight: 700, fontSize: 18 };
const BTN = { padding: '8px 12px', borderRadius: 10, border: '1px solid #111827', background: '#111827', color: '#fff', cursor: 'pointer' };
const BTN_L = { ...BTN, borderColor: '#d1d5db', background: '#fff', color: '#111827' };
const INPUT = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 10 };
const TA = { ...INPUT, minHeight: 90 };
const CHIP = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 999, cursor: 'pointer', background: '#fff' };

/* ========== HELPERS ========== */
const nyToday = () => dayjs().tz(NY).format('YYYY-MM-DD');
const toNYTzISO = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const d = dayjs.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm', NY);
  return d.isValid() ? d.toISOString() : null;
};

/* «Это неоплата?» — по type/тегам */
const isUnpaidTask = (t) => {
  const tp = String(t?.type || '').toLowerCase();
  if (tp.includes('unpaid')) return true;
  const tags = Array.isArray(t?.tags) ? t.tags : [];
  return tags.some((s) => String(s).toLowerCase() === 'unpaid');
};

/* ========== MAIN PAGE ========== */
export default function TasksTodayPage() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [me, setMe] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [managers, setManagers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [commentsByTask, setCommentsByTask] = useState({});
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  /* ---------- AUTH + PROFILE ---------- */
  useEffect(() => {
    let unsub = null;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const user = s?.session?.user ?? null;
      if (mounted.current) setMe(user);
      if (user?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('id', user.id)
          .maybeSingle();
        if (mounted.current) setMyProfile(prof || null);
      }
      const { data } = supabase.auth.onAuthStateChange((_e, session) => {
        const u = session?.user ?? null;
        if (mounted.current) setMe(u);
      });
      unsub = data?.subscription;
    })();
    return () => unsub?.unsubscribe?.();
  }, []);

  /* ---------- MANAGERS LIST ---------- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['admin', 'manager'])
        .order('role', { ascending: true });
      if (mounted.current) setManagers(data || []);
    })();
  }, []);

  /* ---------- LOAD TASKS + COMMENTS ---------- */
  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    try {
      // Берём все активные (любой даты) + завершённые за сегодня (удобно видеть свежие закрытия)
      const today = nyToday();
      const { data: t, error } = await supabase
        .from('tasks')
        .select('id,title,details,status,type,job_id,job_number,due_date,assignee_id,priority,tags,reminder_at,remind_every_minutes,created_at,updated_at')
        .or(`status.eq.active,and(status.eq.done,due_date.eq.${today})`)
        .order('status', { ascending: true })
        .order('updated_at', { ascending: false });
      if (error) throw error;

      if (!t?.length) {
        if (mounted.current) { setTasks([]); setCommentsByTask({}); }
        return;
      }
      const ids = t.map(x => x.id);
      const { data: cs, error: cErr } = await supabase
        .from('task_comments')
        .select('id,task_id,body,is_active,author_id,created_at, profiles:author_id (full_name, role)')
        .in('task_id', ids)
        .order('created_at', { ascending: false });
      if (cErr) throw cErr;

      const map = {};
      (cs || []).forEach(c => {
        (map[c.task_id] ||= []).push({
          id: c.id,
          task_id: c.task_id,
          body: c.body,
          is_active: !!c.is_active,
          author_id: c.author_id,
          author_name: c?.profiles?.full_name || (c.author_id || '').slice(0, 8),
          author_role: c?.profiles?.role || null,
          created_at: c.created_at,
        });
      });

      if (mounted.current) {
        setTasks(t);
        setCommentsByTask(map);
      }
    } catch (e) {
      console.error('[TasksToday] load error:', e?.message || e);
      if (mounted.current) { setTasks([]); setCommentsByTask({}); }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => { if (me) load(); }, [me]);

  /* ---------- REALTIME ---------- */
  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel('tasks_today_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me, load]);

  /* ---------- DERIVED ---------- */
  const active = useMemo(() => (tasks || []).filter(t => t.status === 'active'), [tasks]);
  const doneToday = useMemo(() => {
    const today = nyToday();
    return (tasks || []).filter(t => t.status === 'done' && t.due_date === today);
  }, [tasks]);

  const isManagerMe = useMemo(() => {
    const r = String(myProfile?.role || '').toLowerCase();
    return r === 'admin' || r === 'manager';
  }, [myProfile?.role]);

  /* ---------- ACTIONS ---------- */
  const toggleStatus = async (t) => {
    const next = t.status === 'active' ? 'done' : 'active';
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: next } : x));
    const { error } = await supabase
      .from('tasks')
      .update({ status: next, updated_at: new Date().toISOString(), due_date: nyToday() })
      .eq('id', t.id);
    if (error) console.error('toggleStatus error:', error?.message || error);
    await load();
  };

  // Кнопка «Сделать комментарий активным»: флаг is_active у комментария
  const pinComment = async (comment) => {
    if (!comment?.id) return;
    // снимаем активность со всех комментов таска, активируем выбранный
    const taskId = comment.task_id;
    try {
      await supabase.from('task_comments').update({ is_active: false }).eq('task_id', taskId);
      const { error } = await supabase.from('task_comments').update({ is_active: true }).eq('id', comment.id);
      if (error) throw error;
      await load();
    } catch (e) {
      console.error('pinComment error:', e?.message || e);
    }
  };

  // Добавить комментарий; если задача "неоплата" и я менеджер — закрываем задачу
  const addComment = async (task, text) => {
    if (!text?.trim() || !me) return;
    const body = text.trim();
    // локально отрисуем мгновенно
    const tempId = `tmp_${Math.random().toString(36).slice(2)}`;
    const tmp = {
      id: tempId, task_id: task.id, body, is_active: false,
      author_id: me.id,
      author_name: myProfile?.full_name || (me.id || '').slice(0, 8),
      author_role: myProfile?.role || null,
      created_at: new Date().toISOString(),
    };
    setCommentsByTask(prev => {
      const arr = prev[task.id] ? [tmp, ...prev[task.id]] : [tmp];
      return { ...prev, [task.id]: arr };
    });

    const { error } = await supabase
      .from('task_comments')
      .insert({ task_id: task.id, body, author_id: me.id, is_active: false });
    if (error) {
      console.error('addComment error:', error?.message || error);
      // можно откатить tmp, но оставим лайтово
      return;
    }

    // ЛОГИКА: неоплата закрывается только после комментария МЕНЕДЖЕРА/АДМИНА
    if (isUnpaidTask(task) && isManagerMe && task.status === 'active') {
      await supabase.from('tasks')
        .update({ status: 'done', updated_at: new Date().toISOString(), due_date: nyToday() })
        .eq('id', task.id);
    }

    await load();
  };

  return (
    <div style={PAGE}>
      <div style={ROW}>
        <h2 style={H}>Задачи ({dayjs().tz(NY).format('DD.MM.YYYY')})</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={BTN_L} onClick={load} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить'}</button>
          <button style={BTN} onClick={() => setShowCreate(true)}>+ Новая задача</button>
        </div>
      </div>

      {/* АКТИВНЫЕ */}
      <div style={BOX}>
        <div style={{ ...H, margin: 0 }}>Активные</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {active.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Нет активных задач</div>
          ) : active.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              comments={commentsByTask[t.id] || []}
              isManagerMe={isManagerMe}
              onToggle={() => toggleStatus(t)}
              onAddComment={(taskObj, txt) => addComment(taskObj, txt)}
              onPinComment={pinComment}
            />
          ))}
        </div>
      </div>

      {/* ЗАВЕРШЁННЫЕ СЕГОДНЯ */}
      <div style={BOX}>
        <div style={{ ...H, margin: 0 }}>Завершённые (сегодня)</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {doneToday.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Нет</div>
          ) : doneToday.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              comments={commentsByTask[t.id] || []}
              isManagerMe={isManagerMe}
              onToggle={() => toggleStatus(t)}
              onAddComment={(taskObj, txt) => addComment(taskObj, txt)}
              onPinComment={pinComment}
            />
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateTaskModal
          me={me}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

/* ========== SMALL PARTS ========== */

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

function TaskRow({ task, comments, isManagerMe, onToggle, onAddComment, onPinComment }) {
  const [txt, setTxt] = useState('');

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>
              {task.title}{' '}
              {isUnpaidTask(task) && <span style={{ fontSize: 12, color: '#b45309', marginLeft: 6 }}>(неоплата)</span>}
            </div>
            <PriBadge p={task.priority} />
            <RemBadge at={task.reminder_at} every={task.remind_every_minutes} />
          </div>
          {task.details && <div style={{ color: '#6b7280', fontSize: 14 }}>{task.details}</div>}
          {(task.job_number || task.job_id) && (
            <div style={{ fontSize: 12, color: '#2563eb' }}>
              Заявка #{task.job_number || String(task.job_id).slice(0, 8)}
            </div>
          )}
          <TagList tags={task.tags} />
          {isUnpaidTask(task) && task.status === 'active' && (
            <div style={{ fontSize: 12, color: '#92400e' }}>
              ⏳ Задача по неоплате закрывается автоматически после комментария <b>менеджера/админа</b>.
            </div>
          )}
        </div>
        <button style={BTN_L} onClick={onToggle}>
          {task.status === 'active' ? 'Завершить' : 'В активные'}
        </button>
      </div>

      {/* Комментарии */}
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Комментарии</div>
        {(comments || []).map(c => (
          <div key={c.id} style={{ fontSize: 14, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>
                {c.author_name}{c.author_role ? ` (${c.author_role})` : ''}:
              </span>{' '}
              {c.body}{' '}
              <span style={{ color: '#6b7280', fontSize: 12 }}>
                {dayjs(c.created_at).tz(NY).format('DD.MM HH:mm')}
              </span>
              {c.is_active && <span style={{ marginLeft: 8, fontSize: 12, color: '#2563eb' }}>• активный</span>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={BTN_L} onClick={() => onPinComment(c)}>Сделать активным</button>
            </div>
          </div>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input
            style={INPUT}
            placeholder="Комментарий (что сделано/кого звонили/результат)…"
            value={txt}
            onChange={e => setTxt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && txt.trim()) {
                onAddComment(task, txt);
                setTxt('');
              }
            }}
          />
          <button style={BTN} onClick={() => { if (txt.trim()) { onAddComment(task, txt); setTxt(''); } }}>Добавить</button>
        </div>
      </div>
    </div>
  );
}

/* ========== CREATE MODAL ========== */
function CreateTaskModal({ me, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [jobId, setJobId] = useState('');
  const [jobsList, setJobsList] = useState([]);
  const [priority, setPriority] = useState('normal');
  const [type, setType] = useState('general');
  const [dateStr, setDateStr] = useState(dayjs().tz('America/New_York').format('YYYY-MM-DD'));
  const [saving, setSaving] = useState(false);

  // загрузка активных работ
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_number, client_name, job_status')
        .not('job_status', 'eq', 'Completed')
        .order('job_number', { ascending: false });
      if (!error && data) setJobsList(data);
    })();
  }, []);

  const save = async () => {
    if (!me) return;
    setSaving(true);
    try {
      const { data: jobData } = await supabase
        .from('jobs')
        .select('job_number')
        .eq('id', jobId)
        .maybeSingle();

      const jobNumber = jobData?.job_number || null;
      await supabase.from('tasks').insert({
        title: (title || 'Задача').trim(),
        details: details.trim() || null,
        status: 'active',
        type,
        job_id: jobId || null,
        job_number: jobNumber,
        due_date: dateStr,
        created_by: me.id,
        priority,
        tags: type === 'unpaid' ? ['unpaid', 'payment'] : [],
      });

      onCreated?.();
      onClose?.();
    } catch (e) {
      console.error('CreateTaskModal save error:', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ width: 600, background: '#fff', borderRadius: 16, padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Новая задача</div>
          <button style={BTN_L} onClick={onClose}>Закрыть</button>
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Что нужно сделать</div>
          <input style={INPUT} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: связаться с клиентом" />
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Детали</div>
          <textarea style={TA} value={details} onChange={e => setDetails(e.target.value)} placeholder="Описание задачи..." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Номер заявки</div>
            <select style={INPUT} value={jobId} onChange={e => setJobId(e.target.value)}>
              <option value="">Без заявки</option>
              {jobsList.map(j => (
                <option key={j.id} value={j.id}>
                  #{j.job_number} — {j.client_name || 'Без клиента'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Тип</div>
            <select style={INPUT} value={type} onChange={e => setType(e.target.value)}>
              <option value="general">Обычная</option>
              <option value="unpaid">Неоплата</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Приоритет</div>
            <select style={INPUT} value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Дата (NY)</div>
          <input type="date" style={INPUT} value={dateStr} onChange={e => setDateStr(e.target.value)} />
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
