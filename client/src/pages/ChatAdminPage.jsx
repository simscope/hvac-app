// client/src/pages/ChatAdminPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { listMessages, subscribeToChat, sendMessage } from '../api/chat';

/**
 * Админ-панель чатов:
 * - список всех чатов с поиском и фильтром «скрытые/все»;
 * - показать/скрыть (soft toggle), удалить навсегда (hard delete);
 * - очистить историю сообщений и вложений;
 * - переименовать чат;
 * - добавить/удалить участников, сделать/снять админа;
 * - создать новый чат (диалог/группа);
 * - экспорт истории в JSON.
 *
 * Требуемые таблицы: chats, chat_members, chat_messages, technicians
 * Bucket: "chat" (вложения по пути chat/<chat_id>/<имя файла>)
 */

// ===== небольшие стили (в твоём стиле, без Tailwind) =====
const page = { padding: 16, display: 'grid', gridTemplateColumns: '420px 1fr', gap: 12 };
const card = { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' };
const block = { ...card, padding: 12 };

const row = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
  background: '#fff',
};

const h1 = { fontSize: 22, fontWeight: 800, margin: '4px 0 10px' };
const h2 = { fontWeight: 700, fontSize: 16, margin: '8px 0' };
const muted = { color: '#6b7280' };
const searchBox = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' };
const select = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px' };

const btn = {
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
};
const primary = { ...btn, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const danger = { ...btn, borderColor: '#ef4444', color: '#ef4444' };
const warning = { ...btn, borderColor: '#f59e0b', color: '#b45309' };

const tag = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid #e5e7eb',
  fontSize: 12,
  background: '#f9fafb',
};

// ===== небольшие утилиты =====
const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

// Папка для вложений в бакете "chat"
const CHAT_BUCKET = 'chat';
const storage = () => supabase.storage.from(CHAT_BUCKET);

