import { createClient } from '@supabase/supabase-js';

// 1) Берём из env, а если их нет — подставляем прямые значения:
const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://jywvdftejvnisjvuidtt.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'ВСТАВЬ_СВОЙ_ANON_KEY_ИЗ_Supabase_Settings→API';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
