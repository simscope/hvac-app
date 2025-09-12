import supabase from './supabaseClient';

// Регистрация пользователя
export async function signUp(email, password, user_metadata = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: user_metadata // можно передавать роль и technician_id сюда
    }
  });
  return { data, error };
}

// Вход пользователя
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  return { data, error };
}

// Выход пользователя
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return error;
}
