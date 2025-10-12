// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Поддерживаем и CRA (REACT_APP_*), и Vite (VITE_*), чтобы ничего не падало
const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL || import.meta?.env?.VITE_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  import.meta?.env?.VITE_SUPABASE_ANON_KEY;

// Базовый URL для Edge Functions:
// 1) Явно из env, если задан
// 2) Иначе строим от SUPABASE_URL
const FUNCTIONS_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  import.meta?.env?.VITE_SUPABASE_FUNCTIONS_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : undefined);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Не падаем, но подскажем в консоли
  console.warn(
    '[supabaseClient] Missing env: SUPABASE_URL or SUPABASE_ANON_KEY'
  );
}
if (!FUNCTIONS_URL) {
  console.warn(
    '[supabaseClient] Missing FUNCTIONS_URL (set REACT_APP_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_FUNCTIONS_URL)'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Именованные экспорты — именно так импортируйте в EmailTab.jsx
export {
  SUPABASE_URL as supabaseUrl,
  SUPABASE_ANON_KEY as supabaseAnonKey,
  FUNCTIONS_URL,
};

export default supabase;
