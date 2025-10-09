// client/src/pages/EmailTab.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * Gmail нельзя встроить в iframe (X-Frame-Options DENY),
 * поэтому эта вкладка — быстрый лаунчер с deep-link’ами.
 *
 * Фишки:
 * - Выбор аккаунта (u/0, u/1, u/2). Сохраняется в localStorage.
 * - Быстрые кнопки: Inbox / Sent / Drafts / Starred / All Mail / Spam.
 * - Быстрый поиск по синтаксису Gmail (from:, has:attachment и т.д.).
 * - Быстрый Compose (mailto или Gmail compose).
 * - Ссылки всегда открываются в новой вкладке.
 */

const LS_KEY = "gmailAccountIndex"; // запоминаем u/N

const accountsPresets = [
  { label: "Профиль по умолчанию (u/0)", index: 0 },
  { label: "Второй профиль (u/1)", index: 1 },
  { label: "Третий профиль (u/2)", index: 2 },
];

function openGmail(path, uIndex) {
  const url = `https://mail.google.com/mail/u/${uIndex}/${path}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openComposeGmail({ to, subject, body }, uIndex) {
  // Gmail web compose
  const params = new URLSearchParams();
  if (to) params.set("to", to);
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  const url = `https://mail.google.com/mail/u/${uIndex}/?view=cm&fs=1&tf=1&${params.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function EmailTab() {
  const [uIndex, setUIndex] = useState(() => {
    const saved = Number(localStorage.getItem(LS_KEY));
    return Number.isFinite(saved) ? saved : 0;
  });

  const [search, setSearch] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(uIndex));
  }, [uIndex]);

  const accountLabel = useMemo(
    () => accountsPresets.find(a => a.index === uIndex)?.label ?? `u/${uIndex}`,
    [uIndex]
  );

  const openSearch = () => {
    const q = encodeURIComponent(search.trim());
    if (!q) return;
    openGmail(`#search/${q}`, uIndex);
  };

  return (
    <div className="p-4 grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Email</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Аккаунт:</label>
          <select
            className="border rounded px-2 py-1"
            value={uIndex}
            onChange={(e) => setUIndex(Number(e.target.value))}
          >
            {accountsPresets.map((a) => (
              <option key={a.index} value={a.index}>{a.label}</option>
            ))}
            {/* При желании можно вручную поставить любой индекс */}
            <option value={3}>Четвёртый профиль (u/3)</option>
            <option value={4}>Пятый профиль (u/4)</option>
          </select>
        </div>
      </div>

      {/* Быстрые ссылки */}
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        <button className="border rounded-xl p-3 hover:bg-gray-50"
                onClick={() => openGmail("#inbox", uIndex)}>
          📥 Inbox ({accountLabel})
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50"
                onClick={() => openGmail("#sent", uIndex)}>
          📤 Sent
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50"
                onClick={() => openGmail("#drafts", uIndex)}>
          📝 Drafts
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50"
                onClick={() => openGmail("#starred", uIndex)}>
          ⭐ Starred
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50"
                onClick={() => openGmail("#all", uIndex)}>
          🗂️ All Mail
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50"
                onClick={() => openGmail("#spam", uIndex)}>
          🚫 Spam
        </button>
      </div>

      {/* Поиск */}
      <div className="border rounded-xl p-4 grid gap-3">
        <div className="font-semibold">Поиск по Gmail</div>
        <div className="text-sm text-gray-600">
          Примеры: <code>from:anastasia.lab... has:attachment</code>,{" "}
          <code>subject:инвойс newer_than:7d</code>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2"
            placeholder="Введите запрос Gmail (from:, to:, subject:, has:attachment, label: и т.д.)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openSearch()}
          />
          <button className="px-4 py-2 rounded bg-black text-white"
                  onClick={openSearch}>
            Открыть в Gmail
          </button>
        </div>
      </div>

      {/* Быстрый Compose */}
      <div className="border rounded-xl p-4 grid gap-3">
        <div className="font-semibold">Быстрое письмо</div>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            className="border rounded px-3 py-2"
            placeholder="Кому (email)"
            value={composeTo}
            onChange={(e) => setComposeTo(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 md:col-span-2"
            placeholder="Тема"
            value={composeSubject}
            onChange={(e) => setComposeSubject(e.target.value)}
          />
        </div>
        <textarea
          className="border rounded px-3 py-2 min-h-[120px]"
          placeholder="Текст письма"
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded bg-black text-white"
            onClick={() =>
              openComposeGmail(
                { to: composeTo, subject: composeSubject, body: composeBody },
                uIndex
              )
            }
          >
            Открыть Composer в Gmail
          </button>
          <a
            className="px-4 py-2 rounded border hover:bg-gray-50"
            href={`mailto:${encodeURIComponent(composeTo)}?subject=${encodeURIComponent(
              composeSubject
            )}&body=${encodeURIComponent(composeBody)}`}
          >
            Через mailto
          </a>
        </div>
        <div className="text-xs text-gray-500">
          Вложения и шаблоны доступны в полном Gmail-окне после клика.
        </div>
      </div>

      {/* Полное окно Gmail */}
      <div className="border rounded-xl p-4 grid gap-2">
        <div className="font-semibold">Полное окно Gmail</div>
        <div className="text-sm text-gray-600">
          Нажми, чтобы открыть Gmail в новой вкладке под выбранным профилем ({accountLabel}).
        </div>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded border hover:bg-gray-50"
            onClick={() => openGmail("", uIndex)}
          >
            Открыть Gmail
          </button>
          <button
            className="px-4 py-2 rounded border hover:bg-gray-50"
            onClick={() => openGmail("#settings/general", uIndex)}
          >
            Настройки
          </button>
        </div>
      </div>
    </div>
  );
}
