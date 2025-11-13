// client/src/pages/TechLibraryPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const wrap = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '16px 20px 32px',
};

const head = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 16,
  flexWrap: 'wrap',
};

const title = {
  fontSize: 22,
  fontWeight: 600,
};

const controlsRow = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const input = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  minWidth: 220,
  height: 36,
  boxSizing: 'border-box',
};

const select = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  height: 36,
  boxSizing: 'border-box',
};

const btn = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background: '#f8fafc',
  cursor: 'pointer',
  height: 36,
  boxSizing: 'border-box',
};

const primaryBtn = {
  ...btn,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
};

const dangerBtn = {
  ...btn,
  borderColor: 'crimson',
  color: 'crimson',
};

const card = {
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  overflow: 'hidden',
};

const tableWrap = {
  width: '100%',
  overflowX: 'auto',
};

const table = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

const th = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
  background: '#f9fafb',
  fontWeight: 500,
};

const td = {
  padding: '8px 10px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
};

const pill = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  background: '#e5f0ff',
  color: '#1d4ed8',
  fontSize: 11,
};

const emptyState = {
  padding: 20,
  textAlign: 'center',
  color: '#64748b',
  fontSize: 14,
};

const cellInput = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid #e5e7eb',
  fontSize: 13,
};

const smallText = {
  fontSize: 11,
  color: '#94a3b8',
};

/**
 * Техбиблиотека:
 * - unit_docs: brand, model, title, category, doc_type, description, file_url
 * - Ручное редактирование и добавление записей
 */
