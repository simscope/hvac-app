// client/src/pages/JobDetailsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import heic2any from 'heic2any'; // ← добавлено для конвертации HEIC → JPEG

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

/* ---------- Storage ---------- */
const PHOTOS_BUCKET = 'job-photos';
const INVOICES_BUCKET = 'invoices';
const storage = () => supabase.storage.from(PHOTOS_BUCKET);
const invStorage = () => supabase.storage.from(INVOICES_BUCKET);

/* ---------- Справочники ---------- */
const STATUS_OPTIONS = [
  'recall',
  'диагностика',
  'в работе',
  'заказ деталей',
  'ожидание деталей',
  'к финишу',
  'завершено',
  'отменено',
];
const PAYMENT_OPTIONS = ['—', 'Наличные', 'cash', 'card', 'zelle', 'check'];
const SYSTEM_OPTIONS = ['HVAC', 'Appliance'];

/* ---------- Хелперы ---------- */
const toNum = (v) => (v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));
const stringOrNull = (v) => (v === '' || v == null ? null : String(v));

// корректный URL для HashRouter и BrowserRouter
function makeFrontUrl(path) {
  const base = window.location.origin;
  const isHash = window.location.href.includes('/#/');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return isHash ? `${base}/#${clean}` : `${base}${clean}`;
}

// datetime-local
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s;
};

const normalizeStatusForDb = (s) => {
  if (!s) return null;
  const v = String(s).trim();
  if (v.toLowerCase() === 'recall' || v === 'ReCall') return 'recall';
  if (v === 'выполнено') return 'завершено';
  return v;
};

