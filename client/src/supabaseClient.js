// client/src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Для CRA (react-scripts) переменные должны начинаться с REACT_APP_
 * Для Vite — с VITE_
 * Если у вас CRA, используйте REACT_APP_ (как ниже).
 */

export const SUPABASE_URL       = process.env.REACT_APP_SUPABASE_URL;
export const SUPABASE_ANON_KEY  = process.env.REACT_APP_SUPABASE_ANON_KEY;

// URL до edge-функций Supabase
export const FUNCTIONS_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '');

// Общая почта (можно переопределить из .env)
export const SHARED_EMAIL =
  process.env.REACT_APP_SHARED_EMAIL || 'simscope.office@gmail.com';

// Инициализация клиента
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
