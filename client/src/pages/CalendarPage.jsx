// client/src/pages/CalendarPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import { supabase } from '../supabaseClient';

// ''|null=>null; '123'=>123; иначе — строка (UUID)
const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s;
};

export default function CalendarPage() {
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeTech, setActiveTech] = useState(null);
  const extRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const [{ data: j }, { data: t }, { data: c }] = await Promise.all([
        supabase.from('jobs').select('*'),
        supabase.from('technicians').select('id, name, role').eq('role', 'tech'),
        supabase.from('clients').select('id, full_name, address'),
      ]);
      setJobs(j || []);
      setTechs(t || []);
      setClients(c || []);
    })();
  }, []);

  useEffect(() => {
    if (!activeTech && techs?.length) setActiveTech(techs[0].id);
  }, [techs, activeTech]);

  const clientsById = useMemo(() => {
    const m = new Map();
    for (const c of clients) m.set(String(c.id), c);
    return m;
  }, [clients]);

  const getClientName = (job) =>
    clientsById.get(String(job?.client_id))?.full_name ||
    job?.client_name ||
    job?.full_name ||
    'Без имени';

  const getClientAddress = (job) =>
    clientsById.get(String(job?.client_id))?.address ||
    job?.client_address ||
    job?.address ||
    '';

  // ---- стиль по статусу/оплате
  const normalizeStatus = (s) => {
    if (!s) return '';
    const v = String(s).toLowerCase().trim();
    if (v === 'recall' || v === 'recal' || v === 'reсall' || v === 'рекол' || v === 'реколл') return 'recall';
    if (v === 'диагностика') return 'diagnostics';
    if (v === 'к финишу') return 'to_finish';
    if (v === 'ожидание' || v === 'ожидание деталей') return 'waiting_parts';
    if (v === 'заказ деталей') return 'parts_ordered';
    if (v === 'в работе') return 'in_progress';
    if (v === 'завершено' || v === 'выполнено') return 'finished';
    return v;
  };

  const palette = {
    recall:        { bg: '#fee2e2', fg: '#7f1d1d', ring: '#ef4444' }, // красный
    diagnostics:   { bg: '#fef9c3', fg: '#854d0e', ring: '#eab308' },
    to_finish:     { bg: '#fffbeb', fg: '#92400e', ring: '#f59e0b' },
    waiting_parts: { bg: '#ede9fe', fg: '#5b21b6', ring: '#8b5cf6' },
    parts_ordered: { bg: '#e0e7ff', fg: '#3730a3', ring: '#6366f1' },
    in_progress:   { bg: '#e0f2fe', fg: '#075985', ring: '#0ea5e9' },
    finished:      { bg: '#d1fae5', fg: '#065f46', ring: '#10b981' },
    default:       { bg: '#f3f4f6', fg: '#111827', ring: '#9ca3af' },
  };

  const styleForJob = (job) => {
    const key = normalizeStatus(job.status);
    const base = palette[key] || palette.default;
    const unpaid = !job?.payment || job.payment === '—';
    return { ...base, unpaid };
  };

  // ---- внешние (без мастера) карточки — делаем draggable
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

  const events = useMemo(() => {
    if (!activeTech) return [];
    return (jobs || [])
      .filter(
        (j) =>
          j.appointment_time &&
          String(j.technician_id) === String(activeTech)
      )
      .map((j) => {
        const s = styleForJob(j);
        return {
          id: String(j.id),
          title: `#${j.job_number || j.id} — ${getClientName(j)}`,
          start: j.appointment_time,
          allDay: false,
          backgroundColor: s.bg,
          borderColor: s.unpaid ? '#ef4444' : s.ring,
          textColor: s.fg,
          extendedProps: {
            clientName: getClientName(j),
            address: getClientAddress(j),
            unpaid: s.unpaid,
            isRecall: normalizeStatus(j.status) === 'recall',
            job: j,
          },
        };
      });
  }, [jobs, activeTech, clientsById]); // clientsById завязан на clients

  const unassigned = useMemo(
    () => (jobs || []).filter((j) => !j.technician_id),
    [jobs]
  );

  const handleEventDrop = async (info) => {
    const id = info.event.id;
    const newStart = info.event.start?.toISOString() ?? null;
    const { error } = await supabase.from('jobs').update({ appointment_time: newStart }).eq('id', id);
    if (error) {
      info.revert();
      alert('Не удалось сохранить дату/время');
      console.error(error);
      return;
    }
    setJobs((prev) => prev.map((j) => (String(j.id) === id ? { ...j, appointment_time: newStart } : j)));
  };

  const handleEventReceive = async (info) => {
    const id = info.event.id;
    if (!activeTech) {
      info.event.remove();
      alert('Сначала выберите мастера, затем перетащите заявку в его календарь.');
      return;
    }
    const newStart = info.event.start?.toISOString() ?? null;
    const payload = { appointment_time: newStart, technician_id: normalizeId(activeTech) };
    const { error } = await supabase.from('jobs').update(payload).eq('id', id);
    if (error) {
      info.event.remove();
      alert('Не удалось назначить мастера/дату');
      console.error(error);
      return;
    }
    setJobs((prev) =>
      prev.map((j) => (String(j.id) === id ? { ...j, appointment_time: newStart, technician_id: normalizeId(activeTech) } : j))
    );
  };

  const handleEventClick = (info) => navigate(`/job/${info.event.id}`);

  // собственный рендер содержимого события
  const renderEventContent = (arg) => {
    const { clientName, address } = arg.event.extendedProps;
    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '2px';
    wrap.style.fontSize = '12px';
    const line1 = document.createElement('div');
    line1.style.fontWeight = '700';
    line1.textContent = arg.event.title; // "#номер — Имя"
    wrap.appendChild(line1);
    if (address) {
      const line2 = document.createElement('div');
      line2.style.opacity = '0.9';
      line2.textContent = address.length > 80 ? address.slice(0, 80) + '…' : address;
      wrap.appendChild(line2);
    }
    return { domNodes: [wrap] };
  };

  // пост-рендер стили (пунктир если неоплачено; жирнее для ReCall)
  const eventDidMount = (info) => {
    const { unpaid, isRecall } = info.event.extendedProps || {};
    if (unpaid) {
      info.el.style.borderStyle = 'dashed';
      info.el.style.borderWidth = '2px';
    }
    if (isRecall) {
      info.el.style.filter = 'saturate(1.2)';
      info.el.style.fontWeight = '700';
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>🗓 Календарь</h1>

      {/* вкладки мастеров */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {techs.map((t) => (
          <Tab
            key={t.id}
            active={String(activeTech) === String(t.id)}
            onClick={() => setActiveTech(t.id)}
          >
            {t.name}
          </Tab>
        ))}
      </div>

      {/* без мастера */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>
          Без мастера (перетащите карточку заявки в календарь выбранной вкладки мастера):
        </div>
        <div
          ref={extRef}
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            padding: 8,
            border: '1px dashed #e5e7eb',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          {unassigned.length === 0 && <div style={{ color: '#6b7280' }}>— нет заявок —</div>}

          {unassigned.map((j) => {
            const title = `#${j.job_number || j.id} — ${getClientName(j)}`;
            const addr = getClientAddress(j);
            return (
              <div
                key={j.id}
                className="ext-evt"
                data-id={String(j.id)}
                data-title={title}
                title="Перетащите на календарь мастера"
                onDoubleClick={() => navigate(`/job/${j.id}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 6,
                  minWidth: 280,
                  maxWidth: 420,
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#fff',
                  padding: '8px 10px',
                  cursor: 'grab',
                }}
              >
                <div style={{ fontWeight: 700 }}>#{j.job_number || j.id}</div>
                <div style={{ color: '#111827', fontWeight: 600 }}>{getClientName(j)}</div>
                {addr && (
                  <div style={{ gridColumn: '1 / span 2', color: '#374151' }}>
                    {addr}
                  </div>
                )}
                {j.issue && (
                  <div style={{ gridColumn: '1 / span 2', color: '#6b7280' }}>{j.issue}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
        locale="ru"
        height="72vh"
        editable
        eventStartEditable
        eventDurationEditable={false}
        droppable
        dragScroll
        longPressDelay={150}
        allDaySlot={false}
        events={events}
        eventDrop={handleEventDrop}
        eventReceive={handleEventReceive}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        eventDidMount={eventDidMount}
      />

      <p style={{ marginTop: 8, color: '#6b7280', fontSize: 13 }}>
        Подсказка: выберите вкладку мастера, затем перетащите заявку из блока «Без мастера» в календарь.
        Двойной клик по карточке/событию откроет страницу заявки.
      </p>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        background: active ? '#2563eb' : '#fff',
        color: active ? '#fff' : '#111827',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
