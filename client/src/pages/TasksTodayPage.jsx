// client/src/pages/TasksTodayPage.jsx
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(tz);

const NY = 'America/New_York';

/* ---------- UI ---------- */
const PAGE  = { padding: 16, display: 'grid', gap: 12, maxWidth: 1100, margin: '0 auto' };
const ROW   = { display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 };
const BOX   = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const H     = { margin: '6px 0 10px', fontWeight: 700, fontSize: 18 };
const BTN   = { padding: '8px 12px', borderRadius: 10, border: '1px solid #111827', background: '#111827', color: '#fff', cursor: 'pointer' };
const BTN_L = { ...BTN, borderColor: '#d1d5db', background: '#fff', color: '#111827' };
const BTN_D = { ...BTN_L, borderColor: '#ef4444', color: '#ef4444' };
const INPUT = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 10 };
const TA    = { ...INPUT, minHeight: 90 };
const CHIP  = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 999, background: '#fff' };

const nyToday = () => dayjs().tz(NY).format('YYYY-MM-DD');

/* неоплата? — RU/EN */
const isUnpaidTask = (t) => {
  const title = String(t?.title || '').toLowerCase();
  const type  = String(t?.type  || '').toLowerCase();
  const tags  = Array.isArray(t?.tags) ? t.tags.map(x => String(x).toLowerCase()) : [];
  const ruSet = ['неоплата','неоплачено','не оплачено'];
  const inTags = tags.some(s => ruSet.includes(s) || s.includes('unpaid') || s.includes('оплат'));
  return (
    type.includes('unpaid') ||
    inTags ||
    title.includes('unpaid') ||
    title.includes('неоплат') ||
    (title.includes('оплат') && !title.includes('закрыт'))
  );
};