/* ---------- Санитизация имён для Storage ---------- */
const RU_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
function slugifyFileName(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'bin';
  const stem = name.replace(/\.[^/.]+$/, '').toLowerCase();
  const translit = stem
    .split('')
    .map((ch) => {
      if (/[a-z0-9]/.test(ch)) return ch;
      const m = RU_MAP[ch];
      if (m) return m;
      if (/[ \-_.]/.test(ch)) return '-';
      return '-';
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${translit || 'file'}.${ext}`;
}
function makeSafeStorageKey(jobId, originalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = slugifyFileName(originalName);
  return `${jobId}/${stamp}_${safeName}`;
}

/* ---------- HEIC → JPEG (Web) ---------- */
const isHeicLike = (file) =>
  file &&
  (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  );

// Возвращает исходный File, если не HEIC, или новый File(JPEG), если HEIC/HEIF
async function convertIfHeicWeb(file) {
  if (!isHeicLike(file)) return file;

  const jpegBlob = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  });

  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([jpegBlob], newName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
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

  // Клиент
  const [client, setClient] = useState({ id: null, full_name: '', phone: '', email: '', address: '' });
  const [clientDirty, setClientDirty] = useState(false);

  // Фото
  const [photos, setPhotos] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef(null);

  // Выбор фото
  const [checked, setChecked] = useState({});
  const allChecked = useMemo(() => photos.length > 0 && photos.every((p) => checked[p.name]), [photos, checked]);

  // Комментарии
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(true);

  // Инвойсы (Storage + DB)
  const [invoices, setInvoices] = useState([]); // {source,name,url,updated_at,invoice_no,hasFile}
  const [invoicesLoading, setInvoicesLoading] = useState(true);

  /* ---------- загрузка ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: techData, error: techErr } = await supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (techErr) {
        console.error('load techs', techErr);
        setTechs([]);
      } else {
        setTechs(techData || []);
      }

      const { data: j, error: e1 } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      if (e1 || !j) {
        alert('Заявка не найдена');
        navigate('/jobs');
        return;
      }
      setJob(j);

      // клиент
      if (j.client_id) {
        const { data: c } = await supabase
          .from('clients')
          .select('id, full_name, phone, email, address')
          .eq('id', j.client_id)
          .maybeSingle();
        if (c) {
          setClient({
            id: c.id,
            full_name: c.full_name || '',
            phone: c.phone || '',
            email: c.email || '',
            address: c.address || '',
          });
        } else {
          setClient({
            id: null,
            full_name: j.client_name || j.full_name || '',
            phone: j.client_phone || j.phone || '',
            email: j.client_email || j.email || '',
            address: j.client_address || j.address || '',
          });
        }
      } else {
        setClient({
          id: null,
          full_name: j.client_name || j.full_name || '',
          phone: j.client_phone || j.phone || '',
          email: j.client_email || j.email || '',
          address: j.client_address || j.address || '',
        });
      }

      // материалы
      const { data: m } = await supabase
        .from('materials')
        .select('*')
        .eq('job_id', jobId)
        .order('id', { ascending: true });
      setMaterials(m || []);

      await loadPhotos();
      await loadComments();
      await loadInvoices();

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /* ---------- загрузка фото ---------- */
  const loadPhotos = async () => {
    const { data, error } = await storage().list(`${jobId}`, {
      limit: 200,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      console.error(error);
      setPhotos([]);
      return;
    }
    const mapped = (data || []).map((o) => {
      const full = `${jobId}/${o.name}`;
      const { data: pub } = storage().getPublicUrl(full);
      return { name: o.name, url: pub.publicUrl };
    });
    setPhotos(mapped);
    setChecked({});
  };

  /* ---------- Комментарии ---------- */
  const isRoleLike = (v) => {
    if (!v) return false;
    const s = String(v).trim().toLowerCase();
    return /^(admin(istrator)?|manager|technician|админ|администратор|менеджер|техник)$/.test(s);
  };

  const loadComments = async () => {
    setCommentsLoading(true);

    const { data, error } = await supabase
      .from('comments')
      .select('id, job_id, text, image_url, author_user_id, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadComments', error);
      setComments([]);
      setCommentsLoading(false);
      return;
    }

    const list = data || [];
    const ids = Array.from(new Set(list.map((c) => c.author_user_id).filter(Boolean)));

    const nameByUserId = {};

    if (ids.length) {
      // приоритет: technicians.name
      const { data: techPeople } = await supabase
        .from('technicians')
        .select('auth_user_id, name')
        .in('auth_user_id', ids);

      (techPeople || []).forEach((t) => {
        if (t?.auth_user_id && t?.name) nameByUserId[t.auth_user_id] = t.name;
      });

      // затем profiles.full_name, и только если не «похоже на роль» — profiles.name
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids);

      (profs || []).forEach((p) => {
        if (!p?.id) return;
        if (!nameByUserId[p.id] && p.full_name && p.full_name.trim()) {
            nameByUserId[p.id] = p.full_name.trim();
         }
      });
    }

    setComments(list.map((c) => ({ ...c, author_name: nameByUserId[c.author_user_id] || null })));
    setCommentsLoading(false);
  };

  const addComment = async () => {
    const text = commentText.trim();
    if (!text) return;

    const payload = {
      job_id: jobId,
      text,
      author_user_id: user?.id ?? null,
    };
    const { data, error } = await supabase
      .from('comments')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('addComment', error);
      alert('Не удалось сохранить комментарий');
      return;
    }

    // подбираем «красивое» имя
    let authorName = null;

    if (user?.id) {
      const { data: t } = await supabase
        .from('technicians')
        .select('name')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (t?.name) authorName = t.name;
    }

    if (!authorName) {
      if (profile?.full_name) authorName = profile.full_name;
      else if (profile?.name && !isRoleLike(profile.name)) authorName = profile.name;
      else authorName = user?.email || null;
    }

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
      appointment_time: job.appointment_time ?? null,
      system_type: job.system_type || null,
      issue: job.issue || null,
      scf: toNum(job.scf),
      labor_price: toNum(job.labor_price),
      payment_method: !job.payment_method || job.payment_method === '—' ? null : String(job.payment_method),
      status: normalizeStatusForDb(job.status),
      job_number: stringOrNull(job.job_number),
    };
    if (Object.prototype.hasOwnProperty.call(job, 'tech_comment')) {
      payload.tech_comment = job.tech_comment || null;
    }

    try {
      const { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
      if (error) throw error;
      setDirty(false);
      alert('Сохранено');
    } catch (e) {
      console.error('[saveJob] update error:', e);
      console.error('[saveJob] payload:', payload);
      alert(`Не удалось сохранить: ${e.message || 'ошибка запроса'}`);
    }
  };

  /* ---------- редактирование клиента ---------- */
  const setClientField = (k, v) => {
    setClient((p) => ({ ...p, [k]: v }));
    setClientDirty(true);
  };

  const saveClient = async () => {
    if (client.id || job?.client_id) {
      const cid = client.id || job.client_id;
      const { error } = await supabase
        .from('clients')
        .update({
          full_name: client.full_name || '',
          phone: client.phone || '',
          email: client.email || '',
          address: client.address || '',
        })
        .eq('id', cid);
      if (error) {
        alert('Не удалось сохранить клиента');
        console.error(error);
        return;
      }
      setClientDirty(false);
      alert('Клиент сохранён');
      return;
    }

    const patch = {};
    if ('client_name' in (job || {})) patch.client_name = client.full_name || '';
    if ('client_phone' in (job || {})) patch.client_phone = client.phone || '';
    if ('client_email' in (job || {})) patch.client_email = client.email || '';
    if ('client_address' in (job || {})) patch.client_address = client.address || '';

    if (Object.keys(patch).length) {
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) {
        alert('Не удалось сохранить клиента в заявку');
        console.error(error);
        return;
      }
      setClientDirty(false);
      alert('Клиент сохранён');
    } else {
      alert('Нет client_id и колонок клиента в jobs — нечего сохранять.');
    }
  };

  /* ---------- материалы ---------- */
  const addMat = () => {
    setMaterials((p) => [
      ...p,
      {
        id: `tmp-${Date.now()}`,
        job_id: jobId,
        name: '',
        price: null,
        quantity: 1,
        supplier: '',
      },
    ]);
  };

  const chMat = (idx, field, val) => {
    setMaterials((p) => {
      const n = [...p];
      n[idx] = { ...n[idx], [field]: val };
      return n;
    });
  };

  const delMat = async (m) => {
    setMaterials((p) => p.filter((x) => x !== m));
    if (!String(m.id).startsWith('tmp-')) {
      const { error } = await supabase.from('materials').delete().eq('id', m.id);
      if (error) console.error('delete material', error);
    }
  };

  const saveMats = async () => {
    const news = materials.filter((m) => String(m.id).startsWith('tmp-'));
    const olds = materials.filter((m) => !String(m.id).startsWith('tmp-'));

    if (news.length) {
      const payload = news.map((m) => ({
        job_id: jobId,
        name: m.name || '',
        price: m.price === '' || m.price == null ? null : Number(m.price),
        quantity: m.quantity === '' || m.quantity == null ? 1 : Number(m.quantity),
        supplier: m.supplier || null,
      }));

      const { error } = await supabase.from('materials').insert(payload);
      if (error) {
        console.error('insert materials', error);
        alert(`Не удалось сохранить новые материалы: ${error.message || 'ошибка'}`);
        return;
      }
    }

    for (const m of olds) {
      const patch = {
        name: m.name || '',
        price: m.price === '' || m.price == null ? null : Number(m.price),
        quantity: m.quantity === '' || m.quantity == null ? 1 : Number(m.quantity),
        supplier: m.supplier || null,
      };
      const { error } = await supabase.from('materials').update(patch).eq('id', m.id);
      if (error) {
        console.error('update material', error);
        alert(`Не удалось сохранить материал: ${error.message || 'ошибка'}`);
        return;
      }
    }

    const { data: fresh, error: reloadErr } = await supabase
      .from('materials')
      .select('*')
      .eq('job_id', jobId)
      .order('id', { ascending: true });

    if (reloadErr) {
      console.error(reloadErr);
    } else {
      setMaterials(fresh || []);
    }
    alert('Материалы сохранены');
  };

  /* ---------- файлы ---------- */
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadBusy(true);

    for (const original of files) {
      // проверка допустимых расширений/типов
      const allowed =
        /image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif)/i.test(original.type) ||
        /pdf$/i.test(original.type) ||
        /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|pdf)$/i.test(original.name);

      if (!allowed) {
        alert(`Формат не поддерживается: ${original.name}`);
        continue;
      }

      // Конвертируем HEIC/HEIF → JPEG, иначе возвращаем исходный файл
      let file;
      try {
        file = await convertIfHeicWeb(original);
      } catch (convErr) {
        console.error('HEIC convert error:', convErr);
        alert(`Не удалось конвертировать файл: ${original.name}`);
        continue;
      }

      // Генерируем ключ уже от конечного имени (если был HEIC — теперь .jpg)
      const key = makeSafeStorageKey(jobId, file.name);

      try {
        const { error } = await storage().upload(key, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        });
        if (error) throw error;
      } catch (upErr) {
        console.error('upload error:', upErr, key);
        alert(`Не удалось загрузить файл: ${file.name}`);
      }
    }

    await loadPhotos();
    setUploadBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const delPhoto = async (name) => {
    if (!window.confirm('Удалить файл?')) return;
    const { error } = await storage().remove([`${jobId}/${name}`]);
    if (error) {
      alert('Не удалось удалить файл');
      console.error(error);
      return;
    }
    await loadPhotos();
  };

  const toggleAllPhotos = (v) => {
    if (v) {
      const next = {};
      photos.forEach((p) => {
        next[p.name] = true;
      });
      setChecked(next);
    } else {
      setChecked({});
    }
  };
  const toggleOnePhoto = (name) => setChecked((s) => ({ ...s, [name]: !s[name] }));

  const downloadOne = async (name) => {
    const { data, error } = await storage().download(`${jobId}/${name}`);
    if (error || !data) {
      console.error('downloadOne', error);
      alert('Не удалось скачать файл');
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSelected = async () => {
    const names = photos.filter((p) => checked[p.name]).map((p) => p.name);
    if (!names.length) return;
    for (const n of names) await downloadOne(n);
  };

  /* ---------- инвойсы ---------- */
  const loadInvoices = async () => {
    setInvoicesLoading(true);
    try {
      const [stRes, dbRes] = await Promise.all([
        invStorage().list(`${jobId}`, {
          limit: 200,
          sortBy: { column: 'updated_at', order: 'desc' },
        }),
        supabase
          .from('invoices')
          .select('invoice_no, created_at')
          .eq('job_id', jobId)
          .order('created_at', { ascending: false }),
      ]);

      const stData = stRes?.data || [];
      const stor = stData
        .filter((o) => /\.pdf$/i.test(o.name))
        .map((o) => {
          const full = `${jobId}/${o.name}`;
          const { data: pub } = invStorage().getPublicUrl(full);
          const m = /invoice_(\d+)\.pdf$/i.exec(o.name);
          return {
            source: 'storage',
            name: o.name,
            url: pub?.publicUrl || null,
            updated_at: o.updated_at || o.created_at || null,
            invoice_no: m ? String(m[1]) : null,
            hasFile: true,
          };
        });

      const rows = dbRes?.data || [];
      const db = rows.map((r) => ({
        source: 'db',
        name: `invoice_${r.invoice_no}.pdf`,
        url: null,
        updated_at: r.created_at,
        invoice_no: String(r.invoice_no),
        hasFile: stor.some((s) => s.invoice_no === String(r.invoice_no)),
      }));

      const merged = [...stor];
      db.forEach((d) => {
        if (!merged.some((x) => x.invoice_no === d.invoice_no)) merged.push(d);
      });

      merged.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      setInvoices(merged);
    } catch (e) {
      console.error('loadInvoices merge error:', e);
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  };

  const openInvoice = (item) => {
    if (item?.hasFile && item?.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } else if (item?.invoice_no) {
      window.open(makeFrontUrl(`/invoice/${jobId}?no=${encodeURIComponent(item.invoice_no)}`), '_blank', 'noopener,noreferrer');
    } else {
      window.open(makeFrontUrl(`/invoice/${jobId}`), '_blank', 'noopener,noreferrer');
    }
  };

  const downloadInvoice = async (item) => {
    if (!item?.hasFile) return;
    const { data, error } = await invStorage().download(`${jobId}/${item.name}`);
    if (error || !data) {
      console.error('downloadInvoice', error);
      alert('Не удалось скачать инвойс');
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteInvoice = async (item) => {
    if (!item?.hasFile) return;
    if (!window.confirm('Удалить инвойс?')) return;
    const { error } = await invStorage().remove([`${jobId}/${item.name}`]);
    if (error) {
      console.error('deleteInvoice', error);
      alert('Не удалось удалить инвойс');
      return;
    }
    await loadInvoices();
  };

  const createInvoice = () => {
    window.open(makeFrontUrl(`/invoice/${jobId}`), '_blank', 'noopener,noreferrer');
  };

  /* ---------- отображение ---------- */
  const jobNumTitle = useMemo(() => (job?.job_number ? `#${job.job_number}` : '#—'), [job]);
  const isUnpaid = !job?.payment_method || job.payment_method === '—';
  const isRecall = String(job?.status || '').toLowerCase().trim() === 'recall';

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

      {/* Верхняя сетка: слева Параметры, справа Клиент + Инвойсы */}
      <div style={GRID2}>
        {/* Левая колонка */}
        <div style={COL}>
          {/* Параметры */}
          <div style={BOX}>
            <div style={H2}>Параметры</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={ROW}>
                <div>Техник</div>
                <select
                  style={SELECT}
                  value={job.technician_id == null ? '' : String(job.technician_id)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setField('technician_id', v === '' ? null : normalizeId(v));
                  }}
                >
                  <option value="">—</option>
                  {techs.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={ROW}>
                <div>Дата визита</div>
                <input
                  style={INPUT}
                  type="datetime-local"
                  value={toLocal(job.appointment_time)}
                  onChange={(e) => setField('appointment_time', fromLocal(e.target.value))}
                />
              </div>

              <div style={ROW}>
                <div>Тип системы</div>
                <select
                  style={SELECT}
                  value={job.system_type || ''}
                  onChange={(e) => setField('system_type', e.target.value)}
                >
                  {SYSTEM_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div style={ROW}>
                <div>Проблема</div>
                <input style={INPUT} value={job.issue || ''} onChange={(e) => setField('issue', e.target.value)} />
              </div>

              <div style={ROW}>
                <div>SCF ($)</div>
                <input
                  style={INPUT}
                  type="number"
                  value={job.scf ?? ''}
                  onChange={(e) => setField('scf', toNum(e.target.value))}
                />
              </div>

              <div style={ROW}>
                <div>Стоимость работы ($)</div>
                <input
                  style={INPUT}
                  type="number"
                  value={job.labor_price ?? ''}
                  onChange={(e) => setField('labor_price', toNum(e.target.value))}
                />
              </div>

              <div style={ROW}>
                <div>Оплата работы</div>
                <div>
                  <select
                    style={{
                      ...SELECT,
                      border: `1px solid ${isUnpaid ? '#ef4444' : '#e5e7eb'}`,
                      background: isUnpaid ? '#fef2f2' : '#fff',
                    }}
                    value={job.payment_method ?? '—'}
                    onChange={(e) => setField('payment_method', e.target.value === '—' ? null : e.target.value)}
                  >
                    {PAYMENT_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {isUnpaid && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>
                      Не оплачено — выбери способ оплаты
                    </div>
                  )}
                </div>
              </div>

              <div style={ROW}>
                <div>Статус</div>
                <div>
                  <select
                    style={{
                      ...SELECT,
                      border: `1px solid ${isRecall ? '#ef4444' : '#e5e7eb'}`,
                      background: isRecall ? '#fef2f2' : '#fff',
                    }}
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

              <div style={ROW}>
                <div>Job № (необязательно)</div>
                <input style={INPUT} value={job.job_number || ''} onChange={(e) => setField('job_number', e.target.value)} />
              </div>

              {'tech_comment' in (job || {}) && (
                <div style={ROW}>
                  <div>Комментарий от техника</div>
                  <textarea style={TA} value={job.tech_comment || ''} onChange={(e) => setField('tech_comment', e.target.value)} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={PRIMARY} onClick={saveJob} disabled={!dirty}>
                  Сохранить заявку
                </button>
                <button style={GHOST} onClick={() => navigate(-1)}>
                  Назад
                </button>
                {!dirty && <div style={{ ...MUTED, alignSelf: 'center' }}>Изменений нет</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Правая колонка: Клиент + Инвойсы */}
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
                <button style={PRIMARY} onClick={saveClient} disabled={!clientDirty}>
                  Сохранить клиента
                </button>
                {!clientDirty && <div style={{ ...MUTED, alignSelf: 'center' }}>Изменений нет</div>}
              </div>
            </div>
          </div>

          {/* Инвойсы (PDF) */}
          <div style={BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={H2}>Инвойсы (PDF)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={BTN} onClick={loadInvoices} disabled={invoicesLoading}>
                  {invoicesLoading ? '...' : 'Обновить'}
                </button>
                <button type="button" style={PRIMARY} onClick={createInvoice} title="Создать новый инвойс для этой заявки">
                  + Создать инвойс
                </button>
              </div>
            </div>

            {!invoices || invoices.length === 0 ? (
              <div style={MUTED}>Пока нет инвойсов для этой заявки</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {invoices.map((inv) => (
                  <div
                    key={`${inv.source}-${inv.invoice_no || inv.name}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      border: '1px solid #eef2f7',
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {inv.invoice_no ? `Invoice #${inv.invoice_no}` : inv.name}
                        {!inv.hasFile && (
                          <span style={{ marginLeft: 8, color: '#a1a1aa', fontWeight: 400 }}>(PDF ещё не в хранилище)</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {inv.updated_at ? new Date(inv.updated_at).toLocaleString() : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" style={BTN} onClick={() => openInvoice(inv)}>
                        Открыть PDF
                      </button>
                      <button
                        type="button"
                        style={{ ...BTN, opacity: inv.hasFile ? 1 : 0.5, cursor: inv.hasFile ? 'pointer' : 'not-allowed' }}
                        onClick={() => inv.hasFile && downloadInvoice(inv)}
                        disabled={!inv.hasFile}
                      >
                        Скачать
                      </button>
                      <button
                        type="button"
                        style={{ ...DANGER, opacity: inv.hasFile ? 1 : 0.5, cursor: inv.hasFile ? 'pointer' : 'not-allowed' }}
                        onClick={() => inv.hasFile && deleteInvoice(inv)}
                        disabled={!inv.hasFile}
                      >
                        Удалить
                      </button>
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
                <Th>Название</Th>
                <Th>Цена</Th>
                <Th>Кол-во</Th>
                <Th>Поставщик</Th>
                <Th center>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={m.id}>
                  <Td>
                    <input style={INPUT} value={m.name || ''} onChange={(e) => chMat(i, 'name', e.target.value)} />
                  </Td>
                  <Td>
                    <input style={INPUT} type="number" value={m.price ?? ''} onChange={(e) => chMat(i, 'price', e.target.value)} />
                  </Td>
                  <Td>
                    <input
                      style={INPUT}
                      type="number"
                      value={m.quantity ?? 1}
                      onChange={(e) => chMat(i, 'quantity', e.target.value)}
                    />
                  </Td>
                  <Td>
                    <input style={INPUT} value={m.supplier || ''} onChange={(e) => chMat(i, 'supplier', e.target.value)} />
                  </Td>
                  <Td center>
                    <button style={DANGER} onClick={() => delMat(m)}>
                      🗑
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={GHOST} onClick={addMat}>
            + Добавить
          </button>
          <button style={PRIMARY} onClick={saveMats}>
            Сохранить материалы
          </button>
        </div>
      </div>

      {/* Комментарии */}
      <div style={BOX}>
        <div style={H2}>Комментарии</div>

        {commentsLoading ? (
          <div style={MUTED}>Загрузка…</div>
        ) : (
          <>
            <div
              style={{
                maxHeight: 260,
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 10,
                marginBottom: 8,
              }}
            >
              {comments.length === 0 ? (
                <div style={MUTED}>Пока нет комментариев</div>
              ) : (
                comments.map((c) => {
                  const when = new Date(c.created_at).toLocaleString();
                  const who = c.author_name || '—';
                  return (
                    <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {when} • {who}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                rows={2}
                style={{ ...TA, minHeight: 60 }}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Написать комментарий…"
              />
              <button style={PRIMARY} onClick={addComment}>
                Отправить
              </button>
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
              <input type="checkbox" checked={allChecked} onChange={(e) => toggleAllPhotos(e.target.checked)} /> Выбрать
              всё
            </label>
            <button style={PRIMARY} onClick={downloadSelected} disabled={!Object.values(checked).some(Boolean)}>
              Скачать выбранные
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.pdf,image/*,application/pdf"
            onChange={onPick}
          />
          {uploadBusy && <span style={MUTED}>Загрузка…</span>}
        </div>

        {photos.length === 0 && <div style={MUTED}>Файлов пока нет (необязательно)</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
          {photos.map((p) => (
            <div key={p.name} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, userSelect: 'none', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!checked[p.name]} onChange={() => toggleOnePhoto(p.name)} />
                <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{p.name}</span>
              </label>

              {/\.(pdf)$/i.test(p.name) ? (
                <div style={{ height: 120, display: 'grid', placeItems: 'center', background: '#f1f5f9', borderRadius: 8, marginBottom: 6 }}>
                  📄 PDF
                </div>
              ) : (
                <img
                  src={p.url}
                  alt={p.name}
                  style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 6 }}
                />
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <button style={BTN} onClick={() => downloadOne(p.name)}>
                  Скачать
                </button>
                <button style={DANGER} onClick={() => delPhoto(p.name)}>
                  Удалить
                </button>
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
    <th
      style={{
        textAlign: center ? 'center' : 'left',
        borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb',
        padding: 8,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, center }) {
  return (
    <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9', textAlign: center ? 'center' : 'left' }}>{children}</td>
  );
}


