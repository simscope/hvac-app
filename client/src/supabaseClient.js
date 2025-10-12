// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * ВРЕМЕННЫЕ фолбэки на случай, если REACT_APP_* не подставились на билде.
 * Поставь сюда свои значения из Supabase (Settings → API).
 * Эти фолбэки можно убрать, когда Vercel-ENV начнут корректно подставляться.
 */
const FALLBACK_SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';        // ← ЗАМЕНИ
const FALLBACK_SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                       // ← ЗАМЕНИ

// читаем из CRA-окружения (process.env.*), иначе берём фолбэки
export const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL || FALLBACK_SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const FUNCTIONS_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  `${SUPABASE_URL}/functions/v1`;

// ---- Совместимость со старым кодом (алиасы тех же значений)
export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;
export const functionsUrl = FUNCTIONS_URL;

// Создаём клиент один раз и экспортируем и как named, и как default
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabase = client;
export default client;

// Дополнительная проверка конфигурации (поможет в рантайме)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[Config] Не заданы SUPABASE_URL/SUPABASE_ANON_KEY', {
    SUPABASE_URL,
    hasKey: !!SUPABASE_ANON_KEY,
    FUNCTIONS_URL,
  });
}
