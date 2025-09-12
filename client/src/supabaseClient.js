// client/src/supabaseClient.js
// CRA-совместимая инициализация Supabase без import.meta.
// Если переменные окружения не заданы, экспортируем безопасный SHIM,
// чтобы вызовы supabase.* НЕ падали и отдавали понятные ошибки.

import { createClient } from '@supabase/supabase-js';

/** Читаем значение из process.env или window.ENV / window */
function pickEnv(key) {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  if (typeof window !== 'undefined') {
    if (window.ENV && window.ENV[key]) return window.ENV[key];
    if (window[key]) return window[key];
  }
  return undefined;
}

export const SUPABASE_URL =
  pickEnv('REACT_APP_SUPABASE_URL') ||
  pickEnv('SUPABASE_URL') || // если проброшено через window
  '';

export const SUPABASE_ANON_KEY =
  pickEnv('REACT_APP_SUPABASE_ANON_KEY') ||
  pickEnv('SUPABASE_ANON_KEY') || // если проброшено через window
  '';

export const isSupabaseReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Универсальная ошибка, которую будут возвращать заглушки */
const NOT_CONFIGURED_ERR = new Error(
  'Supabase client is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY (Vercel → Project → Settings → Environment Variables) or inject via window.ENV.'
);

/** Строим query-builder заглушку с чейнингом (.select().eq()...) */
function buildQueryShim() {
  const api = {
    select() { return api; },
    insert() { return api; },
    update() { return api; },
    upsert() { return api; },
    delete() { return api; },
    order() { return api; },
    eq() { return api; },
    neq() { return api; },
    in() { return api; },
    ilike() { return api; },
    single() { return Promise.resolve({ data: null, error: NOT_CONFIGURED_ERR }); },
    maybeSingle() { return Promise.resolve({ data: null, error: NOT_CONFIGURED_ERR }); },
    limit() { return api; },
    range() { return api; },
    /** Общий «выполнить» для тех, кто не вызывает .single()/.maybeSingle() */
    then(resolve) {
      // Позволяет await на объекте запроса: const { data, error } = await supabase.from(...).select(...)
      return resolve({ data: null, error: NOT_CONFIGURED_ERR });
    },
    catch() { return Promise.resolve({ data: null, error: NOT_CONFIGURED_ERR }); },
    finally(fn) { if (fn) fn(); return Promise.resolve(); },
  };
  return api;
}

/** Создаём безопасный shim-объект supabase */
function createSupabaseShim() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: NOT_CONFIGURED_ERR }),
      getUser:    async () => ({ data: { user: null },    error: NOT_CONFIGURED_ERR }),
      signInWithPassword: async () => ({ data: null, error: NOT_CONFIGURED_ERR }),
      signOut: async () => ({ error: NOT_CONFIGURED_ERR }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
        error: NOT_CONFIGURED_ERR,
      }),
    },
    from: () => buildQueryShim(),
    storage: { from: () => buildQueryShim() },
    functions: {
      invoke: async () => ({ data: null, error: NOT_CONFIGURED_ERR }),
    },
  };
}

/** Итоговый экспорт: или реальный клиент, или безопасный shim */
export const supabase = isSupabaseReady
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : createSupabaseShim();

/** Один раз подскажем в консоль, если env нет */
if (!isSupabaseReady) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabaseClient] Missing env. Установи REACT_APP_SUPABASE_URL и REACT_APP_SUPABASE_ANON_KEY ' +
    '(Vercel → Project → Settings → Environment Variables) или пробрось их в window.ENV.'
  );
}
