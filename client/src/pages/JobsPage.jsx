// client/src/pages/JobsPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateJob from '../components/CreateJob';
import JobRowEditable from '../components/JobRowEditable';
import { supabase } from '../supabaseClient';

const STATUS_ORDER = ['recall','диагностика','в работе','заказ деталей','ожидание деталей','к финишу','завершено'];

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [comments, setComments] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const navigate = useNavigate();

  useEffect(() => { fetchAll(); }, []);
  const fetchAll = async () => {
    const [{ data: jobData },{ data: clientData },{ data: materialData },{ data: commentData },{ data: techData }] =
      await Promise.all([
        supabase.from('jobs').select('*'),
        supabase.from('clients').select('*'),
        supabase.from('materials').select('*'),
        supabase.from('comments').select('*'),
        supabase.from('technicians').select('id,name,role').eq('role','tech'),
      ]);
    setJobs(jobData||[]); setClients(clientData||[]);
    setMaterials(materialData||[]); setComments(commentData||[]);
    setTechnicians(techData||[]);
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '—';
    const p = (n)=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const jobsWithExtras = useMemo(()=> (jobs||[]).map((job)=>{
    const c = clients.find((x)=>x.id===job.client_id);
    const parts = (materials||[]).filter(m=>m.job_id===job.id).map(m=>m.name).join(', ');
    const cm = (comments||[]).find(x=>x.job_id===job.id);
    return {
      ...job,
      client_name: c?.full_name || c?.name || '—',
      client_phone: c?.phone || '',
      details: parts || '—',
      comment: cm?.text || cm?.content || '—',
      created_at_fmt: fmtDate(job.created_at),
    };
  }),[jobs,clients,materials,comments]);

  const orderMap = useMemo(()=> new Map(STATUS_ORDER.map((s,i)=>[s,i])), []);
  const sortedJobs = useMemo(()=> {
    return [...jobsWithExtras].sort((a,b)=>{
      const ar = orderMap.has(String(a.status).toLowerCase()) ? orderMap.get(String(a.status).toLowerCase()) : 999;
      const br = orderMap.has(String(b.status).toLowerCase()) ? orderMap.get(String(b.status).toLowerCase()) : 999;
      if (ar!==br) return ar-br;
      return new Date(b.created_at||0)-new Date(a.created_at||0);
    });
  },[jobsWithExtras,orderMap]);

  const openJob = (job)=> navigate(`/job/${job.id}`);

  return (
    <div style={{ padding: 20 }}>

      {/* ЕСЛИ у вас был отдельный левый заголовок для формы — просто удалите его. 
          Создание заявки (блок/дизайн) НЕ трогаем. */}
      <CreateJob onCreated={fetchAll} />

      {/* таблица без горизонтального скролла */}
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table thead th { background:#f5f5f5; font-weight:600; }
        .wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .row-click { cursor:pointer; }
        .row-click:hover { background:#f9fafb; }
      `}</style>

      <table className="jobs-table">
        {/* процентовки подобраны, чтобы всё вмещалось; перенос слов включён */}
        <colgroup>
          <col style={{width:'3%'}} />
          <col style={{width:'17%'}} />
          <col style={{width:'5%'}} />
          <col style={{width:'40%'}} />
          <col style={{width:'3%'}} />
          <col style={{width:'10%'}} />
          <col style={{width:'8%'}} />
          <col style={{width:'8%'}} />
        </colgroup>
        <thead>
          <tr>
            <th>Номер</th>
            <th>Клиент</th>
            <th>Система</th>
            <th>Проблема</th>
            <th>SCF</th>
            <th>Техник</th>
            <th>Дата</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {sortedJobs.map(job=>(
            <JobRowEditable
              key={job.id}
              job={job}
              technicians={technicians}
              onUpdate={fetchAll}
              onSelect={openJob}      // <- кликабельная строка
              makeRowClickable        // <- см. патч компонента ниже
            />
          ))}
          {sortedJobs.length===0 && (
            <tr><td colSpan={9} style={{padding:10}}>Нет заявок</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
