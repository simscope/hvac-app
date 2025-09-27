// client/src/pages/JobDetailsPage.jsx
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState, useRef as useRef2 } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, supabaseUrl } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

/* ===== Время NY: читаем/пишем "как в БД" ===== */
const NY_TZ = 'America/New_York';

// из ISO/строки из БД берём просто YYYY-MM-DDTHH:mm (без конверсий)
function wallFromDb(isoLike) {
  if (!isoLike) return '';
  const s = String(isoLike);
  const m =
    s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/) ||
    s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const year = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : m[1];
  const hh   = m[m.length - 2];
  const mm   = m[m.length - 1];
  return `${year}T${hh}:${mm}`;
}

// получить оффсет зоны NY для конкретного "стеночного" времени (YYYY-MM-DDTHH:mm)
function nyOffsetForWall(wall) {
  const [dpart, tpart] = String(wall).split('T');
  const [y, m, d] = dpart.split('-').map(Number);
  const [H, M] = tpart.split(':').map(Number);
  const fakeUtc = Date.UTC(y, m - 1, d, H, M, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    timeZoneName: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(fakeUtc));
  const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-00';
  const m2 = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
  if (!m2) return '+00:00';
  const sign = m2[1].startsWith('-') ? '-' : '+';
  const hh = String(Math.abs(parseInt(m2[1], 10))).padStart(2, '0');
  const mm = String(m2[2] ? parseInt(m2[2], 10) : 0).padStart(2, '0');
  return `${sign}${hh}:${mm}`; // например "-04:00" / "-05:00"
}

// если в БД уже было значение — пробуем забрать из него оффсет, иначе вычисляем по дате (DST)
function zonedIsoFromWall(wall, prevIsoLike) {
  let offset = null;
  if (prevIsoLike) {
    const m = String(prevIsoLike).match(/([+-]\d{2}:\d{2}|Z)$/);
    if (m && m[1] !== 'Z') offset = m[1];
  }
  if (!offset) offset = nyOffsetForWall(wall);
  return `${wall}:00${offset}`; // "YYYY-MM-DDTHH:mm:00-04:00"
}

/* ---------- UI ---------- */
const PAGE = { padding: 16, display: 'grid', gap: 12 };
const BOX = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const GRID2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const COL = { display: 'grid', gap: 12 };
const ROW = { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' };
const INPUT = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' };
const SELECT = { ...INPUT };
const TA = { ...INPUT, minHeight: 80, resize: 'vertical' };

const H1 = { fontWeight: 800, fontSize: 22 };
const H2 = { fontWeight: 700, fontSize: 16, marginBottom: 8 };
const MUTED = { color: '#6b7280' };

const BTN = { padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' };
const PRIMARY = { ...BTN, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const DANGER = { ...BTN, borderColor: '#ef4444', color: '#ef4444' };
const GHOST = { ...BTN, background: '#f8fafc' };
// баннер архива
const ARCHIVE_BANNER = {
  padding: 12,
  border: '1px solid #fdba74',
  background: '#fff7ed',
  color: '#9a3412',
  borderRadius: 10,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  alignItems: 'center',
};

/* ---------- Storage ---------- */
const PHOTOS_BUCKET = 'job-photos';
const INVOICES_BUCKET = 'invoices';
const storage = () => supabase.storage.from(PHOTOS_BUCKET);
const invStorage = () => supabase.storage.from(INVOICES_BUCKET);

/* ---------- Edge helpers ---------- */
function functionsBase() { return supabaseUrl.replace('.supabase.co', '.functions.supabase.co'); }
async function callEdgeAuth(path, body) {
  const { data: { session} } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  const url = `${functionsBase().replace(/\/+$/,'')}/${path}`;
  const res = await fetch(url, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!res.ok) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
  return json;
}

/* ---------- Справочники ---------- */
const STATUS_OPTIONS = ['recall', 'диагностика', 'в работе', 'заказ деталей', 'ожидание деталей', 'к финишу', 'завершено', 'отменено'];
const SYSTEM_OPTIONS = ['HVAC', 'Appliance'];

/* ---------- Оплата ---------- */
const PM_ALLOWED = ['cash', 'zelle', 'card', 'check'];
const pmToSelect = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return PM_ALLOWED.includes(s) ? s : '-';
};
const pmToSave = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return PM_ALLOWED.includes(s) ? s : '-';
};

/* ---------- Хелперы ---------- */
const toNum = (v) => (v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));
const stringOrNull = (v) => (v == null ? null : (String(v).trim() || null));
const normalizeEmail = (v) => { const s = (v ?? '').toString().trim(); return s ? s.toLowerCase() : null; };
function makeFrontUrl(path) {
  const base = window.location.origin;
  const isHash = window.location.href.includes('/#/');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return isHash ? `${base}/#${clean}` : `${base}${clean}`;
}
const normalizeId = (v) => { if (v === '' || v == null) return null; const s = String(v); return /^\d+$/.test(s) ? Number(s) : s; };
const normalizeStatusForDb = (s) => { if (!s) return null; const v = String(s).trim(); if (v.toLowerCase()==='recall'||v==='ReCall') return 'recall'; if (v==='выполнено') return 'завершено'; return v; };

