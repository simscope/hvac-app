import { createClient } from '@supabase/supabase-js';

/**
 * ВРЕМЕННЫЕ фолбэки на случай, если REACT_APP_* не подставились на билде.
 * Можно оставить — не мешают. В проде лучше настроить ENV на Vercel.
 */
const FALLBACK_SUPABASE_URL = 'https://jywvdftejvnisjvuidtt.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5d3ZkZnRlanZuaXNqdnVpZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MjA5MzksImV4cCI6MjA2NjA5NjkzOX0._iZKkCzHcYUeU-37ZOJxYmvLgCFi0lIbR_xIbfK-EuA';

// читаем из CRA-окружения (process.env.*), иначе берём фолбэки
export const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL || FALLBACK_SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const FUNCTIONS_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  `${SUPABASE_URL}/functions/v1`;

// ---- Совместимость со старым кодом (алиасы)
export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;
export const functionsUrl = FUNCTIONS_URL;

// Клиент
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
export const supabase = client;
export default client;

// Диагностика
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[Config] Не заданы SUPABASE_URL/SUPABASE_ANON_KEY', {
    SUPABASE_URL,
    hasKey: !!SUPABASE_ANON_KEY,
    FUNCTIONS_URL,
  });
}
