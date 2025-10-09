// client/src/pages/EmailTab.jsx
import React, { useMemo, useState } from "react";

/**
 * Открывает общий Gmail-ящик simscope.office@gmail.com для всех.
 * Gmail откроется в новой вкладке; если пользователь не залогинен в этот ящик,
 * Google предложит войти или переключиться.
 */

const AUTH_EMAIL = "simscope.office@gmail.com";

function openGmail(hash = "") {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(AUTH_EMAIL)}`;
  const url = hash ? `${base}#${hash}` : base;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openComposeGmail({ to, subject, body }) {
  const params = new URLSearchParams();
  if (to) params.set("to", to);
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(
    AUTH_EMAIL
  )}&view=cm&fs=1&tf=1&${params.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function EmailTab() {
  const [search, setSearch] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  const subtitle = useMemo(
    () => `Откроется рабочий ящик: ${AUTH_EMAIL}`,
    []
  );

  const openSearch = () => {
    const q = search.trim();
    if (!q) return;
    openGmail(`search/${encodeURIComponent(q)}`);
  };

  return (
    <div className="p-4 grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Email</h1>
        <div className="text-sm text-gray-600 mt-1">{subtitle}</div>
      </div>

      {/* Быстрые ссылки */}
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("inbox")}>
          📥 Inbox
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("sent")}>
          📤 Sent
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("drafts")}>
          📝 Drafts
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("starred")}>
          ⭐ Starred
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("all")}>
          🗂️ All Mail
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("spam")}>
          🚫 Spam
        </button>
        <button className="border rounded-xl p-3 hover:bg-gray-50" onClick={() => openGmail("settings/general")}>
          ⚙️ Настройки
        </button>
      </div>

      {/* Поиск */}
      <div className="border rounded-xl p-4 grid gap-3">
        <div className="font-semibold">Поиск по Gmail</div>
        <div className="text-sm text-gray-600">
          Примеры: <code>from:client@example.com has:attachment</code>,{" "}
          <code>subject:invoice newer_than:7d</code>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2"
            placeholder="Введите запрос Gmail (from:, to:, subject:, has:attachment, label: …)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openSearch()}
          />
          <button className="px-4 py-2 rounded bg-black text-white" onClick={openSearch}>
            Открыть в Gmail
          </button>
        </div>
      </div>

      {/* Быстрый Composer */}
      <div className="border rounded-xl p-4 grid gap-3">
        <div className="font-semibold">Быстрое письмо (в Gmail)</div>
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
            onClick={() => openComposeGmail({ to: composeTo, subject: composeSubject, body: composeBody })}
          >
            Открыть Composer (Gmail)
          </button>
        </div>
        <div className="text-xs text-gray-500">
          Отправка и вложения — в открывшемся окне Gmail под аккаунтом {AUTH_EMAIL}.
        </div>
      </div>
    </div>
  );
}
