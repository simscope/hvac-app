// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Базовые настройки Supabase
 */
export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;

export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * URL edge-функций (БЕЗ конечного /)
 * пример: https://<project>.supabase.co/functions/v1
 */
export const FUNCTIONS_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  process.env.REACT_APP_FUNCTIONS_URL;

/**
 * Общий ящик, если хотите показывать его в интерфейсе
 * (необязательный экспорт; просто чтобы не было ошибок импорта)
 */
export const SHARED_EMAIL =
  import.meta.env.VITE_SHARED_EMAIL || process.env.REACT_APP_SHARED_EMAIL || '';