export default function ChatAdminPage() {
  // ---- справочные данные
  const [staff, setStaff] = useState([]); // technicians (id,name,is_admin,role,org_id)
  // ---- список чатов
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // ---- детали выбранного чата
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [stats, setStats] = useState({ count: 0, lastAt: null });

  // ---- добавление участников
  const [pickedToAdd, setPickedToAdd] = useState([]);

  // ---- создание нового чата
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorTitle, setCreatorTitle] = useState('');
  const [creatorPicked, setCreatorPicked] = useState([]);
  const [creatorIsGroup, setCreatorIsGroup] = useState(false);

  useEffect(() => {
    (async () => {
      // сотрудники
      const { data } = await supabase
        .from('technicians')
        .select('id,name,is_admin,role,org_id')
        .eq('org_id', 1)
        .order('name', { ascending: true });
      setStaff(data || []);
    })();
  }, []);

  useEffect(() => {
    loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  const loadChats = async () => {
    setLoadingChats(true);

    const { data, error } = await supabase
     .from('chats').select('id,title,is_group,org_id,created_by,created_at,updated_at,deleted')

    if (error) {
      alert('Ошибка загрузки чатов');
      console.error(error);
      setChats([]);
      setLoadingChats(false);
      return;
    }

    const rows = (data || [])
      .filter((c) => (showHidden ? true : !c.deleted))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    setChats(rows);
    if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    setLoadingChats(false);
  };

  // детальная загрузка для выбранного чата: участники + статистика
  useEffect(() => {
    if (!selectedId) {
      setMembers([]);
      setNewTitle('');
      setStats({ count: 0, lastAt: null });
      return;
    }
    (async () => {
      await Promise.all([loadMembers(selectedId), loadStats(selectedId)]);
      const c = chats.find((x) => x.id === selectedId);
      setNewTitle(c?.title || '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const loadMembers = async (chatId) => {
    setMembersLoading(true);
    const { data, error } = await supabase
      .from('chat_members')
      .select('member_id, role, member:technicians(id,name,is_admin,role)')
      .eq('chat_id', chatId)
      .order('member(name)', { ascending: true });
    if (!error) setMembers(data || []);
    setMembersLoading(false);
  };

  const loadStats = async (chatId) => {
    // точное число сообщений
    const { count } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId);
    // последнее сообщение
    const { data: last } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setStats({ count: count ?? 0, lastAt: last?.created_at ?? null });
  };

  // chat search
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return chats;
    return chats.filter((c) => (c.title || '').toLowerCase().includes(s) || String(c.id).includes(s));
  }, [q, chats]);

  const selected = chats.find((c) => c.id === selectedId) || null;

  // --- действия по чату
  const toggleHidden = async (chat, toHidden) => {
    const { error } = await supabase.from('chats').update({ deleted: toHidden }).eq('id', chat.id);
    if (error) return alert('Не удалось изменить видимость чата');
    await loadChats();
  };

  const renameChat = async () => {
    if (!selected) return;
    const title = (newTitle || '').trim();
    const { error } = await supabase.from('chats').update({ title: title || null }).eq('id', selected.id);
    if (error) return alert('Не удалось переименовать');
    await loadChats();
  };

  const hardDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Удалить чат "${selected.title || selected.id}" вместе с сообщениями и файлами?`)) return;
    // сначала удалим все сообщения
    await purgeMessages(selected.id, true);
    // потом сам чат
    const { error } = await supabase.from('chats').delete().eq('id', selected.id);
    if (error) return alert('Не удалось удалить чат');
    setSelectedId(null);
    await loadChats();
  };

  const exportChat = async () => {
    if (!selected) return;
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', selected.id)
      .order('created_at', { ascending: true });
    if (error) return alert('Не удалось выгрузить сообщения');
    const blob = new Blob([JSON.stringify(data || [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat_${selected.id}.json`;
    a.click();
  };

  // --- очистка истории и storage
  const purgeMessages = async (chatId, silent = false) => {
    // 1) удаляем строки из chat_messages
    const { error } = await supabase.from('chat_messages').delete().eq('chat_id', chatId);
    if (error && !silent) return alert('Не удалось удалить сообщения');

    // 2) удаляем объекты из storage/chat/<chatId>/*
    try {
      await deleteAllFromBucket(chatId);
    } catch (e) {
      if (!silent) alert('Файлы из хранилища удалить не удалось (см. консоль)');
      console.error(e);
    }

    if (!silent) {
      await loadStats(chatId);
      alert('История чата очищена');
    }
  };

  // рекурсивная очистка каталога chat/<chatId>/*
  const deleteAllFromBucket = async (chatId, path = '') => {
    // list возвращает файлы и "папки" внутри <chatId>/<path>
    const base = `${chatId}${path ? '/' + path : ''}`;
    const { data, error } = await storage().list(base, { limit: 100 });
    if (error) throw error;
    if (!data || !data.length) return;

    const files = data.filter((o) => o.id || o.name).map((o) => o.name);
    // удаляем файлы
    if (files.length) {
      const toRemove = files.map((name) => `${base}/${name}`);
      await storage().remove(toRemove);
    }
    // рекурсивно пройдёмся по подпапкам (если вдруг используются)
    const folders = data.filter((o) => o.id === null && o.name && o.created_at === null); // supabase помечает папки пустыми полями
    for (const f of folders) {
      await deleteAllFromBucket(chatId, `${path ? path + '/' : ''}${f.name}`);
    }
  };

  // --- участники
  const addMembers = async () => {
    if (!selected || pickedToAdd.length === 0) return;
    const payload = pickedToAdd.map((id) => ({
      chat_id: selected.id,
      member_id: id,
      role: 'member',
      org_id: 1,
    }));
    const { error } = await supabase.from('chat_members').insert(payload);
    if (error) return alert('Не удалось добавить участников');
    setPickedToAdd([]);
    await loadMembers(selected.id);
  };

  const removeMember = async (memberId) => {
    // защита от удаления последнего админа
    const admins = members.filter((m) => m.role === 'admin').map((m) => m.member_id);
    if (admins.includes(memberId) && admins.length <= 1) {
      return alert('Нельзя удалить последнего администратора');
    }
    const { error } = await supabase
      .from('chat_members')
      .delete()
      .eq('chat_id', selected.id)
      .eq('member_id', memberId);
    if (error) return alert('Не удалось удалить участника');
    await loadMembers(selected.id);
  };

  const toggleAdmin = async (memberId, makeAdmin) => {
    const admins = members.filter((m) => m.role === 'admin').map((m) => m.member_id);
    if (!makeAdmin && admins.includes(memberId) && admins.length <= 1) {
      return alert('Нельзя снять роль у единственного администратора');
    }
    const { error } = await supabase
      .from('chat_members')
      .update({ role: makeAdmin ? 'admin' : 'member' })
      .eq('chat_id', selected.id)
      .eq('member_id', memberId);
    if (error) return alert('Не удалось изменить роль');
    await loadMembers(selected.id);
  };

  const candidates = useMemo(() => {
    if (!selected) return [];
    const inChat = new Set(members.map((m) => String(m.member_id)));
    return staff.filter((s) => !inChat.has(String(s.id)));
  }, [members, staff, selected]);

  // --- создание нового чата
  const createChat = async () => {
    const uniq = [...new Set(creatorPicked.map(String))];
    if (uniq.length === 0) return alert('Выберите хотя бы одного участника');

    const isGroup = creatorIsGroup || uniq.length > 1;
    const { data: chat, error } = await supabase
      .from('chats')
      .insert({
        title: isGroup ? (creatorTitle || 'Группа') : (creatorTitle || null),
        is_group: isGroup,
        org_id: 1,
        created_by: null, // при желании сюда можно сохранять id «создателя»
      })
      .select('*')
      .single();

    if (error) return alert('Не удалось создать чат');

    const payload = uniq.map((id) => ({
      chat_id: chat.id,
      member_id: id,
      org_id: 1,
      role: 'member',
    }));

    const { error: mErr } = await supabase.from('chat_members').insert(payload);
    if (mErr) return alert('Чат создан, но не удалось добавить участников');

    setCreatorOpen(false);
    setCreatorIsGroup(false);
    setCreatorTitle('');
    setCreatorPicked([]);
    await loadChats();
    setSelectedId(chat.id);
  };

  return (
    <div style={page}>
      {/* ========= ЛЕВАЯ ПАНЕЛЬ — список чатов ========= */}
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 10 }}>
        <div style={block}>
          <div style={h1}>🛠 Администрирование чатов</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input
              style={searchBox}
              placeholder="Поиск по названию или ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              Показывать скрытые чаты
            </label>
            <button style={primary} onClick={() => setCreatorOpen(true)}>＋ Создать новый чат</button>
          </div>
        </div>

        <div style={block}>
          <div style={h2}>Все чаты</div>
          {loadingChats && <div style={muted}>Загрузка…</div>}
          {!loadingChats && filtered.length === 0 && <div style={muted}>Ничего не найдено</div>}

          <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', paddingRight: 4 }}>
            {filtered.map((c) => (
              <div key={c.id} style={{ ...row, borderColor: selectedId === c.id ? '#c7dcff' : '#e5e7eb' }}>
                <div onClick={() => setSelectedId(c.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600 }}>
                    {c.title || <span style={muted}>Без названия</span>}
                    {c.is_group ? <span style={{ ...tag, marginLeft: 8 }}>группа</span> : <span style={{ ...tag, marginLeft: 8 }}>диалог</span>}
                    {c.deleted ? <span style={{ ...tag, marginLeft: 8, borderColor: '#f59e0b', background: '#fff7ed' }}>скрыт</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    обновлён: {fmt(c.updated_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {c.deleted ? (
                    <button style={btn} onClick={() => toggleHidden(c, false)}>Показать</button>
                  ) : (
                    <button style={warning} onClick={() => toggleHidden(c, true)}>Скрыть</button>
                  )}
                  <button style={danger} onClick={() => { setSelectedId(c.id); hardDelete(); }}>Удалить</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div />
      </div>

      {/* ========= ПРАВАЯ ПАНЕЛЬ — детали чата ========= */}
      <div style={{ display: 'grid', gap: 10 }}>
        {!selected && (
          <div style={block}>
            <div style={muted}>Выберите чат слева</div>
          </div>
        )}

        {selected && (
          <>
            <div style={block}>
              <div style={h2}>Информация о чате</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div><b>ID:</b> {selected.id}</div>
                <div><b>Создан:</b> {fmt(selected.created_at)}</div>
                <div><b>Обновлён:</b> {fmt(selected.updated_at)}</div>
                <div><b>Сообщений:</b> {stats.count} {stats.lastAt ? <span style={muted}> • последнее: {fmt(stats.lastAt)}</span> : null}</div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    style={{ ...searchBox, maxWidth: 420 }}
                    placeholder="Название чата (опционально)"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                  <button style={btn} onClick={renameChat}>Сохранить</button>
                  <button style={warning} onClick={() => purgeMessages(selected.id)}>Очистить историю</button>
                  <button style={btn} onClick={exportChat}>Экспорт JSON</button>
                </div>
              </div>
            </div>

            <div style={block}>
              <div style={h2}>Участники</div>

              {membersLoading && <div style={muted}>Загрузка…</div>}

              {!membersLoading && (
                <>
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                    {members.map((m) => (
                      <div key={m.member_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '6px 4px' }}>
                        <div>
                          <b>{m.member?.name || m.member_id}</b>{' '}
                          {m.role === 'admin' ? <span style={{ ...tag, marginLeft: 6 }}>админ</span> : null}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            style={btn}
                            onClick={() => toggleAdmin(m.member_id, m.role !== 'admin')}
                            title={m.role === 'admin' ? 'Снять админа' : 'Сделать админом'}
                          >
                            {m.role === 'admin' ? 'Снять админа' : 'Сделать админом'}
                          </button>
                          <button style={danger} onClick={() => removeMember(m.member_id)}>Удалить</button>
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && <div style={muted}>Нет участников</div>}
                  </div>

                  <div style={{ fontWeight: 600, marginTop: 10 }}>Добавить участников</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                      {candidates.map((s) => {
                        const checked = pickedToAdd.includes(String(s.id));
                        return (
                          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const id = String(s.id);
                                setPickedToAdd((prev) =>
                                  e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                                );
                              }}
                            />
                            {s.name} {s.role !== 'tech' ? `(${s.role})` : ''}
                          </label>
                        );
                      })}
                      {candidates.length === 0 && <div style={muted}>Все сотрудники уже в чате</div>}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <button style={primary} disabled={pickedToAdd.length === 0} onClick={addMembers}>
                        Добавить выбранных
                      </button>
                      <button style={danger} onClick={hardDelete}>Удалить чат навсегда</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ======= Модалка создания чата ======= */}
      {creatorOpen && (
        <div style={modalWrap} onClick={() => setCreatorOpen(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Создать новый чат</div>

            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={creatorIsGroup}
                  onChange={(e) => setCreatorIsGroup(e.target.checked)}
                />
                Групповой чат
              </label>
              <input
                style={searchBox}
                placeholder="Название чата (для группы — желательно)"
                value={creatorTitle}
                onChange={(e) => setCreatorTitle(e.target.value)}
              />

              <div style={{ fontWeight: 600, marginTop: 4 }}>Участники</div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                {staff.map((s) => {
                  const checked = creatorPicked.includes(String(s.id));
                  return (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const id = String(s.id);
                          setCreatorPicked((prev) =>
                            e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                          );
                        }}
                      />
                      {s.name} {s.role !== 'tech' ? `(${s.role})` : ''}
                    </label>
                  );
                })}
                {staff.length === 0 && <div style={muted}>Нет сотрудников</div>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button style={btn} onClick={() => setCreatorOpen(false)}>Отмена</button>
                <button style={primary} onClick={createChat}>Создать</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== общие стили модалки ===== */
const modalWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'grid', placeItems: 'center', zIndex: 50 };
const modal = { width: 560, maxWidth: '90vw', background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 10px 24px rgba(0,0,0,.15)' };


