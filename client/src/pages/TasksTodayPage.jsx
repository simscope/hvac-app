// client/src/pages/TasksTodayPage.jsx
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(tz);
const NY = 'America/New_York';

/* ===== UI styles ===== */
const PAGE = { padding: 16, display: 'grid', gap: 12 };
const ROW = { display: 'grid', gridTemplateColumns: '1fr auto', alignItems:'center', gap: 8 };
const BOX = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const H = { margin: '6px 0 10px', fontWeight: 700, fontSize: 18 };
const BTN = { padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', background:'#111827', color:'#fff', cursor:'pointer' };
const BTN_L = { ...BTN, background:'#fff', color:'#111827' };
const INPUT = { width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:10 };
const TA = { ...INPUT, minHeight: 80 };
const CHIP = { padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:999, cursor:'pointer', background:'#fff' };

function nyToday() { return dayjs().tz(NY).format('YYYY-MM-DD'); }
function toNYTzISO(dateStr, timeStr) {
  // dateStr: 'YYYY-MM-DD', timeStr: 'HH:mm' (локальный ввод)
  if (!dateStr || !timeStr) return null;
  const [h,m] = timeStr.split(':').map(Number);
  const d = dayjs.tz(dateStr, NY).hour(h).minute(m).second(0).millisecond(0);
  return d.toISOString(); // хранится с TZ
}

export default function TasksTodayPage() {
  const [me, setMe] = useState(null);
  const [managers, setManagers] = useState([]); // {id, full_name, role}

  const [tasks, setTasks] = useState([]);
  const [comments, setComments] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [notif, setNotif] = useState(null);

  // ========== auth ==========
  useEffect(() => {
    let subAuth;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setMe(data?.session?.user ?? null);
      subAuth = supabase.auth.onAuthStateChange((_e,s)=>setMe(s?.user??null));
    })();
    return () => subAuth?.data?.subscription?.unsubscribe();
  }, []);

  // ========== managers list ==========
  const loadManagers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['admin','manager'])
      .order('role', { ascending: true });
    setManagers(data||[]);
  }, []);
  useEffect(()=>{ loadManagers(); }, []);

  // ========== load tasks & comments ==========
  const load = useCallback(async () => {
    const today = nyToday();
    const { data: t } = await supabase
      .from('tasks')
      .select('id,title,details,status,job_id,due_date,assignee_id,priority,tags,reminder_at,remind_every_minutes,created_at,updated_at')
      .eq('due_date', today)
      .order('status', { ascending: true })
      .order('updated_at', { ascending: false });
    setTasks(t || []);

    if (t && t.length) {
      const ids = t.map(x=>x.id);
      const { data: cs } = await supabase
        .from('task_comments')
        .select('id,task_id,body,author_id,created_at')
        .in('task_id', ids)
        .order('created_at', { ascending: false });
      const map = {};
      (cs||[]).forEach(c => {
        if (!map[c.task_id]) map[c.task_id] = [];
        map[c.task_id].push(c);
      });
      setComments(map);
    } else {
      setComments({});
    }
  }, []);
  useEffect(() => { load(); }, [me]);

  // ========== realtime ==========
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel('tasks_realtime')
      .on('postgres_changes', { event:'*', schema:'public', table:'tasks' }, load)
      .on('postgres_changes', { event:'*', schema:'public', table:'task_comments' }, load)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'task_notifications', filter: `user_id=eq.${me.id}` },
        (p) => setNotif(p.new))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me, load]);

  // ========== unpaid jobs ==========
  const [unpaid, setUnpaid] = useState([]);
  const loadUnpaid = useCallback(async () => {
    const { data: uj } = await supabase
    .from('unpaid_jobs_current')
    .select('job_id'); // тут только job_id и флаг — всё остальное можно подтянуть по jobs при желании
    // если нужно время назначения — подтянем из jobs:
  const ids = (uj||[]).map(x=>x.job_id);
  let rows = [];
  if (ids.length) {
    const { data: j } = await supabase
      .from('jobs')
      .select('id, appointment_time, created_at')
      .in('id', ids);
    rows = j || [];
  }
  setUnpaid(rows);
    setUnpaid(data||[]);
  }, []);
  useEffect(()=>{ loadUnpaid(); }, []);

  const active = useMemo(()=> (tasks||[]).filter(t=>t.status==='active'), [tasks]);
  const done   = useMemo(()=> (tasks||[]).filter(t=>t.status==='done'), [tasks]);

  const toggleStatus = async (t) => {
    await supabase.from('tasks').update({ status: t.status==='active'?'done':'active' }).eq('id', t.id);
  };

  const addComment = async (taskId, text) => {
    if (!text?.trim()) return;
    await supabase.from('task_comments').insert({
      task_id: taskId,
      body: text.trim(),
      author_id: me.id
    });
  };

  const makeFromJob = async (job_id) => {
    const today = nyToday();
    await supabase.from('tasks').insert({
      title: `Оплата по заявке #${job_id}`,
      details: 'Связаться с клиентом и закрыть оплату',
      status: 'active',
      job_id,
      due_date: today,
      created_by: me.id,
      assignee_id: me.id,
      priority: 'high',
      tags: ['оплата','неоплачено']
    });
  };

  // alerts
  useEffect(() => {
    if (!notif) return;
    alert(notif.payload?.message || 'Активные задачи');
    supabase.from('task_notifications').update({ read_at: new Date().toISOString() }).eq('id', notif.id);
  }, [notif]);

  return (
    <div style={PAGE}>
      <div style={ROW}>
        <h2 style={H}>Задачи на сегодня ({dayjs().tz(NY).format('DD.MM.YYYY')})</h2>
        <div style={{display:'flex', gap:8}}>
          <button style={BTN_L} onClick={load}>Обновить</button>
          <button style={BTN} onClick={()=>setShowCreate(true)}>+ Новая задача</button>
        </div>
      </div>

      {/* Неоплаченные заявки → быстрые автозадачи */}
      <div style={BOX}>
        <div style={ROW}>
          <div style={{fontWeight:700}}>Неоплаченные заявки</div>
          <div style={{fontSize:12,color:'#6b7280'}}>из списка “Все заявки”</div>
        </div>
        {(unpaid.length===0) ? (
          <div style={{color:'#10b981'}}>Нет неоплаченных заявок 👍</div>
        ) : (
          <div style={{display:'grid', gap:8}}>
            {unpaid.map(u => (
              <div key={u.job_id} style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center', border:'1px solid #fecaca', background:'#fee2e2', borderRadius:10, padding:10}}>
                <div>
                  <div style={{fontWeight:600, color:'#b91c1c'}}>Заявка #{u.job_id}</div>
                  <div style={{fontSize:12, color:'#6b7280'}}>Назначено: {u.appointment_time ? dayjs(u.appointment_time).tz(NY).format('DD.MM HH:mm') : '—'}</div>
                </div>
                <button style={BTN} onClick={()=>makeFromJob(u.job_id)}>Создать задачу</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Активные */}
      <div style={BOX}>
        <div style={{...H, margin:0}}>Активные</div>
        <div style={{display:'grid', gap:8}}>
          {active.length===0 ? <div style={{color:'#6b7280'}}>Нет активных задач</div> : active.map(t => (
            <TaskRow key={t.id} task={t} comments={comments[t.id]||[]} onToggle={()=>toggleStatus(t)} onAddComment={addComment} />
          ))}
        </div>
      </div>

      {/* Завершённые */}
      <div style={BOX}>
        <div style={{...H, margin:0}}>Завершённые (сегодня)</div>
        <div style={{display:'grid', gap:8}}>
          {done.length===0 ? <div style={{color:'#6b7280'}}>Нет</div> : done.map(t => (
            <TaskRow key={t.id} task={t} comments={comments[t.id]||[]} onToggle={()=>toggleStatus(t)} onAddComment={addComment} />
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateTaskModal
          me={me}
          managers={managers}
          onClose={()=>setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function PriBadge({ p }) {
  const map = { low:'#d1fae5', normal:'#e5e7eb', high:'#fee2e2' };
  const txt = { low:'#065f46', normal:'#374151', high:'#991b1b' };
  return (
    <span style={{padding:'2px 8px', borderRadius:999, background: map[p]||'#e5e7eb', color: txt[p]||'#374151', fontSize:12}}>
      {p||'normal'}
    </span>
  );
}

function RemBadge({ at, every }) {
  if (!at) return null;
  return (
    <span style={{padding:'2px 8px', borderRadius:999, background:'#e0e7ff', color:'#4338ca', fontSize:12}}>
      напоминание {dayjs(at).tz(NY).format('HH:mm')}{every?` / ${every}м`:''}
    </span>
  );
}

function TagList({ tags }) {
  if (!tags || !tags.length) return null;
  return (
    <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
      {tags.map((t,i)=><span key={i} style={{...CHIP, padding:'4px 8px', fontSize:12}}>{t}</span>)}
    </div>
  );
}

function TaskRow({ task, comments, onToggle, onAddComment }) {
  const [txt, setTxt] = useState('');
  return (
    <div style={{border:'1px solid #e5e7eb', borderRadius:10, padding:12, display:'grid', gap:8}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'start'}}>
        <div style={{display:'grid', gap:6}}>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <div style={{fontWeight:700}}>{task.title}</div>
            <PriBadge p={task.priority} />
            <RemBadge at={task.reminder_at} every={task.remind_every_minutes} />
          </div>
          {task.details && <div style={{color:'#6b7280', fontSize:14}}>{task.details}</div>}
          {task.job_id && <div style={{fontSize:12, color:'#2563eb'}}>Связано с заявкой #{task.job_id}</div>}
          <TagList tags={task.tags} />
        </div>
        <button style={BTN_L} onClick={onToggle}>{task.status==='active' ? 'Завершить' : 'В активные'}</button>
      </div>

      {/* Комментарии */}
      <div style={{display:'grid', gap:6}}>
        <div style={{fontWeight:600, fontSize:14}}>Комментарии</div>
        {(comments||[]).slice(0,5).map(c => (
          <div key={c.id} style={{fontSize:14}}>
            <span style={{fontWeight:600}}>{short(c.author_id)}:</span>{' '}
            {c.body}{' '}
            <span style={{color:'#6b7280', fontSize:12}}>
              {dayjs(c.created_at).tz(NY).format('DD.MM HH:mm')}
            </span>
          </div>
        ))}
        <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8}}>
          <input style={INPUT} placeholder="Оставь комментарий, что сделано…" value={txt} onChange={e=>setTxt(e.target.value)} />
          <button style={BTN} onClick={()=>{ onAddComment(task.id, txt); setTxt(''); }}>Добавить</button>
        </div>
      </div>
    </div>
  );
}

function short(id){ return (id||'').slice(0,8); }

function CreateTaskModal({ me, managers, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [jobId, setJobId] = useState('');
  const [assignee, setAssignee] = useState('me');
  const [dateStr, setDateStr] = useState(dayjs().tz(NY).format('YYYY-MM-DD'));
  const [timeStr, setTimeStr] = useState('');                 // HH:mm → reminder_at
  const [repeatMins, setRepeatMins] = useState('');           // 15/30/60...
  const [priority, setPriority] = useState('normal');
  const [tags, setTags] = useState('');                       // строка "детали,звонок"

  // Быстрые шаблоны
  const applyTemplate = (name) => {
    if (name === 'parts') {
      setTitle('Найти детали к заявке');
      if (jobId) setTitle(`Найти детали к заявке #${jobId}`);
      setDetails('Проверить схемы/мануалы, подобрать аналоги');
      setPriority('high');
      setTags('детали,поиск');
    }
    if (name === 'call') {
      setTitle('Позвонить в супплай-хаус');
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

  const save = async () => {
    const assignee_id = assignee==='me' ? me.id : assignee;
    const reminder_at = timeStr ? toNYTzISO(dateStr, timeStr) : null;
    const tagsArr = tags
      ? tags.split(',').map(s=>s.trim()).filter(Boolean)
      : [];

    await supabase.from('tasks').insert({
      title: title.trim(),
      details: details.trim() || null,
      status: 'active',
      job_id: jobId ? String(jobId).trim() : null,
      due_date: dateStr,                    // день задачи (NY)
      created_by: me.id,
      assignee_id,
      priority,
      tags: tagsArr,
      reminder_at,
      remind_every_minutes: repeatMins ? Number(repeatMins) : null,
      last_reminded_at: null
    });

    onCreated?.();
    onClose?.();
  };

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.35)',
      display:'grid', placeItems:'center', zIndex:50
    }}>
      <div style={{ width:620, background:'#fff', borderRadius:16, padding:16, display:'grid', gap:12 }}>
        <div style={{...ROW}}>
          <div style={{fontWeight:700, fontSize:18}}>Новая задача</div>
          <button style={BTN_L} onClick={onClose}>Закрыть</button>
        </div>

        {/* Шаблоны */}
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button style={CHIP} onClick={()=>applyTemplate('parts')}>Найти детали к заявке</button>
          <button style={CHIP} onClick={()=>applyTemplate('call')}>Позвонить в супплай-хаус</button>
          <button style={CHIP} onClick={()=>applyTemplate('self')}>Личное напоминание</button>
        </div>

        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Заголовок</div>
          <input style={INPUT} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Что сделать?" />
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Детали</div>
          <textarea style={TA} value={details} onChange={e=>setDetails(e.target.value)} placeholder="Кратко что именно сделать…" />
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
          <div>
            <div style={{fontSize:12, color:'#6b7280'}}>Заявка (опц.)</div>
            <input style={INPUT} value={jobId} onChange={e=>setJobId(e.target.value)} placeholder="job id (например, 9)" />
          </div>
          <div>
            <div style={{fontSize:12, color:'#6b7280'}}>Исполнитель</div>
            <select style={INPUT} value={assignee} onChange={e=>setAssignee(e.target.value)}>
              <option value="me">Я</option>
              {(managers||[]).map(m => (
                <option key={m.id} value={m.id}>{m.full_name || m.id.slice(0,8)} {m.role==='admin'?'(admin)':'(mgr)'}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{fontSize:12, color:'#6b7280'}}>Приоритет</div>
            <select style={INPUT} value={priority} onChange={e=>setPriority(e.target.value)}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
          <div>
            <div style={{fontSize:12, color:'#6b7280'}}>Дата (NY)</div>
            <input type="date" style={INPUT} value={dateStr} onChange={e=>setDateStr(e.target.value)} />
          </div>
          <div>
            <div style={{fontSize:12, color:'#6b7280'}}>Время напоминания (опц.)</div>
            <input type="time" style={INPUT} value={timeStr} onChange={e=>setTimeStr(e.target.value)} placeholder="09:30" />
          </div>
          <div>
            <div style={{fontSize:12, color:'#6b7280'}}>Повтор каждые, мин (опц.)</div>
            <input type="number" min="5" step="5" style={INPUT} value={repeatMins} onChange={e=>setRepeatMins(e.target.value)} placeholder="Напр. 30" />
          </div>
        </div>

        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Теги (через запятую)</div>
          <input style={INPUT} value={tags} onChange={e=>setTags(e.target.value)} placeholder="детали, звонок, напоминание" />
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:12}}>
          <div />
          <button style={BTN} onClick={save} disabled={!title.trim()}>Создать</button>
        </div>
      </div>
    </div>
  );
}
