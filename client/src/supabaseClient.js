// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * ВРЕМЕННЫЕ фолбэки, чтобы приложение стартовало даже если REACT_APP_* не подставились на билде.
 * ЗАМЕНИ на свои значения (из Supabase Settings → API) и из своего проекта.
 */
const FALLBACK_SUPABASE_URL = 'https://jywvdftejvnisjvuidtt.supabase.co'; // ← твой проект
const FALLBACK_SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY_HERE'; // ← вставь anon key
const FALLBACK_FUNCTIONS_URL = `${FALLBACK_SUPABASE_URL}/functions/v1`; // обычно так

// Берём из env, а если пусто — из фолбэков
export const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL || FALLBACK_SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const FUNCTIONS_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL || FALLBACK_FUNCTIONS_URL;

// Явная проверка, чтобы не ловить неочевидные ошибки дальше
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !FUNCTIONS_URL) {
  // eslint-disable-next-line no-console
  console.error('[Config] Не заданы ключевые переменные', {
    SUPABASE_URL,
    hasKey: !!SUPABASE_ANON_KEY,
    FUNCTIONS_URL,
  });
  throw new Error(
    '[Config] SUPABASE_URL/SUPABASE_ANON_KEY/FUNCTIONS_URL не заданы.',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export default supabase;
