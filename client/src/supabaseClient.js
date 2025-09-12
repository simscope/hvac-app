// client/src/supabaseClient.js
// Универсальная инициализация Supabase + экспорт URL/KEY для прямых запросов к Edge Functions.
// Работает и с Vite, и с CRA, и с любым бандлером (где переменные могут быть в window / process.env).

import { createClient } from '@supabase/supabase-js';

// Пытаемся вытащить значения из разных источников, не падая.
function pickEnv(key) {
  // Vite (dev/prod)
  if (typeof import !== 'undefined' && import.meta && import.meta.env && key in import.meta.env) {
    return import.meta.env[key];
  }
  // CRA / Node-style
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    return process.env[key];
  }
  // Через window (если проброшено в index.html)
  if (typeof window !== 'undefined') {
    if (window.ENV && key in window.ENV) return window.ENV[key];
    if (key in window) return window[key];
  }
  return undefined;
}

export const SUPABASE_URL =
  pickEnv('VITE_SUPABASE_URL') ||
  pickEnv('REACT_APP_SUPABASE_URL') ||
  pickEnv('SUPABASE_URL') ||
  '';

export const SUPABASE_ANON_KEY =
  pickEnv('VITE_SUPABASE_ANON_KEY') ||
  pickEnv('REACT_APP_SUPABASE_ANON_KEY') ||
  pickEnv('SUPABASE_ANON_KEY') ||
  '';

// Минимальная проверка — чтобы не ловить "undefined".
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Не бросаем исключение, чтобы приложение грузилось, но логируем понятное сообщение.
  // eslint-disable-next-line no-console
  console.error(
    '[supabaseClient] Missing SUPABASE_URL / SUPABASE_ANON_KEY. ' +
    'Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (или пробросьте через window.ENV).'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