export default function TasksTodayPage() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [me, setMe] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [commentsByTask, setCommentsByTask] = useState({});
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  /* ----- AUTH + PROFILE ----- */
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

  const isManagerMe = useMemo(
    () => ['admin', 'manager'].includes(String(myProfile?.role || '').toLowerCase()),
    [myProfile?.role]
  );

  /* ----- LOAD ----- */
  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    try {
      const today = nyToday();
      const selectCols = 'id,title,details,status,type,job_id,job_number,due_date,assignee_id,priority,tags,reminder_at,remind_every_minutes,created_at,updated_at';

      // 1) tasks: активные + сегодняшние завершённые
      const { data: activeRows, error: aErr } = await supabase
        .from('tasks').select(selectCols).eq('status', 'active')
        .order('updated_at', { ascending: false });
      if (aErr) throw aErr;

      const { data: doneRows, error: dErr } = await supabase
        .from('tasks').select(selectCols).eq('status', 'done').eq('due_date', today)
        .order('updated_at', { ascending: false });
      if (dErr) throw dErr;

      const t = [...(activeRows || []), ...(doneRows || [])];

      // 2) comments
      let map = {};
      if (t.length) {
        const ids = t.map(x => x.id);
        const { data: cs } = await supabase
          .from('task_comments')
          .select('id,task_id,body,is_active,author_id,created_at, profiles:author_id (full_name, role)')
          .in('task_id', ids)
          .order('created_at', { ascending: false });
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
      }

      // 3) jobs + clients (двумя запросами; с fallback’ами в самих jobs)
      let jobsMap = {};
      const jobIds = Array.from(new Set(t.map(x => x.job_id).filter(Boolean)));
      if (jobIds.length) {
        // возможные поля клиента внутри jobs
        const { data: jobs } = await supabase
          .from('jobs')
          .select(`
            id, job_number, client_id,
            title, issue, problem, description, details, notes, diagnosis,
            client_name, customer_name, contact_name,
            company, company_name
          `)
          .in('id', jobIds);

        // читаем клиентов, если есть client_id
        const clientIds = Array.from(new Set((jobs || []).map(j => j.client_id).filter(Boolean)));
        let clientsMap = {};
        if (clientIds.length) {
          const { data: clients } = await supabase
            .from('clients')
            .select('id, full_name, name, first_name, last_name, company, company_name')
            .in('id', clientIds);

          (clients || []).forEach(c => {
            const nm =
              (c.full_name && c.full_name.trim()) ||
              (c.name && c.name.trim()) ||
              ([c.first_name, c.last_name].filter(Boolean).join(' ').trim()) ||
              '';
            const comp =
              (c.company && c.company.trim()) ||
              (c.company_name && c.company_name.trim()) ||
              '';
            clientsMap[c.id] = { full_name: nm, company: comp };
          });
        }

        const pickIssue = (j) => {
          const candidates = [j?.issue, j?.problem, j?.description, j?.details, j?.notes, j?.diagnosis, j?.title];
          const found = candidates.find(v => typeof v === 'string' && v.trim().length > 0);
          return found ? found.trim() : '';
        };

        const pickNameFromJob = (j) => {
          const v = [j.client_name, j.customer_name, j.contact_name]
            .find(s => typeof s === 'string' && s.trim());
          return v ? v.trim() : '';
        };

        const pickCompanyFromJob = (j) => {
          const v = [j.company, j.company_name]
            .find(s => typeof s === 'string' && s.trim());
          return v ? v.trim() : '';
        };

        (jobs || []).forEach(j => {
          const cli = (j.client_id && clientsMap[j.client_id]) || {};
          const name    = cli.full_name || pickNameFromJob(j) || '';
          const company = cli.company    || pickCompanyFromJob(j) || '';

          jobsMap[j.id] = {
            job_number: j.job_number ?? null,
            issue: pickIssue(j),
            client_company: company,
            client_name: name,
          };
        });
      }

      const withJob = t.map(item => ({
        ...item,
        _job_info: item.job_id ? (jobsMap[item.job_id] || null) : null,
      }));

      if (mounted.current) { setTasks(withJob); setCommentsByTask(map); }
    } catch (e) {
      console.error('[TasksToday] load error:', e?.message || e);
      if (mounted.current) { setTasks([]); setCommentsByTask({}); }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => { if (me) load(); }, [me]);

  /* ----- REALTIME ----- */
  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel('tasks_today_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me, load]);

  const active    = useMemo(() => (tasks || []).filter(t => t.status === 'active'), [tasks]);
  const doneToday = useMemo(
    () => (tasks || []).filter(t => t.status === 'done' && t.due_date === nyToday()),
    [tasks]
  );

  /* ----- ACTIONS ----- */
  const toggleStatus = async (t) => {
    const next = t.status === 'active' ? 'done' : 'active';
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: next } : x));
    await supabase.from('tasks')
      .update({ status: next, updated_at: new Date().toISOString(), due_date: nyToday() })
      .eq('id', t.id);
    await load();
  };

  const deleteTask = async (t) => {
    if (!isManagerMe) return;
    const title = t?.title ? ` «${t.title}»` : '';
    if (!window.confirm(`Удалить задачу${title}? Это действие необратимо.`)) return;
    try {
      await supabase.from('tasks').delete().eq('id', t.id);
    } catch (e) {
      console.error('delete task error:', e?.message || e);
    } finally {
      await load();
    }
  };

  const pinComment = async (comment) => {
    if (!comment?.id) return;
    const taskId = comment.task_id;
    await supabase.from('task_comments').update({ is_active: false }).eq('task_id', taskId);
    await supabase.from('task_comments').update({ is_active: true }).eq('id', comment.id);
    await load();
  };

  const addComment = async (task, text) => {
    if (!text?.trim() || !me) return;
    const body = text.trim();

    // optimistic UI
    const temp = {
      id: `tmp_${Math.random().toString(36).slice(2)}`,
      task_id: task.id, body, is_active: false,
      author_id: me.id,
      author_name: myProfile?.full_name || (me.id || '').slice(0, 8),
      author_role: myProfile?.role || null,
      created_at: new Date().toISOString(),
    };
    setCommentsByTask(prev => ({ ...prev, [task.id]: [temp, ...(prev[task.id] || [])] }));

    await supabase.from('task_comments').insert({ task_id: task.id, body, author_id: me.id, is_active: false });

    // автозакрытие неоплаты по комменту менеджера/админа
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
          <button style={BTN_L} onClick={() => load()} disabled={loading}>
            {loading ? 'Обновляю…' : 'Обновить'}
          </button>
          <button style={BTN} onClick={() => setShowCreate(true)}>+ Новая задача</button>
        </div>
      </div>

      {/* Активные */}
      <div style={BOX}>
        <div style={{ ...H, margin: 0 }}>Активные</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {active.length === 0 ? <div style={{ color: '#6b7280' }}>Нет активных задач</div> :
            active.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                comments={commentsByTask[t.id] || []}
                isManagerMe={isManagerMe}
                onToggle={() => toggleStatus(t)}
                onDelete={() => deleteTask(t)}
                onAddComment={(taskObj, txt) => addComment(taskObj, txt)}
                onPinComment={pinComment}
              />
            ))}
        </div>
      </div>

      {/* Завершённые сегодня */}
      <div style={BOX}>
        <div style={{ ...H, margin: 0 }}>Завершённые (сегодня)</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {doneToday.length === 0 ? <div style={{ color: '#6b7280' }}>Нет</div> :
            doneToday.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                comments={commentsByTask[t.id] || []}
                isManagerMe={isManagerMe}
                onToggle={() => toggleStatus(t)}
                onDelete={() => deleteTask(t)}
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

/* ---------- helpers ---------- */

const PriBadge = ({ p }) => {
  const map = { low: '#d1fae5', normal: '#e5e7eb', high: '#fee2e2' };
  const txt = { low: '#065f46', normal: '#374151', high: '#991b1b' };
  return <span style={{ padding: '2px 8px', borderRadius: 999, background: map[p] || '#e5e7eb', color: txt[p] || '#374151', fontSize: 12 }}>{p || 'normal'}</span>;
};

const RemBadge = ({ at, every }) => !at ? null : (
  <span style={{ padding: '2px 8px', borderRadius: 999, background: '#e0e7ff', color: '#4338ca', fontSize: 12 }}>
    напоминание {dayjs(at).tz(NY).format('HH:mm')}{every ? ` / ${every}м` : ''}
  </span>
);

const TagList = ({ tags }) => !Array.isArray(tags) || tags.length === 0 ? null : (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {tags.map((t, i) => <span key={i} style={{ ...CHIP, padding: '4px 8px', fontSize: 12 }}>{t}</span>)}
  </div>
);

/* РЕНДЕР СО СПЕЙСАМИ И ТОЧКАМИ: без [object Object] */
const Joined = ({ parts }) => (
  <span style={{ fontSize: 13 }}>
    {parts.filter(Boolean).map((part, i) => (
      <React.Fragment key={i}>
        {i > 0 && ' • '}
        {part}
      </React.Fragment>
    ))}
  </span>
);

const JobLink = ({ id, number }) => {
  if (!id && !number) return <span style={{ fontSize: 12 }}>Заявка #—</span>;
  if (!id) return <span style={{ fontSize: 12 }}>Заявка #{number}</span>;
  return (
    <a href={`#/jobs/${id}`} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'underline' }}>
      Заявка #{number || String(id).slice(0, 8)}
    </a>
  );
};

