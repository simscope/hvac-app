// client/src/components/UploadTechDoc.jsx
import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  boxSizing: 'border-box',
  height: 36,
};

const labelStyle = {
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
};

const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: 10,
  alignItems: 'center',
  marginBottom: 10,
};

const btnBase = {
  padding: '8px 14px',
  borderRadius: 999,
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
};

const primaryBtn = {
  ...btnBase,
  background: '#2563eb',
  color: '#fff',
};

const secondaryBtn = {
  ...btnBase,
  background: '#f3f4f6',
  color: '#111827',
};

const errorStyle = {
  color: '#b91c1c',
  fontSize: 13,
  marginTop: 6,
};

const docTypes = [
  { value: 'manual', label: 'Service manual' },
  { value: 'wiring', label: 'Wiring diagram' },
  { value: 'parts', label: 'Parts list' },
  { value: 'spec', label: 'Spec sheet' },
  { value: 'other', label: 'Other' },
];

function slugify(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'misc';
}

/**
 * Модалка загрузки техдокумента:
 * - выбираем файл
 * - категория / бренд / модель / title / type / описание
 * - upload в bucket "unit-docs"
 * - вставка строки в таблицу "unit_docs"
 *
 * props:
 *   onClose()   — закрыть модалку
 *   onSaved(row) — колбэк после успешного сохранения
 */
export default function UploadTechDoc({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('manual');
  const [description, setDescription] = useState('');

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const onFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f && !title) {
      // если title пустой — заполним из имени файла
      const withoutExt = f.name.replace(/\.[^.]+$/, '');
      setTitle(withoutExt);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');

    if (!file) {
      setErr('Выберите файл.');
      return;
    }
    if (!brand.trim() || !model.trim() || !title.trim()) {
      setErr('Бренд, модель и название документа обязательны.');
      return;
    }

    setLoading(true);
    try {
      const safeBrand = slugify(brand);
      const safeModel = slugify(model);
      const extMatch = file.name.match(/\.([^.]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'pdf';

      const path = `${safeBrand}/${safeModel}/${Date.now()}-${slugify(
        title || file.name
      )}.${ext}`;

      // 1) upload в bucket "unit-docs"
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('unit-docs')
        .upload(path, file);

      if (uploadError) {
        console.error(uploadError);
        throw new Error(uploadError.message || 'Ошибка загрузки файла');
      }

      // 2) Получаем public URL
      const { data: urlData } = supabase.storage
        .from('unit-docs')
        .getPublicUrl(uploadData.path);

      const fileUrl = urlData?.publicUrl;
      if (!fileUrl) {
        throw new Error('Не удалось получить ссылку на файл.');
      }

      // 3) Запись в таблицу unit_docs
      const payload = {
        category: category?.trim() || null,
        brand: brand.trim(),
        model: model.trim(),
        title: title.trim(),
        doc_type: docType || null,
        description: description?.trim() || null,
        file_url: fileUrl,
      };

      const { data: inserted, error: insertError } = await supabase
        .from('unit_docs')
        .insert(payload)
        .select('*')
        .maybeSingle();

      if (insertError) {
        console.error(insertError);
        throw new Error(insertError.message || 'Ошибка сохранения в unit_docs');
      }

      if (onSaved) onSaved(inserted);
      if (onClose) onClose();
    } catch (e2) {
      console.error(e2);
      setErr(e2.message || 'Ошибка при сохранении документа.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="utd-backdrop">
      <div className="utd-modal">
        <div className="utd-header">
          <h2>Добавить документ</h2>
          <button
            type="button"
            className="utd-close"
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Файл */}
          <div style={{ ...rowStyle, marginTop: 10 }}>
            <div style={labelStyle}>Файл (PDF)</div>
            <input
              type="file"
              accept="application/pdf,application/*"
              onChange={onFileChange}
              style={{ ...inputStyle, padding: 6, height: 'auto' }}
            />
          </div>

          {/* Категория */}
          <div style={rowStyle}>
            <div style={labelStyle}>Категория</div>
            <input
              style={inputStyle}
              placeholder="Например: Dishwasher, Washer, Mini-split..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          {/* Бренд */}
          <div style={rowStyle}>
            <div style={labelStyle}>Бренд *</div>
            <input
              style={inputStyle}
              placeholder="Hobart, Samsung, Trane..."
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              required
            />
          </div>

          {/* Модель */}
          <div style={rowStyle}>
            <div style={labelStyle}>Модель *</div>
            <input
              style={inputStyle}
              placeholder="LXe, AJ036TXS4CHAA..."
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
            />
          </div>

          {/* Название документа */}
          <div style={rowStyle}>
            <div style={labelStyle}>Название документа *</div>
            <input
              style={inputStyle}
              placeholder="Service manual, Wiring diagram..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Тип документа */}
          <div style={rowStyle}>
            <div style={labelStyle}>Тип</div>
            <select
              style={inputStyle}
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {docTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Описание */}
          <div style={rowStyle}>
            <div style={labelStyle}>Описание</div>
            <textarea
              style={{ ...inputStyle, minHeight: 60, height: 'auto', resize: 'vertical' }}
              placeholder="Коротко: undercounter dishwasher 208-240V, steam, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {err && <div style={errorStyle}>{err}</div>}

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
            }}
          >
            <button
              type="button"
              style={secondaryBtn}
              onClick={onClose}
              disabled={loading}
            >
              Отмена
            </button>
            <button type="submit" style={primaryBtn} disabled={loading}>
              {loading ? 'Сохраняю...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .utd-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15,23,42,0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .utd-modal {
          background: #ffffff;
          border-radius: 16px;
          padding: 18px 18px 16px;
          width: 520px;
          max-width: 95vw;
          box-shadow: 0 20px 45px rgba(15,23,42,0.45);
          color: #111827;
        }
        .utd-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .utd-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }
        .utd-close {
          border: none;
          background: transparent;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 999px;
        }
        .utd-close:hover {
          background: #f3f4f6;
        }
      `}</style>
    </div>
  );
}