// завершённый статус?
const DONE_STATUSES = new Set(['завершено','заверщено','completed','done','закрыто']);
const isDone = (s) => DONE_STATUSES.has(String(s||'').toLowerCase().trim());

/* ---------- HEIC → JPEG ---------- */
const RU_MAP = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',};
function slugifyFileName(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'bin';
  const stem = name.replace(/\.[^/.]+$/, '').toLowerCase();
  const translit = stem.split('').map((ch)=>{
    if (/[a-z0-9]/.test(ch)) return ch;
    const m = RU_MAP[ch]; if (m) return m;
    if (/[ \-_.]/.test(ch)) return '-';
    return '-';
  }).join('').replace(/-+/g,'-').replace(/(^-|-$)/g,'');
  return `${translit || 'file'}.${ext}`;
}
function makeSafeStorageKey(jobId, originalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const safeName = slugifyFileName(originalName);
  return `${jobId}/${stamp}_${safeName}`;
}
const isHeicLike = (file) =>
  file && (file.type === 'image/heic' || file.type === 'image/heif' || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name));
async function convertIfHeicWeb(file) {
  if (!isHeicLike(file)) return file;
  let heic2any; try { const mod = await import('heic2any'); heic2any = mod.default || mod; } catch { throw new Error('heic2any не установлен'); }
  const jpegBlob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([jpegBlob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

/* ====================================================================== */

export default function JobDetailsPage() {
  const { id } = useParams();
  const jobId = id;
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [techs, setTechs] = useState([]);
  const [materials, setMaterials] = useState([]);

  const [client, setClient] = useState({ id: null, full_name: '', phone: '', email: '', address: '' });
  const [clientDirty, setClientDirty] = useState(false);

  const [photos, setPhotos] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef(null);

  const [checked, setChecked] = useState({});
  const allChecked = useMemo(() => photos.length > 0 && photos.every((p) => checked[p.name]), [photos, checked]);

  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(true);

  // invoices
  const [invoices, setInvoices] = useState([]); // {source,name,url,updated_at,invoice_no,hasFile,db_id}
  const [invoicesLoading, setInvoicesLoading] = useState(true);

  // чтоб автоархивация не зациклилась
  const autoArchivedOnce = useRef(false);

  /* ---------- загрузка ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: techData } = await supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .eq('is_active', true)
        .order('name', { ascending: true });
      setTechs(techData || []);

      const { data: j, error: e1 } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
      if (e1 || !j) { alert('Заявка не найдена'); navigate('/jobs'); return; }
      setJob(j);

      // клиент
      if (j.client_id) {
        const { data: c } = await supabase
          .from('clients').select('id, full_name, phone, email, address').eq('id', j.client_id).maybeSingle();
        setClient(c ? {
          id: c.id, full_name: c.full_name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
        } : {
          id: null, full_name: j.client_name || j.full_name || '', phone: j.client_phone || j.phone || '',
          email: j.client_email || j.email || '', address: j.client_address || j.address || '',
        });
      } else {
        setClient({
          id: null, full_name: j.client_name || j.full_name || '', phone: j.client_phone || j.phone || '',
          email: j.client_email || j.email || '', address: j.client_address || j.address || '',
        });
      }

      const { data: m } = await supabase.from('materials').select('*').eq('job_id', jobId).order('id', { ascending: true });
      setMaterials(m || []);

      await loadPhotos();
      await loadComments();
      await loadInvoices();

      setLoading(false);
    })();
  }, [jobId]);

  // авто-архивация по гарантии (60 дней)
  useEffect(() => {
    const run = async () => {
      if (!job || autoArchivedOnce.current) return;
      if (job.archived_at) return; // уже в архиве
      if (!isDone(job.status)) return; // не завершено — не трогаем

      // базовая дата гарантии: completed_at > appointment_time > created_at
      const baseDateStr = job.completed_at || job.appointment_time || job.created_at;
      if (!baseDateStr) return;

      const base = new Date(baseDateStr);
      if (Number.isNaN(base.getTime())) return;

      const days = (Date.now() - base.getTime()) / (24 * 60 * 60 * 1000);
      if (days < 60) return;

      try {
        autoArchivedOnce.current = true;
        const patch = { archived_at: new Date().toISOString(), archived_reason: 'Гарантия истекла (60 дней) [auto]' };
        const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
        if (!error) setJob((p) => ({ ...(p || {}), ...patch }));
      } catch (e) {
        // молчим, это необязательная операция
        console.warn('auto-archive failed', e);
      }
    };
    run();
  }, [job, jobId]);

  /* ---------- загрузка фото ---------- */
  const loadPhotos = async () => {
    const { data, error } = await storage().list(`${jobId}`, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
    if (error) { setPhotos([]); return; }
    const mapped = (data || []).map((o) => {
      const full = `${jobId}/${o.name}`;
      const { data: pub } = storage().getPublicUrl(full);
      return { name: o.name, url: pub.publicUrl };
    });
    setPhotos(mapped);
    setChecked({});
  };

  /* ---------- Комментарии ---------- */
  const loadComments = async () => {
    setCommentsLoading(true);
    const { data, error } = await supabase
      .from('comments')
      .select('id, job_id, text, image_url, author_user_id, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (error) { setComments([]); setCommentsLoading(false); return; }

    const list = data || [];
    const ids = Array.from(new Set(list.map((c) => c.author_user_id).filter(Boolean)));

    const nameByUserId = {};
    if (ids.length) {
      const { data: techPeople } = await supabase.from('technicians').select('auth_user_id, name').in('auth_user_id', ids);
      (techPeople || []).forEach((t) => { if (t?.auth_user_id && t?.name) nameByUserId[t.auth_user_id] = t.name; });
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      (profs || []).forEach((p) => { if (p?.id && !nameByUserId[p.id] && p.full_name?.trim()) nameByUserId[p.id] = p.full_name.trim(); });
    }
    setComments(list.map((c) => ({ ...c, author_name: nameByUserId[c.author_user_id] || null })));
    setCommentsLoading(false);
  };

  const addComment = async () => {
    const text = commentText.trim(); if (!text) return;
    const payload = { job_id: jobId, text, author_user_id: user?.id ?? null };
    const { data, error } = await supabase.from('comments').insert(payload).select().single();
    if (error) { alert('Не удалось сохранить комментарий'); return; }

    let authorName = null;
    if (user?.id) {
      const { data: t } = await supabase.from('technicians').select('name').eq('auth_user_id', user.id).maybeSingle();
      if (t?.name) authorName = t.name;
    }
    if (!authorName) authorName = profile?.full_name || user?.email || null;

    setComments((prev) => [...prev, { ...data, author_name: authorName }]);
    setCommentText('');
  };

  /* ---------- редактирование заявки ---------- */
  const setField = (k, v) => {
    setJob((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [k]: v };
      setDirty(true);
      return next;
    });
  };

  const saveJob = async () => {
    const payload = {
      technician_id: normalizeId(job.technician_id),
      appointment_time: job.appointment_time ?? null, // уже в нужном формате
      system_type: job.system_type || null,
      issue: job.issue || null,
      scf: toNum(job.scf),
      labor_price: toNum(job.labor_price),
      status: normalizeStatusForDb(job.status),
      job_number: stringOrNull(job.job_number),
    };

    payload.labor_payment_method = pmToSave(job.labor_payment_method);
    payload.scf_payment_method   = pmToSave(job.scf_payment_method);

    if (Object.prototype.hasOwnProperty.call(job, 'tech_comment')) {
      payload.tech_comment = job.tech_comment || null;
    }

    try {
      const { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
      if (error) throw error;
      setDirty(false);
      alert('Сохранено');
    } catch (e) {
      alert(`Не удалось сохранить: ${e.message || 'ошибка запроса'}`);
    }
  };

  /* ---------- Архив / Разархив ---------- */
  const archiveJob = async (reason) => {
    try {
      const patch = { archived_at: new Date().toISOString(), archived_reason: reason || null };
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw error;
      setJob((p) => ({ ...(p || {}), ...patch }));
    } catch (e) {
      alert('Не удалось отправить в архив: ' + (e.message || e));
    }
  };
  const unarchiveJob = async () => {
    try {
      const patch = { archived_at: null, archived_reason: null };
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw error;
      setJob((p) => ({ ...(p || {}), ...patch }));
    } catch (e) {
      alert('Не удалось вернуть из архива: ' + (e.message || e));
    }
  };

  /* ---------- редактирование клиента ---------- */
  const setClientField = (k, v) => { setClient((p) => ({ ...p, [k]: v })); setClientDirty(true); };

  const mirrorClientIntoJob = async (cid, c) => {
    const patch = {};
    if ('client_id' in (job || {})) patch.client_id = cid;
    if ('client_name' in (job || {})) patch.client_name = c.full_name || '';
    if ('client_phone' in (job || {})) patch.client_phone = c.phone || '';
    if ('client_email' in (job || {})) patch.client_email = c.email || '';
    if ('client_address' in (job || {})) patch.client_address = c.address || '';
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw error;
      setJob((prev) => ({ ...(prev || {}), ...patch }));
    }
  };

  const saveClient = async () => {
    const payload = {
      full_name: stringOrNull(client.full_name) ?? '',
      phone: stringOrNull(client.phone) ?? '',
      email: normalizeEmail(client.email),
      address: stringOrNull(client.address) ?? '',
    };

    try {
      if (client.id || job?.client_id) {
        const cid = client.id || job.client_id;

        const { error: upErr } = await supabase.from('clients').update(payload).eq('id', cid);
        if (upErr) throw upErr;

        const { data: fresh, error: selErr } = await supabase
          .from('clients')
          .select('id, full_name, phone, email, address')
          .eq('id', cid)
          .maybeSingle();
        if (selErr) throw selErr;

        const merged = fresh ?? { id: cid, ...payload };

        await mirrorClientIntoJob(cid, merged);
        setClient({
          id: cid,
          full_name: merged.full_name || '',
          phone: merged.phone || '',
          email: merged.email || '',
          address: merged.address || '',
        });
        setClientDirty(false);
        alert('Клиент сохранён');
        return;
      }

      const { data: created, error: insErr } = await supabase
        .from('clients')
        .insert(payload)
        .select('id, full_name, phone, email, address')
        .single();
      if (insErr) throw insErr;

      await mirrorClientIntoJob(created.id, created);
      setClient({
        id: created.id,
        full_name: created.full_name || '',
        phone: created.phone || '',
        email: created.email || '',
        address: created.address || '',
      });
      setClientDirty(false);
      alert('Клиент создан и привязан к заявке');
    } catch (e) {
      console.error('saveClient error:', e);
      alert(`Не удалось сохранить клиента: ${e.message || 'ошибка'}`);
    }
  };

  /* ---------- материалы ---------- */
  const addMat = () => {
    setMaterials((p) => [...p, { id: `tmp-${Date.now()}`, job_id: jobId, name: '', price: null, quantity: 1, supplier: '' }]);
  };
  const chMat = (idx, field, val) => { setMaterials((p) => { const n = [...p]; n[idx] = { ...n[idx], [field]: val }; return n; }); };
  const delMat = async (m) => {
    setMaterials((p) => p.filter((x) => x !== m));
    if (!String(m.id).startsWith('tmp-')) { const { error } = await supabase.from('materials').delete().eq('id', m.id); if (error) console.error(error); }
  };
  const saveMats = async () => {
    const news = materials.filter((m) => String(m.id).startsWith('tmp-'));
    const olds = materials.filter((m) => !String(m.id).startsWith('tmp-'));

    if (news.length) {
      const payload = news.map((m) => ({
        job_id: jobId, name: m.name || '', price: m.price===''||m.price==null?null:Number(m.price),
        quantity: m.quantity===''||m.quantity==null?1:Number(m.quantity), supplier: m.supplier || null,
      }));
      const { error } = await supabase.from('materials').insert(payload);
      if (error) { alert(`Не удалось сохранить новые материалы: ${error.message || 'ошибка'}`); return; }
    }

    for (const m of olds) {
      const patch = {
        name: m.name || '',
        price: m.price===''||m.price==null?null:Number(m.price),
        quantity: m.quantity===''||m.quantity==null?1:Number(m.quantity),
        supplier: m.supplier || null,
      };
      const { error } = await supabase.from('materials').update(patch).eq('id', m.id);
      if (error) { alert(`Не удалось сохранить материал: ${error.message || 'ошибка'}`); return; }
    }

    const { data: fresh } = await supabase.from('materials').select('*').eq('job_id', jobId).order('id', { ascending: true });
    setMaterials(fresh || []); alert('Материалы сохранены');
  };

  /* ---------- файлы ---------- */
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setUploadBusy(true);
    try {
      for (const original of files) {
        const allowed =
          /image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif)/i.test(original.type) ||
          /pdf$/i.test(original.type) ||
          /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|pdf)$/i.test(original.name);
        if (!allowed) { alert(`Формат не поддерживается: ${original.name}`); continue; }

        let file;
        try { file = await convertIfHeicWeb(original); } catch (convErr) {
          if (isHeicLike(original)) { alert('HEIC/HEIF. Конвертация не сработала.'); continue; }
          file = original;
        }

        const key = makeSafeStorageKey(jobId, file.name);
        try {
          const { error } = await storage().upload(key, file, {
            cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream',
          });
          if (error) throw error;
        } catch (upErr) {
          alert(`Не удалось загрузить файл: ${file.name}`);
        }
      }
    } finally {
      await loadPhotos();
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Удаление файла (функция auth + fallback)
  const delPhoto = async (name) => {
    if (!window.confirm('Удалить файл?')) return;
    try {
      await callEdgeAuth('admin-delete-photo', { bucket: PHOTOS_BUCKET, path: `${jobId}/${name}` });
      await loadPhotos();
    } catch (e) {
      const { error } = await storage().remove([`${jobId}/${name}`]);
      if (error) { alert(`Не удалось удалить файл: ${e.message || error.message || 'ошибка'}`); return; }
      await loadPhotos();
    }
  };

  const toggleAllPhotos = (checkedAll) => { setChecked(checkedAll ? Object.fromEntries(photos.map(p=>[p.name,true])) : {}); };
  const toggleOnePhoto = (name) => setChecked((s) => ({ ...s, [name]: !s[name] }));
  const downloadOne = async (name) => {
    const { data, error } = await storage().download(`${jobId}/${name}`);
    if (error || !data) { alert('Не удалось скачать файл'); return; }
    const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const downloadSelected = async () => { const names = photos.filter((p) => checked[p.name]).map((p) => p.name); for (const n of names) await downloadOne(n); };

  /* ---------- инвойсы ---------- */
  const loadInvoices = async () => {
    setInvoicesLoading(true);
    try {
      const [stRes, dbRes] = await Promise.all([
        invStorage().list(`${jobId}`, { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } }),
        supabase.from('invoices').select('id, invoice_no, created_at').eq('job_id', jobId).order('created_at', { ascending: false }),
      ]);

      const stData = stRes?.data || [];
      const stor = stData
        .filter((o) => /\.pdf$/i.test(o.name))
        .map((o) => {
          const full = `${jobId}/${o.name}`;
          const { data: pub } = invStorage().getPublicUrl(full);
          const m = /invoice_(\d+)\.pdf$/i.exec(o.name);
          return {
            source: 'storage', name: o.name, url: pub?.publicUrl || null,
            updated_at: o.updated_at || o.created_at || null,
            invoice_no: m ? String(m[1]) : null, hasFile: true,
          };
        });

      const rows = dbRes?.data || [];
      const db = rows.map((r) => ({
        source: 'db', name: `invoice_${r.invoice_no}.pdf`, url: null,
        updated_at: r.created_at, invoice_no: String(r.invoice_no),
        db_id: r.id,
        hasFile: stor.some((s) => s.invoice_no === String(r.invoice_no)),
      }));

      const merged = [...stor];
      db.forEach((d) => { if (!merged.some((x) => x.invoice_no === d.invoice_no)) merged.push(d); });
      merged.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      setInvoices(merged);
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  };

  const openInvoice = (item) => {
    if (item?.hasFile && item?.url) window.open(item.url, '_blank', 'noopener,noreferrer');
    else if (item?.invoice_no) window.open(makeFrontUrl(`/invoice/${jobId}?no=${encodeURIComponent(item.invoice_no)}`), '_blank','noopener,noreferrer');
    else window.open(makeFrontUrl(`/invoice/${jobId}`), '_blank','noopener,noreferrer');
  };

  const downloadInvoice = async (item) => {
    if (!item?.hasFile) return;
    const { data, error } = await invStorage().download(`${jobId}/${item.name}`);
    if (error || !data) { alert('Не удалось скачать инвойс'); return; }
    const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = item.name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const deleteInvoice = async (item) => {
    const fileName = item?.name || (item?.invoice_no ? `invoice_${item.invoice_no}.pdf` : null);
    const key = fileName ? `${jobId}/${fileName}` : null;

    if (!window.confirm(`Удалить инвойс${item?.invoice_no ? ' #' + item.invoice_no : ''}?`)) return;

    try {
      await callEdgeAuth('admin-delete-invoice-bundle', {
        bucket: INVOICES_BUCKET,
        key,
        db_id: item?.db_id || null,
        job_id: jobId,
        invoice_no: item?.invoice_no != null ? Number(item.invoice_no) : null,
      });
    } catch (e) {
      alert(`Не удалось удалить инвойс: ${e.message || e}`);
      return;
    }

    await loadInvoices();
  };

  const createInvoice = () => { window.open(makeFrontUrl(`/invoice/${jobId}`), '_blank', 'noopener,noreferrer'); };

  /* ---------- отображение ---------- */
  const jobNumTitle = useMemo(() => (job?.job_number ? `#${job.job_number}` : '#—'), [job]);
  const isUnpaidLabor = pmToSelect(job?.labor_payment_method) === '-';
  const isUnpaidSCF   = (toNum(job?.scf) || 0) > 0 && pmToSelect(job?.scf_payment_method) === '-';
  const isRecall = String(job?.status || '').toLowerCase().trim() === 'recall';
  const isArchived = !!job?.archived_at;

  if (loading) {
    return (
      <div style={PAGE}>
        <div style={H1}>Редактирование заявки {jobNumTitle}</div>
        <div style={{ ...BOX, textAlign: 'center', color: '#6b7280' }}>Загрузка…</div>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <div style={H1}>Редактирование заявки {jobNumTitle}</div>

      {/* Баннер архива */}
      {isArchived && (
        <div style={ARCHIVE_BANNER}>
          <div>
            <strong>Заявка в архиве.</strong>{' '}
            <span>
              С {job.archived_at ? new Date(job.archived_at).toLocaleString() : '—'}.
              {job.archived_reason ? ` Причина: ${job.archived_reason}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN} onClick={unarchiveJob}>Вернуть из архива</button>
          </div>
        </div>
      )}

      <div style={GRID2}>
        <div style={COL}>
          <div style={BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={H2}>Параметры</div>
              {!isArchived && (
                <button
                  style={{ ...BTN, borderColor: '#f59e0b', color: '#b45309', background: '#fffbeb' }}
                  onClick={() => {
                    const r = window.prompt('Причина архивации', 'отказ от ремонта');
                    if (r !== null) archiveJob(r || null);
                  }}
                >
                  📦 В архив
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={ROW}>
                <div>Техник</div>
                <select
                  style={SELECT}
                  value={job.technician_id == null ? '' : String(job.technician_id)}
                  onChange={(e) => { const v = e.target.value; setField('technician_id', v === '' ? null : normalizeId(v)); }}
                >
                  <option value="">—</option>
                  {techs.map((t) => (<option key={t.id} value={String(t.id)}>{t.name}</option>))}
                </select>
              </div>

              <div style={ROW}>
                <div>Дата визита (NY)</div>
                <input
                  style={INPUT}
                  type="datetime-local"
                  value={wallFromDb(job.appointment_time)}
                  onChange={(e)=>setField('appointment_time', zonedIsoFromWall(e.target.value, job.appointment_time))}
                />
              </div>

              <div style={ROW}>
                <div>Тип системы</div>
                <select style={SELECT} value={job.system_type || SYSTEM_OPTIONS[0]} onChange={(e)=>setField('system_type', e.target.value)}>
                  {SYSTEM_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>

              <div style={ROW}><div>Проблема</div><input style={INPUT} value={job.issue || ''} onChange={(e)=>setField('issue', e.target.value)} /></div>

              <div style={ROW}><div>SCF ($)</div><input style={INPUT} type="number" value={job.scf ?? ''} onChange={(e)=>setField('scf', toNum(e.target.value))} /></div>

              <div style={ROW}>
                <div>Оплата SCF</div>
                <div>
                  <select
                    style={{ ...SELECT, border: `1px solid ${isUnpaidSCF ? '#ef4444' : '#e5e7eb'}`, background: isUnpaidSCF ? '#fef2f2' : '#fff' }}
                    value={pmToSelect(job.scf_payment_method)}
                    onChange={(e) => setField('scf_payment_method', pmToSave(e.target.value))}
                  >
                    {['-', 'cash', 'zelle', 'card', 'check'].map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                  {isUnpaidSCF && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>SCF не оплачено — выбери способ оплаты</div>}
                </div>
              </div>

              <div style={ROW}><div>Стоимость работы ($)</div><input style={INPUT} type="number" value={job.labor_price ?? ''} onChange={(e)=>setField('labor_price', toNum(e.target.value))} /></div>

              <div style={ROW}>
                <div>Оплата работы</div>
                <div>
                  <select
                    style={{ ...SELECT, border: `1px solid ${isUnpaidLabor ? '#ef4444' : '#e5e7eb'}`, background: isUnpaidLabor ? '#fef2f2' : '#fff' }}
                    value={pmToSelect(job.labor_payment_method)}
                    onChange={(e) => setField('labor_payment_method', pmToSave(e.target.value))}
                  >
                    {['-', 'cash', 'zelle', 'card', 'check'].map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                  {isUnpaidLabor && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>Не оплачено — выбери способ оплаты</div>}
                </div>
              </div>

              <div style={ROW}>
                <div>Статус</div>
                <div>
                  <select
                    style={{ ...SELECT, border: `1px solid ${isRecall ? '#ef4444' : '#e5e7eb'}`, background: isRecall ? '#fef2f2' : '#fff' }}
                    value={job.status || STATUS_OPTIONS[0]}
                    onChange={(e) => setField('status', normalizeStatusForDb(e.target.value))}
                  >
                    <option value="recall">ReCall</option>
                    <option value="диагностика">диагностика</option>
                    <option value="в работе">в работе</option>
                    <option value="заказ деталей">заказ деталей</option>
                    <option value="ожидание деталей">ожидание деталей</option>
                    <option value="к финишу">к финишу</option>
                    <option value="завершено">завершено</option>
                    <option value="отменено">отменено</option>
                  </select>
                  {isRecall && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>Статус ReCall</div>}
                </div>
              </div>

              <div style={ROW}><div>Job № (необязательно)</div><input style={INPUT} value={job.job_number || ''} onChange={(e)=>setField('job_number', e.target.value)} /></div>

              {'tech_comment' in (job || {}) && (
                <div style={ROW}><div>Комментарий от техника</div><textarea style={TA} value={job.tech_comment || ''} onChange={(e)=>setField('tech_comment', e.target.value)} /></div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={PRIMARY} onClick={saveJob} disabled={!dirty}>Сохранить заявку</button>
                <button style={GHOST} onClick={() => navigate(-1)}>Назад</button>
                {!dirty && <div style={{ ...MUTED, alignSelf: 'center' }}>Изменений нет</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Правая колонка */}
        <div style={COL}>
          {/* Клиент */}
          <div style={BOX}>
            <div style={H2}>Клиент</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <Row label="ФИО" value={client.full_name} onChange={(v) => setClientField('full_name', v)} />
              <Row label="Телефон" value={client.phone} onChange={(v) => setClientField('phone', v)} />
              <Row label="Email" value={client.email} onChange={(v) => setClientField('email', v)} />
              <Row label="Адрес" value={client.address} onChange={(v) => setClientField('address', v)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={PRIMARY} onClick={saveClient} disabled={!clientDirty}>Сохранить клиента</button>
                {!clientDirty && <div style={{ ...MUTED, alignSelf: 'center' }}>Изменений нет</div>}
              </div>
              {job?.client_id && <div style={{ ...MUTED, fontSize: 12 }}>Привязан client_id: {String(job.client_id)}</div>}
            </div>
          </div>

          {/* Инвойсы */}
          <div style={BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={H2}>Инвойсы (PDF)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={BTN} onClick={loadInvoices} disabled={invoicesLoading}>{invoicesLoading ? '...' : 'Обновить'}</button>
                <button type="button" style={PRIMARY} onClick={createInvoice}>+ Создать инвойс</button>
              </div>
            </div>

            {!invoices || invoices.length === 0 ? (
              <div style={MUTED}>Пока нет инвойсов для этой заявки</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {invoices.map((inv) => (
                  <div
                    key={`${inv.source}-${inv.invoice_no || inv.name}`}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid #eef2f7', borderRadius: 8 }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {inv.invoice_no ? `Invoice #${inv.invoice_no}` : inv.name}
                        {!inv.hasFile && (<span style={{ marginLeft: 8, color: '#a1a1aa', fontWeight: 400 }}>(PDF ещё не в хранилище)</span>)}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{inv.updated_at ? new Date(inv.updated_at).toLocaleString() : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" style={BTN} onClick={() => openInvoice(inv)}>Открыть PDF</button>
                      <button type="button" style={{ ...BTN, opacity: inv.hasFile ? 1 : 0.5, cursor: inv.hasFile ? 'pointer' : 'not-allowed' }} onClick={() => inv.hasFile && downloadInvoice(inv)} disabled={!inv.hasFile}>Скачать</button>
                      <button type="button" style={{ ...DANGER, opacity: inv.hasFile ? 1 : 0.5, cursor: inv.hasFile ? 'pointer' : 'not-allowed' }} onClick={() => inv.hasFile && deleteInvoice(inv)} disabled={!inv.hasFile}>Удалить</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Материалы */}
      <div style={BOX}>
        <div style={H2}>Материалы</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Название</Th><Th>Цена</Th><Th>Кол-во</Th><Th>Поставщик</Th><Th center>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={m.id}>
                  <Td><input style={INPUT} value={m.name || ''} onChange={(e)=>chMat(i,'name',e.target.value)} /></Td>
                  <Td><input style={INPUT} type="number" value={m.price ?? ''} onChange={(e)=>chMat(i,'price',e.target.value)} /></Td>
                  <Td><input style={INPUT} type="number" value={m.quantity ?? 1} onChange={(e)=>chMat(i,'quantity',e.target.value)} /></Td>
                  <Td><input style={INPUT} value={m.supplier || ''} onChange={(e)=>chMat(i,'supplier',e.target.value)} /></Td>
                  <Td center><button style={DANGER} onClick={()=>delMat(m)}>🗑</button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={GHOST} onClick={addMat}>+ Добавить</button>
          <button style={PRIMARY} onClick={saveMats}>Сохранить материалы</button>
        </div>
      </div>

      {/* Комментарии */}
      <div style={BOX}>
        <div style={H2}>Комментарии</div>
        {commentsLoading ? (
          <div style={MUTED}>Загрузка…</div>
        ) : (
          <>
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              {comments.length === 0 ? (
                <div style={MUTED}>Пока нет комментариев</div>
              ) : (
                comments.map((c) => {
                  const when = new Date(c.created_at).toLocaleString();
                  const who = c.author_name || '—';
                  return (
                    <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{when} • {who}</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea rows={2} style={{ ...TA, minHeight: 60 }} value={commentText} onChange={(e)=>setCommentText(e.target.value)} placeholder="Написать комментарий…" />
              <button style={PRIMARY} onClick={addComment}>Отправить</button>
            </div>
          </>
        )}
      </div>

      {/* Фото / файлы */}
      <div style={BOX}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={H2}>Фото / файлы</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ userSelect: 'none', cursor: 'pointer' }}>
              <input type="checkbox" checked={allChecked} onChange={(e)=>toggleAllPhotos(e.target.checked)} /> Выбрать всё
            </label>
            <button style={PRIMARY} onClick={downloadSelected} disabled={!Object.values(checked).some(Boolean)}>Скачать выбранные</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.pdf,image/*,application/pdf" onChange={onPick} />
          {uploadBusy && <span style={MUTED}>Загрузка…</span>}
        </div>

        {photos.length === 0 && <div style={MUTED}>Файлов пока нет (необязательно)</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
          {photos.map((p) => (
            <div key={p.name} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, userSelect: 'none', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!checked[p.name]} onChange={()=>toggleOnePhoto(p.name)} />
                <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{p.name}</span>
              </label>

              {/\.(pdf)$/i.test(p.name) ? (
                <div style={{ height: 120, display: 'grid', placeItems: 'center', background: '#f1f5f9', borderRadius: 8, marginBottom: 6 }}>📄 PDF</div>
              ) : (
                <img src={p.url} alt={p.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 6 }} />
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <button style={BTN} onClick={()=>downloadOne(p.name)}>Скачать</button>
                <button style={DANGER} onClick={()=>delPhoto(p.name)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Мелкие компоненты ---------- */
function Row({ label, value, onChange }) {
  return (
    <div style={ROW}>
      <div>{label}</div>
      <input style={INPUT} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Th({ children, center }) {
  return (
    <th style={{ textAlign: center ? 'center' : 'left', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', padding: 8 }}>
      {children}
    </th>
  );
}
function Td({ children, center }) {
  return (
    <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9', textAlign: center ? 'center' : 'left' }}>{children}</td>
  );
}
