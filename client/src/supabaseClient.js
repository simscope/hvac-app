// client/src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Поддерживаем и CRA, и Vite, и старые импорты.
 * CRA:   REACT_APP_*
 * Vite:  VITE_*
 */

// Базовые переменные (оба префикса)
const URL =
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';

const ANON =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

// URL функций
const FN_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  process.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (URL ? `${URL}/functions/v1` : '');

// Общая почта
const SHARED =
  process.env.REACT_APP_SHARED_EMAIL ||
  process.env.VITE_SHARED_EMAIL ||
  'simscope.office@gmail.com';

// --- Экспорт в новом стиле
export const SUPABASE_URL = URL;
export const SUPABASE_ANON_KEY = ANON;
export const FUNCTIONS_URL = FN_URL;
export const SHARED_EMAIL = SHARED;

// --- Алиасы для обратной совместимости (чтобы не править старые импорты)
export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;

// --- Клиент
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export default supabase;
