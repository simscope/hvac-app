// client/src/supabaseClient.js
// Инициализация Supabase для CRA/Vercel без import.meta.
// Берём значения из process.env (CRA: REACT_APP_*) или из window/HTML.

import { createClient } from '@supabase/supabase-js';

// Читаем переменную из нескольких мест (без import.meta)
function pickEnv(key) {
  // CRA / Node-style — подставляется на этапе билда
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  // Если проброшено через window (например, в index.html)
  if (typeof window !== 'undefined') {
    if (window.ENV && window.ENV[key]) return window.ENV[key];
    if (window[key]) return window[key];
  }
  return undefined;
}

// CRA: используем REACT_APP_*
// (оставляю и универсальные имена на случай проброса через window или .env на сервере)
export const SUPABASE_URL =
  pickEnv('REACT_APP_SUPABASE_URL') ||
  pickEnv('SUPABASE_URL') ||
  '';

export const SUPABASE_ANON_KEY =
  pickEnv('REACT_APP_SUPABASE_ANON_KEY') ||
  pickEnv('SUPABASE_ANON_KEY') ||
  '';

// Подсказка в консоль, если что-то не задано
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabaseClient] Missing env. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY ' +
    'в настройках окружения (Vercel → Settings → Environment Variables) или пробросьте их в window.ENV.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