function TechLibraryPage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('brand'); // brand | model | title | category
  const [sortDir, setSortDir] = useState('asc'); // asc | desc
  const [categoryFilter, setCategoryFilter] = useState(''); // '' = all

  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const [newDoc, setNewDoc] = useState(null); // {brand,model,...}
  const [savingId, setSavingId] = useState(null); // id или 'new'

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setErrorMsg('');

      const { data, error } = await supabase
        .from('unit_docs')
        .select('*')
        .order('brand', { ascending: true })
        .order('model', { ascending: true })
        .order('title', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('load unit_docs error', error);
        setErrorMsg(error.message || 'Failed to load documents');
        setDocs([]);
      } else {
        setDocs(data || []);
      }

      setLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Список категорий для фильтра — собираем из того, что уже есть в базе
  const categories = useMemo(() => {
    const set = new Set();
    docs.forEach((d) => {
      if (d.category && String(d.category).trim()) {
        set.add(String(d.category).trim());
      }
    });
    return Array.from(set).sort((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : 1
    );
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    let arr = [...docs];

    if (categoryFilter) {
      arr = arr.filter((d) => (d.category || '') === categoryFilter);
    }

    if (q) {
      arr = arr.filter((d) => {
        const brand = (d.brand || '').toLowerCase();
        const model = (d.model || '').toLowerCase();
        const title = (d.title || '').toLowerCase();
        const desc = (d.description || '').toLowerCase();

        return (
          brand.includes(q) ||
          model.includes(q) ||
          title.includes(q) ||
          desc.includes(q)
        );
      });
    }

    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;

      const aVal =
        sortBy === 'category'
          ? String(a.category || '').toLowerCase()
          : String(a[sortBy] || '').toLowerCase();

      const bVal =
        sortBy === 'category'
          ? String(b.category || '').toLowerCase()
          : String(b[sortBy] || '').toLowerCase();

      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });

    return arr;
  }, [docs, search, sortBy, sortDir, categoryFilter]);

  const handleToggleDir = () => {
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const handleOpen = (url) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const startEdit = (doc) => {
    setEditId(doc.id);
    setEditDraft({
      brand: doc.brand || '',
      model: doc.model || '',
      title: doc.title || '',
      category: doc.category || '',
      doc_type: doc.doc_type || '',
      description: doc.description || '',
      file_url: doc.file_url || '',
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditDraft(null);
    setSavingId(null);
  };

  const changeDraft = (field, value) => {
    setEditDraft((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const saveEdit = async () => {
    if (!editId || !editDraft) return;
    setSavingId(editId);
    const payload = {
      brand: editDraft.brand?.trim() || null,
      model: editDraft.model?.trim() || null,
      title: editDraft.title?.trim() || null,
      category: editDraft.category?.trim() || null,
      doc_type: editDraft.doc_type?.trim() || null,
      description: editDraft.description?.trim() || null,
      file_url: editDraft.file_url?.trim() || null,
    };

    const { data, error } = await supabase
      .from('unit_docs')
      .update(payload)
      .eq('id', editId)
      .select()
      .single();

    if (error) {
      console.error('update unit_doc error', error);
      alert(error.message || 'Failed to save changes');
      setSavingId(null);
      return;
    }

    setDocs((prev) =>
      prev.map((d) => (d.id === editId ? { ...d, ...data } : d))
    );
    cancelEdit();
  };

  const startNew = () => {
    setNewDoc({
      brand: '',
      model: '',
      title: '',
      category: '',
      doc_type: '',
      description: '',
      file_url: '',
    });
  };

  const cancelNew = () => {
    setNewDoc(null);
    if (savingId === 'new') setSavingId(null);
  };

  const changeNew = (field, value) => {
    setNewDoc((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const saveNew = async () => {
    if (!newDoc) return;

    if (!newDoc.brand?.trim() || !newDoc.model?.trim() || !newDoc.title?.trim()) {
      alert('Brand, Model и Title обязательны');
      return;
    }

    setSavingId('new');

    const payload = {
      brand: newDoc.brand.trim(),
      model: newDoc.model.trim(),
      title: newDoc.title.trim(),
      category: newDoc.category?.trim() || null,
      doc_type: newDoc.doc_type?.trim() || null,
      description: newDoc.description?.trim() || null,
      file_url: newDoc.file_url?.trim() || null,
    };

    const { data, error } = await supabase
      .from('unit_docs')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('insert unit_doc error', error);
      alert(error.message || 'Failed to add document');
      setSavingId(null);
      return;
    }

    setDocs((prev) => [...prev, data]);
    cancelNew();
  };

  return (
    <div style={wrap}>
      <div style={head}>
        <div>
          <div style={title}>Technical Library</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Простая база документов: поиск по бренду, модели и названию.
            Можно вручную редактировать и добавлять записи.
          </div>
        </div>

        <div style={controlsRow}>
          <input
            style={input}
            type="text"
            placeholder="Search by brand / model / title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            style={select}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            style={select}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="brand">Sort by brand</option>
            <option value="model">Sort by model</option>
            <option value="title">Sort by title</option>
            <option value="category">Sort by category</option>
          </select>

          <button style={btn} type="button" onClick={handleToggleDir}>
            {sortDir === 'asc' ? '↑ asc' : '↓ desc'}
          </button>

          <button
            style={primaryBtn}
            type="button"
            onClick={startNew}
            disabled={!!newDoc}
          >
            + Add document
          </button>
        </div>
      </div>

      <div style={card}>
        {loading ? (
          <div style={emptyState}>Loading documents...</div>
        ) : errorMsg ? (
          <div style={{ ...emptyState, color: 'crimson' }}>{errorMsg}</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Category</th>
                  <th style={th}>Brand</th>
                  <th style={th}>Model</th>
                  <th style={th}>Title</th>
                  <th style={th}>Type</th>
                  <th style={th}>Description</th>
                  <th style={th}>File URL</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* строка добавления нового документа */}
                {newDoc && (
                  <tr>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.category}
                        onChange={(e) => changeNew('category', e.target.value)}
                        placeholder="Dishwasher / Mini-Split / etc."
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.brand}
                        onChange={(e) => changeNew('brand', e.target.value)}
                        placeholder="Brand"
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.model}
                        onChange={(e) => changeNew('model', e.target.value)}
                        placeholder="Model"
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.title}
                        onChange={(e) => changeNew('title', e.target.value)}
                        placeholder="Service Manual / Wiring / Parts"
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.doc_type}
                        onChange={(e) => changeNew('doc_type', e.target.value)}
                        placeholder="manual / wiring / parts"
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.description}
                        onChange={(e) =>
                          changeNew('description', e.target.value)
                        }
                        placeholder="Short description"
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={newDoc.file_url}
                        onChange={(e) => changeNew('file_url', e.target.value)}
                        placeholder="https://..."
                      />
                      <div style={smallText}>
                        Ссылка на PDF / файл (Supabase storage или внешний URL)
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button
                          style={{
                            ...primaryBtn,
                            height: 30,
                            padding: '4px 8px',
                            fontSize: 13,
                          }}
                          type="button"
                          onClick={saveNew}
                          disabled={savingId === 'new'}
                        >
                          {savingId === 'new' ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          style={{
                            ...dangerBtn,
                            height: 30,
                            padding: '4px 8px',
                            fontSize: 13,
                          }}
                          type="button"
                          onClick={cancelNew}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* существующие документы */}
                {filtered.length === 0 && !newDoc ? (
                  <tr>
                    <td style={td} colSpan={8}>
                      <div style={emptyState}>
                        Ничего не найдено. Добавь первую запись кнопкой{' '}
                        <strong>+ Add document</strong>.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((doc) => {
                    const isEditing = editId === doc.id;
                    const isSaving = savingId === doc.id;

                    if (isEditing && editDraft) {
                      return (
                        <tr key={doc.id}>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.category}
                              onChange={(e) =>
                                changeDraft('category', e.target.value)
                              }
                              placeholder="Dishwasher / Mini-Split / etc."
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.brand}
                              onChange={(e) =>
                                changeDraft('brand', e.target.value)
                              }
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.model}
                              onChange={(e) =>
                                changeDraft('model', e.target.value)
                              }
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.title}
                              onChange={(e) =>
                                changeDraft('title', e.target.value)
                              }
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.doc_type}
                              onChange={(e) =>
                                changeDraft('doc_type', e.target.value)
                              }
                              placeholder="manual / wiring / parts"
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.description}
                              onChange={(e) =>
                                changeDraft('description', e.target.value)
                              }
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={cellInput}
                              value={editDraft.file_url}
                              onChange={(e) =>
                                changeDraft('file_url', e.target.value)
                              }
                            />
                          </td>
                          <td style={td}>
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                              }}
                            >
                              <button
                                style={{
                                  ...primaryBtn,
                                  height: 30,
                                  padding: '4px 8px',
                                  fontSize: 13,
                                }}
                                type="button"
                                onClick={saveEdit}
                                disabled={isSaving}
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                style={{
                                  ...dangerBtn,
                                  height: 30,
                                  padding: '4px 8px',
                                  fontSize: 13,
                                }}
                                type="button"
                                onClick={cancelEdit}
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={doc.id}>
                        <td style={td}>
                          {doc.category ? (
                            <span style={pill}>{doc.category}</span>
                          ) : (
                            <span style={smallText}>—</span>
                          )}
                        </td>
                        <td style={td}>
                          <strong>{doc.brand}</strong>
                        </td>
                        <td style={td}>{doc.model}</td>
                        <td style={td}>{doc.title}</td>
                        <td style={td}>
                          {doc.doc_type ? (
                            <span style={pill}>{doc.doc_type}</span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td style={td}>
                          <div
                            style={{
                              maxWidth: 220,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={doc.description || ''}
                          >
                            {doc.description}
                          </div>
                        </td>
                        <td style={td}>
                          <div
                            style={{
                              maxWidth: 220,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={doc.file_url || ''}
                          >
                            {doc.file_url}
                          </div>
                        </td>
                        <td style={td}>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                          >
                            <button
                              style={{
                                ...primaryBtn,
                                height: 30,
                                padding: '4px 8px',
                                fontSize: 13,
                              }}
                              type="button"
                              onClick={() => handleOpen(doc.file_url)}
                              disabled={!doc.file_url}
                            >
                              Open
                            </button>
                            <button
                              style={{
                                ...btn,
                                height: 30,
                                padding: '4px 8px',
                                fontSize: 13,
                              }}
                              type="button"
                              onClick={() => startEdit(doc)}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default TechLibraryPage;
