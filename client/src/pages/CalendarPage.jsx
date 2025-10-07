// client/src/pages/CalendarPage.jsx
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import { supabase } from '../supabaseClient';

/* ===== helpers ===== */
const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s;
};

export default function CalendarPage() {
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [clients, setClients] = useState([]);

  const [activeTech, setActiveTech] = useState('all'); // 'all' | technician_id
  const [view, setView] = useState('timeGridWeek');
  const [query, setQuery] = useState('');

  const extRef = useRef(null);
  const calRef = useRef(null);
  const navigate = useNavigate();

  /* ---------- load ---------- */
  useEffect(() => {
    (async () => {
      const [{ data: j }, { data: t }, { data: c }] = await Promise.all([
        supabase
          .from('jobs')
          .select('id, job_number, client_id, client_name, client_address, address, issue, status, technician_id, appointment_time, scf, scf_payment_method, labor_price, labor_payment_method')
          .order('created_at', { ascending: false }),
        supabase
          .from('technicians')
          .select('id, name, role')
          .in('role', ['technician', 'tech'])
          .order('name', { ascending: true }),
        supabase.from('clients').select('id, full_name, address'),
      ]);
      setJobs(j || []);
      setTechs(t || []);
      setClients(c || []);
    })();
  }, []);

  /* ---------- realtime ---------- */
  useEffect(() => {
    const ch = supabase
      .channel('calendar_jobs_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs' },
        (payload) => {
          setJobs((prev) => {
            const row = (payload.new || payload.old);
            const id = String(row.id);
            if (payload.eventType === 'INSERT') {
              if (prev.some(p => String(p.id) === id)) return prev;
              return [payload.new, ...prev];
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map(p => (String(p.id) === id ? { ...p, ...payload.new } : p));
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter(p => String(p.id) !== id);
            }
            return prev;
          });
        }
      )
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, []);

  /* ---------- lookups ---------- */
  const clientsById = useMemo(() => {
    const m = new Map();
    for (const c of clients) m.set(String(c.id), c);
    return m;
  }, [clients]);

  const techById = useMemo(() => {
    const m = new Map();
    for (const t of techs) m.set(String(t.id), t);
    return m;
  }, [techs]);

  const getClientName = (job) =>
    clientsById.get(String(job?.client_id))?.full_name ||
    job?.client_name ||
    job?.full_name ||
    'No name';

  const getClientAddress = (job) =>
    clientsById.get(String(job?.client_id))?.address ||
    job?.client_address ||
    job?.address ||
    '';

  const unpaidSCF = (j) => Number(j.scf || 0) > 0 && !j.scf_payment_method;
  const unpaidLabor = (j) => Number(j.labor_price || 0) > 0 && !j.labor_payment_method;
  const isUnpaid = (j) => unpaidSCF(j) || unpaidLabor(j);

  /* ---------- palette ---------- */
  const statusKey = (s) => {
    if (!s) return 'default';
    const v = String(s).toLowerCase().trim();
    if (v.includes('recall')) return 'recall';
    if (v === 'diagnosis' || v === 'диагностика') return 'diagnostics';
    if (v === 'to finish' || v === 'к финишу') return 'to_finish';
    if (v.startsWith('waiting for parts') || v === 'ожидание деталей') return 'waiting_parts';
    if (v === 'parts ordered' || v === 'заказ деталей') return 'parts_ordered';
    if (v === 'in progress' || v === 'в работе') return 'in_progress';
    if (v === 'completed' || v === 'выполнено' || v === 'завершено') return 'finished';
    return 'default';
  };

  const statusPalette = {
    recall:        { bg: '#fee2e2', fg: '#7f1d1d', ring: '#ef4444' },
    diagnostics:   { bg: '#fef9c3', fg: '#854d0e', ring: '#eab308' },
    to_finish:     { bg: '#fffbeb', fg: '#92400e', ring: '#f59e0b' },
    waiting_parts: { bg: '#ede9fe', fg: '#5b21b6', ring: '#8b5cf6' },
    parts_ordered: { bg: '#e0e7ff', fg: '#3730a3', ring: '#6366f1' },
    in_progress:   { bg: '#e0f2fe', fg: '#075985', ring: '#0ea5e9' },
    finished:      { bg: '#d1fae5', fg: '#065f46', ring: '#10b981' },
    default:       { bg: '#f3f4f6', fg: '#111827', ring: '#9ca3af' },
  };

  const techColor = useMemo(() => {
    const base = ['#0284c7', '#7c3aed', '#16a34a', '#db2777', '#0ea5e9', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16'];
    const map = {};
    techs.forEach((t, i) => { map[String(t.id)] = base[i % base.length]; });
    return map;
  }, [techs]);

  /* ---------- filters ---------- */
  const hasTime = (v) => v != null && !(typeof v === 'string' && v.trim() === '');

  // В календаре показываем только заявки с назначенным временем
  const calendarJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (jobs || []).filter((j) => {
      if (!hasTime(j.appointment_time)) return false;
      if (activeTech !== 'all' && String(j.technician_id) !== String(activeTech)) return false;
      if (!q) return true;
      const name = getClientName(j).toLowerCase();
      const addr = getClientAddress(j).toLowerCase();
      return name.includes(q) || addr.includes(q) || String(j.job_number || j.id).includes(q);
    });
  }, [jobs, activeTech, query, clientsById]);

  // Список над календарём — ВСЕ без времени (appointment_time = null/пусто), сгруппировано по технику
  const unplannedByTech = useMemo(() => {
    const rows = (jobs || []).filter((j) => !hasTime(j.appointment_time));
    const groups = new Map();
    for (const j of rows) {
      const key = String(j.technician_id ?? 'none');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(j);
    }
    // сортировка внутри групп: новые сверху
    for (const [k, arr] of groups) {
      arr.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      groups.set(k, arr);
    }
    return groups; // Map<string, Job[]>
  }, [jobs]);

  /* ---------- draggable init ---------- */
  useEffect(() => {
    if (!extRef.current) return;
    const d = new Draggable(extRef.current, {
      itemSelector: '.ext-evt',
      eventData: (el) => ({
        id: el.getAttribute('data-id'),
        title: el.getAttribute('data-title') || '',
        allDay: false,
      }),
    });
    return () => d.destroy();
  }, [extRef, jobs]);

  /* ---------- events for FullCalendar ---------- */
  const events = useMemo(() => {
    return calendarJobs.map((j) => {
      const k = statusKey(j.status);
      const s = statusPalette[k] || statusPalette.default;
      const tName = techById.get(String(j.technician_id))?.name || '';
      const baseTitle = `#${j.job_number || j.id} — ${getClientName(j)}`;
      const title = activeTech === 'all' && tName ? `${baseTitle} • ${tName}` : baseTitle;
      return {
        id: String(j.id),
        title,
        start: j.appointment_time, // отдаём как есть
        allDay: false,
        backgroundColor: activeTech === 'all' ? techColor[String(j.technician_id)] || s.bg : s.bg,
        borderColor: isUnpaid(j) ? '#ef4444' : s.ring,
        textColor: s.fg,
        extendedProps: {
          address: getClientAddress(j),
          unpaid: isUnpaid(j),
          isRecall: statusKey(j.status) === 'recall',
          job: j,
          techName: tName,
        },
      };
    });
  }, [calendarJobs, activeTech, techById, techColor]);

  /* ---------- handlers ---------- */
  const handleEventDrop = async (info) => {
    const id = info.event.id;
    const newStart = info.event.start ? info.event.start.toISOString() : null;
    const { error } = await supabase.from('jobs').update({ appointment_time: newStart }).eq('id', id);
    if (error) {
      info.revert();
      alert('Failed to save date/time');
      console.error(error);
      return;
    }
    setJobs((prev) => prev.map((j) => (String(j.id) === id ? { ...j, appointment_time: newStart } : j)));
  };

  const handleEventReceive = async (info) => {
    const id = info.event.id;
    if (activeTech === 'all') {
      // Требуем выбрать вкладку техника — куда ставим
      info.event.remove();
      alert('Select a technician tab, then drop the job into a time slot.');
      return;
    }
    const newStart = info.event.start ? info.event.start.toISOString() : null;
    const payload = { appointment_time: newStart, technician_id: normalizeId(activeTech) };
    const { error } = await supabase.from('jobs').update(payload).eq('id', id);
    if (error) {
      info.event.remove();
      alert('Failed to assign technician/date');
      console.error(error);
      return;
    }
    setJobs((prev) =>
      prev.map((j) =>
        String(j.id) === id ? { ...j, appointment_time: newStart, technician_id: normalizeId(activeTech) } : j
      )
    );
  };

  const handleEventClick = (info) => navigate(`/job/${info.event.id}`);

  const renderEventContent = (arg) => {
    const { address } = arg.event.extendedProps;
    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '2px';
    wrap.style.fontSize = '12px';
    const line1 = document.createElement('div');
    line1.style.fontWeight = '700';
    line1.textContent = arg.event.title;
    wrap.appendChild(line1);
    if (address) {
      const line2 = document.createElement('div');
      line2.style.opacity = '0.9';
      line2.textContent = address.length > 80 ? address.slice(0, 80) + '…' : address;
      wrap.appendChild(line2);
    }
    return { domNodes: [wrap] };
  };

  const eventDidMount = (info) => {
    const { unpaid, isRecall } = info.event.extendedProps || {};
    info.el.style.borderRadius = '10px';
    info.el.style.boxShadow = '0 1px 0 rgba(0,0,0,0.04), 0 1px 8px rgba(0,0,0,0.06)';
    info.el.style.padding = '2px 4px';
    if (unpaid) {
      info.el.style.borderStyle = 'dashed';
      info.el.style.borderWidth = '2px';
    }
    if (isRecall) {
      info.el.style.filter = 'saturate(1.2)';
      info.el.style.fontWeight = '700';
    }
  };

  /* ---------- UI ---------- */
  return (
    <div style={{ padding: 16, background: 'linear-gradient(180deg, #f7faff 0%, #ffffff 40%)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, letterSpacing: 0.3 }}>🗓 Calendar</h1>

      {/* controls */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 10,
          boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 6px 16px rgba(0,0,0,0.04)'
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Tab active={activeTech === 'all'} onClick={() => setActiveTech('all')}>All technicians</Tab>
          {techs.map((t) => (
            <Tab key={t.id} active={String(activeTech) === String(t.id)} onClick={() => setActiveTech(t.id)}>
              {t.name}
            </Tab>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: client/address/job #"
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: '8px 12px',
              minWidth: 240,
              outline: 'none',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
            }}
          />
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              const api = calRef.current?.getApi?.();
              if (api) api.changeView(e.target.value);
            }}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: '8px 12px',
              background: '#fff',
              outline: 'none'
            }}
          >
            <option value="dayGridMonth">Month</option>
            <option value="timeGridWeek">Week</option>
            <option value="timeGridDay">Day</option>
          </select>
        </div>
      </div>

      {/* ===== Unplanned (no appointment_time) ===== */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6, fontWeight: 800, color: '#111827' }}>
          Без времени (перетащи на календарь выбранного техника):
        </div>

        {/* общий контейнер для Draggable (важно один корневой ref) */}
        <div
          ref={extRef}
          style={{
            display: 'grid',
            gap: 10,
            padding: 10,
            border: '1px dashed #e5e7eb',
            borderRadius: 12,
            background: '#fafafa'
          }}
        >
          {unplannedByTech.size === 0 && <div style={{ color: '#6b7280' }}>— нет заявок —</div>}

          {[...unplannedByTech.entries()].map(([key, arr]) => {
            const techName =
              key === 'none'
                ? 'Без техника'
                : (techById.get(key)?.name || `Tech ${key}`);
            return (
              <div key={key} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{techName}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {arr.map((j) => {
                    const title = `#${j.job_number || j.id} — ${getClientName(j)}`;
                    const addr = getClientAddress(j);
                    const pal = statusPalette[statusKey(j.status)] || statusPalette.default;
                    return (
                      <div
                        key={j.id}
                        className="ext-evt"
                        data-id={String(j.id)}
                        data-title={title}
                        title="Drag onto a time slot in the calendar"
                        onDoubleClick={() => navigate(`/job/${j.id}`)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr',
                          gap: 6,
                          minWidth: 280,
                          maxWidth: 420,
                          border: `1px solid ${pal.ring}`,
                          borderRadius: 12,
                          background: pal.bg,
                          padding: '8px 10px',
                          cursor: 'grab',
                          boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.05)'
                        }}
                      >
                        <div style={{ fontWeight: 800, color: pal.fg }}>#{j.job_number || j.id}</div>
                        <div style={{ color: '#111827', fontWeight: 700 }}>{getClientName(j)}</div>
                        {addr && <div style={{ gridColumn: '1 / span 2', color: '#374151' }}>{addr}</div>}
                        {j.issue && <div style={{ gridColumn: '1 / span 2', color: '#6b7280' }}>{j.issue}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Calendar ===== */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 8,
          boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 10px 20px rgba(0,0,0,0.04)'
        }}
      >
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          locale="en"
          timeZone="America/New_York"
          slotMinTime="08:00:00"
          slotMaxTime="20:00:00"
          businessHours={{ daysOfWeek: [0,1,2,3,4,5,6], startTime: '08:00', endTime: '20:00' }}
          allDaySlot={false}
          nowIndicator
          expandRows
          slotDuration="01:00:00"
          slotLabelInterval="01:00"
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit' }}
          dayHeaderFormat={{ weekday: 'short', month: 'numeric', day: 'numeric' }}
          stickyHeaderDates
          height="72vh"
          eventDisplay="block"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit' }}
          dragScroll
          longPressDelay={150}
          eventOverlap
          slotEventOverlap={false}
          editable
          eventStartEditable
          eventDurationEditable={false}
          droppable
          events={events}
          eventDrop={handleEventDrop}
          eventReceive={handleEventReceive}
          eventClick={handleEventClick}
          eventContent={renderEventContent}
          eventDidMount={eventDidMount}
        />
      </div>

      <Legend />
    </div>
  );
}

/* ===== small UI ===== */
function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: 999,
        border: active ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
        background: active ? 'linear-gradient(180deg,#2563eb,#1d4ed8)' : '#fff',
        color: active ? '#fff' : '#111827',
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: active ? '0 6px 16px rgba(29,78,216,0.25)' : '0 1px 0 rgba(0,0,0,0.02)',
        transition: 'all .15s ease',
      }}
    >
      {children}
    </button>
  );
}

function Legend() {
  const item = (bg, text, label) => (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: bg,
        color: text,
        fontSize: 12,
        marginRight: 8,
        boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.6)',
        border: '1px solid rgba(0,0,0,0.04)'
      }}
    >
      ● {label}
    </span>
  );
  return (
    <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
      {item('#fee2e2', '#7f1d1d', 'ReCall')}
      {item('#fef9c3', '#854d0e', 'Diagnosis')}
      {item('#e0f2fe', '#075985', 'In progress')}
      {item('#e0e7ff', '#3730a3', 'Parts ordered')}
      {item('#ede9fe', '#5b21b6', 'Waiting for parts')}
      {item('#fffbeb', '#92400e', 'To finish')}
      {item('#d1fae5', '#065f46', 'Completed')}
      <span style={{ marginLeft: 12 }}>Unpaid jobs are marked with a dashed border.</span>
    </div>
  );
}
