// client/src/supabaseClient.js
// CRA-совместимая инициализация Supabase без import.meta.
// Не падает, если переменные не заданы: экспортирует supabase = null и флаг isSupabaseReady.

import { createClient } from '@supabase/supabase-js';

function pickEnv(key) {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  if (typeof window !== 'undefined') {
    if (window.ENV && window.ENV[key]) return window.ENV[key];
    if (window[key]) return window[key];
  }
  return undefined;
}

// Основные источники для CRA
export const SUPABASE_URL =
  pickEnv('REACT_APP_SUPABASE_URL') ||
  pickEnv('SUPABASE_URL') || // на случай проброса через window
  '';

export const SUPABASE_ANON_KEY =
  pickEnv('REACT_APP_SUPABASE_ANON_KEY') ||
  pickEnv('SUPABASE_ANON_KEY') || // на случай проброса через window
  '';

export const isSupabaseReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// НЕ создаём клиент, если нет env — чтобы не падало приложение.
export const supabase = isSupabaseReady ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// В dev/проде выведем подсказку один раз
if (!isSupabaseReady) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabaseClient] Missing env. ' +
    'Установи REACT_APP_SUPABASE_URL и REACT_APP_SUPABASE_ANON_KEY ' +
    '(Vercel → Project → Settings → Environment Variables) ' +
    'или пробрось их как window.ENV в public/index.html.'
  );
}
