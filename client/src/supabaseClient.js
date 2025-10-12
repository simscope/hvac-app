// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Универсальное чтение env:
 * - Vite:        import.meta.env.VITE_*
 * - CRA:         process.env.REACT_APP_*
 * - (опц.)       window.__ENV.*
 */

// Vite
let viteEnv;
try {
  // В CRA эта строка валидна синтаксически и просто даст undefined
  viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
} catch (_) {
  viteEnv = undefined;
}

// CRA
const craEnv = (typeof process !== 'undefined' && process.env) ? process.env : undefined;

// window.__ENV (если будете прокидывать конфиг в index.html)
const winEnv = (typeof window !== 'undefined' && window.__ENV) ? window.__ENV : undefined;

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && String(v).trim() !== '');

// === обязательные переменные ===
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

// URL функций (без завершающего /)
export const FUNCTIONS_URL = pick(
  viteEnv?.VITE_SUPABASE_FUNCTIONS_URL,
  craEnv?.REACT_APP_FUNCTIONS_URL,
  winEnv?.FUNCTIONS_URL
);

// Необязательная “общая почта”
export const SHARED_EMAIL = pick(
  viteEnv?.VITE_SHARED_EMAIL,
  craEnv?.REACT_APP_SHARED_EMAIL,
  winEnv?.SHARED_EMAIL
) || '';

const assertEnv = (name, val) => {
  if (!val) {
    throw new Error(
      `[Config] Переменная ${name} не задана. 
Задайте:
  - VITE_SUPABASE_URL или REACT_APP_SUPABASE_URL
  - VITE_SUPABASE_ANON_KEY или REACT_APP_SUPABASE_ANON_KEY
  - VITE_SUPABASE_FUNCTIONS_URL или REACT_APP_FUNCTIONS_URL`
    );
  }
};

assertEnv('SUPABASE_URL', supabaseUrl);
assertEnv('SUPABASE_ANON_KEY', supabaseAnonKey);
assertEnv('FUNCTIONS_URL', FUNCTIONS_URL);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export default supabase;
