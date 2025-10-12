// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Безопасно читаем окружение:
 * - Vite:        import.meta.env.VITE_*
 * - CRA:         process.env.REACT_APP_*
 * - fallback:    window.__ENV (опционально)
 */
const viteEnv = (typeof import !== 'undefined' && import.meta && import.meta.env)
  ? import.meta.env
  : undefined;

const craEnv = (typeof process !== 'undefined' && process.env)
  ? process.env
  : undefined;

const winEnv = (typeof window !== 'undefined' && window.__ENV)
  ? window.__ENV
  : undefined;

function pick(...candidates) {
  for (const v of candidates) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

// === обязательные ===
export const supabaseUrl = pick(
  viteEnv?.VITE_SUPABASE_URL,
  craEnv?.REACT_APP_SUPABASE_URL,
  winEnv?.SUPABASE_URL
);

export const supabaseAnonKey = pick(
  viteEnv?.VITE_SUPABASE_ANON_KEY,
  craEnv?.REACT_APP_SUPABASE_ANON_KEY,
  winEnv?.SUPABASE_ANON_KEY
);

// === функции (без завершающего /) ===
export const FUNCTIONS_URL = pick(
  viteEnv?.VITE_SUPABASE_FUNCTIONS_URL,
  craEnv?.REACT_APP_FUNCTIONS_URL,
  winEnv?.FUNCTIONS_URL
);

// === необязательный общий адрес почты ===
export const SHARED_EMAIL = pick(
  viteEnv?.VITE_SHARED_EMAIL,
  craEnv?.REACT_APP_SHARED_EMAIL,
  winEnv?.SHARED_EMAIL
) || '';

/**
 * Валидация окружения с понятными сообщениями
 */
function assertEnv(name, value) {
  if (!value) {
    // кидаем понятную ошибку — чтобы было видно в UI/логах
    throw new Error(
      `[Config] Переменная ${name} не задана. 
Добавьте её в переменные окружения деплоя.
Для CRA используйте REACT_APP_*, для Vite — VITE_*.
Требуются:
  - VITE_SUPABASE_URL / REACT_APP_SUPABASE_URL
  - VITE_SUPABASE_ANON_KEY / REACT_APP_SUPABASE_ANON_KEY
  - VITE_SUPABASE_FUNCTIONS_URL / REACT_APP_FUNCTIONS_URL`
    );
  }
}

assertEnv('SUPABASE_URL', supabaseUrl);
assertEnv('SUPABASE_ANON_KEY', supabaseAnonKey);
assertEnv('FUNCTIONS_URL', FUNCTIONS_URL);

// Инициализация клиента
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export default supabase;
