import supabase from './supabaseClient';

/**
 * Регистрация пользователя
 * @param {string} email
 * @param {string} password
 * @param {object} user_metadata - дополнительные данные (например, роль, technician_id)
 */
export async function signUp(email, password, user_metadata = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: user_metadata
    }
  });
  return { data, error };
}

/**
 * Вход пользователя
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  return { data, error };
}

/**
 * Выход пользователя
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return error;
}
