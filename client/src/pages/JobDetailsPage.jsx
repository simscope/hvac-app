// client/src/pages/JobDetailsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

/* ---------- UI стили ---------- */
const BOX = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const PAGE = { padding: 16, display: 'grid', gap: 12 };
const GRID2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const ROW  = { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' };
const INPUT = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' };
const SELECT = { ...INPUT };
const TA = { ...INPUT, minHeight: 80, resize: 'vertical' };

const H1 = { fontWeight: 800, fontSize: 22 };
const H2 = { fontWeight: 700, fontSize: 16, marginBottom: 8 };
const MUTED = { color: '#6b7280' };

const BTN = { padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' };
const PRIMARY = { ...BTN, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const DANGER  = { ...BTN, borderColor: '#ef4444', color: '#ef4444' };
const GHOST   = { ...BTN, background: '#f8fafc' };

/* ---------- Хранилище фото ---------- */
const PHOTOS_BUCKET = 'job-photos';
const storage = () => supabase.storage.from(PHOTOS_BUCKET);

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
const PAYMENT_OPTIONS = ['—', 'Наличные', 'cash', 'card', 'zelle', 'invoice'];
const SYSTEM_OPTIONS = ['HVAC', 'Appliance', 'Plumbing', 'Electrical'];

/* ---------- Хелперы ---------- */
const toNum = (v) => (v === '' || v === null || isNaN(v) ? null : Number(v));
const stringOrNull = (v) => (v === '' || v == null ? null : String(v));

// datetime-local helpers
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

// ''|null => null; '123' => 123; иначе — строка (UUID)
const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s;
};

// приведение статуса к базе
const normalizeStatusForDb = (s) => {
  if (!s) return null;
  const v = String(s).trim();
  if (v.toLowerCase() === 'recall' || v === 'ReCall') return 'recall';
  if (v === 'выполнено') return 'завершено';
  return v;
};

/* ---------- Санитизация имён файлов для Storage ---------- */
const RU_MAP = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',
  к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f',
  х:'h', ц:'c', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya'
};
function slugifyFileName(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'bin';
  const stem = name.replace(/\.[^/.]+$/, '').toLowerCase();
  const translit = stem
    .split('')
    .map(ch => {
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'); // 2025-09-05T15-30-00-123Z
  const safeName = slugifyFileName(originalName);
  return `${jobId}/${stamp}_${safeName}`;
}

/* ---------- Компонент ---------- */
export default function JobDetailsPage() {
  const { id } = useParams();
  const jobId = id;
  const navigate = useNavigate();

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

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: t } = await supabase
        .from('technicians')
        .select('id,name,role')
        .order('name', { ascending: true });
      setTechs(t || []);

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
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

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
      payment_method: !job.payment_method || job.payment_method === '—'
        ? null
        : String(job.payment_method),
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
      { id: `tmp-${Date.now()}`, job_id: jobId, name: '', price: 0, qty: 1, vendor: '' },
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
      await supabase.from('materials').delete().eq('id', m.id);
    }
  };
  const saveMats = async () => {
    const news = materials.filter((m) => String(m.id).startsWith('tmp-'));
    const olds = materials.filter((m) => !String(m.id).startsWith('tmp-'));

    if (news.length) {
      const payload = news.map((m) => ({
        job_id: jobId,
        name: m.name || '',
        price: toNum(m.price),
        qty: toNum(m.qty) || 1,
        vendor: m.vendor || '',
      }));
      const { error } = await supabase.from('materials').insert(payload);
      if (error) {
        alert('Не удалось сохранить новые материалы');
        console.error(error);
        return;
      }
    }

    for (const m of olds) {
      const { error } = await supabase
        .from('materials')
        .update({
          name: m.name || '',
          price: toNum(m.price),
          qty: toNum(m.qty) || 1,
          vendor: m.vendor || '',
        })
        .eq('id', m.id);
      if (error) {
        alert('Не удалось сохранить материал');
        console.error(error);
        return;
      }
    }

    const { data: fresh } = await supabase
      .from('materials')
      .select('*')
      .eq('job_id', jobId)
      .order('id', { ascending: true });
    setMaterials(fresh || []);
    alert('Материалы сохранены');
  };

  /* ---------- файлы ---------- */
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadBusy(true);

    for (const f of files) {
      const allowed =
        /image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif)/i.test(f.type) ||
        /pdf$/i.test(f.type) ||
        /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|pdf)$/i.test(f.name);

      if (!allowed) {
        alert(`Формат не поддерживается: ${f.name}`);
        continue;
      }

      // ГЕНЕРАЦИЯ БЕЗОПАСНОГО КЛЮЧА ДЛЯ SUPABASE STORAGE
      const key = makeSafeStorageKey(jobId, f.name);

      const { error } = await storage().upload(key, f, {
        cacheControl: '3600',
        upsert: false,
        contentType: f.type || 'application/octet-stream',
      });

      if (error) {
        console.error('upload error:', error, key);
        alert(`Не удалось загрузить файл: ${f.name}`);
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

  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      alert('Ссылка скопирована');
    } catch {
      window.prompt('Скопируйте ссылку:', url);
    }
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

      <div style={GRID2}>
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
                {techs
                  .filter((t) => (t.role || 'tech').toLowerCase() === 'tech')
                  .map((t) => (
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
                  <option key={s} value={s}>{s}</option>
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
                    <option key={p} value={p}>{p}</option>
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
              <input
                style={INPUT}
                value={job.job_number || ''}
                onChange={(e) => setField('job_number', e.target.value)}
              />
            </div>

            {'tech_comment' in (job || {}) && (
              <div style={ROW}>
                <div>Комментарий от техника</div>
                <textarea
                  style={TA}
                  value={job.tech_comment || ''}
                  onChange={(e) => setField('tech_comment', e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button style={PRIMARY} onClick={saveJob} disabled={!dirty}>Сохранить заявку</button>
              <button style={GHOST} onClick={() => navigate(-1)}>Назад</button>
              {!dirty && <div style={{ ...MUTED, alignSelf: 'center' }}>Изменений нет</div>}
            </div>
          </div>
        </div>

        {/* Клиент */}
        <div style={BOX}>
          <div style={H2}>Клиент {client.id ? <span style={MUTED}>(id: {client.id})</span> : null}</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <Row label="ФИО" value={client.full_name} onChange={(v) => setClientField('full_name', v)} />
            <Row label="Телефон" value={client.phone} onChange={(v) => setClientField('phone', v)} />
            <Row label="Email" value={client.email} onChange={(v) => setClientField('email', v)} />
            <Row label="Адрес" value={client.address} onChange={(v) => setClientField('address', v)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={PRIMARY} onClick={saveClient} disabled={!clientDirty}>Сохранить клиента</button>
              {!clientDirty && <div style={{ ...MUTED, alignSelf: 'center' }}>Изменений нет</div>}
            </div>
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
                    <input
                      style={INPUT}
                      type="number"
                      value={m.price ?? 0}
                      onChange={(e) => chMat(i, 'price', toNum(e.target.value))}
                    />
                  </Td>
                  <Td>
                    <input
                      style={INPUT}
                      type="number"
                      value={m.qty ?? 1}
                      onChange={(e) => chMat(i, 'qty', toNum(e.target.value))}
                    />
                  </Td>
                  <Td>
                    <input style={INPUT} value={m.vendor || ''} onChange={(e) => chMat(i, 'vendor', e.target.value)} />
                  </Td>
                  <Td center>
                    <button style={DANGER} onClick={() => delMat(m)}>🗑</button>
                  </Td>
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

      {/* Фото / файлы */}
      <div style={BOX}>
        <div style={H2}>Фото / файлы по заявке</div>
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
              {/\.(pdf)$/i.test(p.name) ? (
                <div style={{ fontSize: 12, marginBottom: 6, wordBreak: 'break-all' }}>📄 {p.name}</div>
              ) : (
                <a href={p.url} target="_blank" rel="noreferrer">
                  <img
                    src={p.url}
                    alt={p.name}
                    style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 6 }}
                  />
                </a>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={BTN} onClick={() => copyUrl(p.url)}>Скопировать URL</button>
                <button style={DANGER} onClick={() => delPhoto(p.name)}>Удалить</button>
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