const JobInfoLine = ({ jobId, info, taskDetails, fallbackNumber }) => {
  const jobNum   = info?.job_number ?? fallbackNumber ?? null;
  const company  = (info?.client_company || '').trim();
  const person   = (info?.client_name || '').trim();
  const issue    = (info?.issue || '').trim() || (taskDetails || '').trim();

  return (
    <Joined
      parts={[
        <JobLink key="lnk" id={jobId || null} number={jobNum} />,
        company || null,
        person  || null,
        issue   || null
      ]}
    />
  );
};

function TaskRow({ task, comments, isManagerMe, onToggle, onDelete, onAddComment, onPinComment }) {
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

          {/* заявка — компания — имя — проблема */}
          <JobInfoLine
            jobId={task.job_id}
            info={task._job_info}
            taskDetails={task.details}
            fallbackNumber={task.job_number}
          />

          <TagList tags={task.tags} />
          {isUnpaidTask(task) && task.status === 'active' && (
            <div style={{ fontSize: 12, color: '#92400e' }}>
              ⏳ Неоплата закроется автоматически после комментария <b>менеджера/админа</b>.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={BTN_L} onClick={onToggle}>
            {task.status === 'active' ? 'Завершить' : 'В активные'}
          </button>
          {isManagerMe && (
            <button style={BTN_D} onClick={onDelete}>Удалить</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Комментарии</div>
        {(comments || []).map(c => (
          <div key={c.id} style={{ fontSize: 14, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{c.author_name}{c.author_role ? ` (${c.author_role})` : ''}:</span>{' '}
              {c.body}{' '}
              <span style={{ color: '#6b7280', fontSize: 12 }}>{dayjs(c.created_at).tz(NY).format('DD.MM HH:mm')}</span>
              {c.is_active && <span style={{ marginLeft: 8, fontSize: 12, color: '#2563eb' }}>• активный</span>}
            </div>
            <div><button style={BTN_L} onClick={() => onPinComment(c)}>Сделать активным</button></div>
          </div>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input
            style={INPUT}
            placeholder="Комментарий (что сделано/кого звонили/результат)…"
            value={txt}
            onChange={e => setTxt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && txt.trim()) { onAddComment(task, txt); setTxt(''); } }}
          />
          <button style={BTN} onClick={() => { if (txt.trim()) { onAddComment(task, txt); setTxt(''); } }}>Добавить</button>
        </div>
      </div>
    </div>
  );
}

/* ================== Create Modal ================== */
function CreateTaskModal({ me, onClose, onCreated }) {
  const [title, setTitle]   = useState('');
  const [details, setDetails] = useState('');
  const [jobId, setJobId]   = useState('');
  const [jobsList, setJobsList] = useState([]);
  const [priority, setPriority] = useState('normal');
  const [type, setType] = useState('general'); // general | unpaid
  const [dateStr, setDateStr] = useState(nyToday());
  const [saving, setSaving] = useState(false);

  const INACTIVE = new Set(['completed','завершено','canceled','cancelled','cancel','closed','отказ']);

  const buildClientLabel = (cli) => {
    if (!cli) return 'Без клиента';
    const nm = (cli.full_name && cli.full_name.trim())
      || (cli.name && cli.name.trim())
      || ([cli.first_name, cli.last_name].filter(Boolean).join(' ').trim());
    const comp = (cli.company && cli.company.trim()) || (cli.company_name && cli.company_name.trim());
    const both = [nm || null, comp ? `(${comp})` : null].filter(Boolean).join(' ');
    return both || 'Без клиента';
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: withClient, error } = await supabase
          .from('jobs')
          .select(`
            id,
            job_number,
            status,
            archived_at,
            updated_at,
            clients:client_id ( full_name, name, first_name, last_name, company, company_name )
          `)
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
          .limit(600);

        let rows = withClient;
        if (error) throw error;

        if (!rows || rows.length === 0) {
          const { data: plain, error: e2 } = await supabase
            .from('jobs')
            .select('id, job_number, status, archived_at, updated_at')
            .is('archived_at', null)
            .order('updated_at', { ascending: false })
            .limit(600);
          if (e2) throw e2;
          rows = plain?.map(j => ({ ...j, clients: null })) ?? [];
        }

        const list = (rows || [])
          .filter(j => !INACTIVE.has(String(j.status || '').toLowerCase()))
          .map(j => ({
            id: j.id,
            job_number: j.job_number ?? null,
            status: j.status ?? '',
            client_name: buildClientLabel(j.clients),
            updated_at: j.updated_at,
          }))
          .sort((a, b) => (b.job_number ?? 0) - (a.job_number ?? 0));

        setJobsList(list);
      } catch {
        setJobsList([]);
      }
    })();
  }, []);

  const save = async () => {
    if (!me) return;
    setSaving(true);
    try {
      let jobNumber = null;
      if (jobId) {
        const { data: jobData } = await supabase
          .from('jobs')
          .select('job_number')
          .eq('id', jobId)
          .maybeSingle();
        jobNumber = jobData?.job_number ?? null;
      }

      await supabase.from('tasks').insert({
        title: (title || 'Задача').trim(),
        details: details.trim() || null,
        status: 'active',
        type,
        job_id: jobId || null,
        job_number: jobNumber,
        due_date: dateStr,
        created_by: me.id,
        assignee_id: null,
        priority,
        tags: type === 'unpaid' ? ['unpaid', 'payment'] : [],
        reminder_at: null,
        remind_every_minutes: null,
        last_reminded_at: null,
      });

      onCreated?.();
      onClose?.();
    } catch (e) {
      console.error('CreateTask save error:', e?.message || e);
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
              {jobsList.length === 0
                ? <option disabled>Активных заявок нет</option>
                : jobsList.map(j => (
                    <option key={j.id} value={j.id}>
                      #{j.job_number ?? '—'} • {j.client_name} • {j.status || '—'}
                    </option>
                  ))
              }
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
