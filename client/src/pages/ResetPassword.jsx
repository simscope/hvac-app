// client/src/pages/ResetPassword.jsx

import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Проверка: Supabase должен автоматически логинить пользователя через URL токен
  useEffect(() => {
    const url = new URL(window.location.href);
    const access_token = url.searchParams.get("access_token");

    if (!access_token) {
      setError("Ссылка недействительна или устарела.");
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const { data, error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
  };

  if (done) {
    return (
      <div style={{ padding: 30 }}>
        <h2>Пароль успешно изменён 🎉</h2>
        <p>Теперь можешь войти под новым паролем.</p>
        <a href="/">Перейти на страницу входа</a>
      </div>
    );
  }

  return (
    <div style={{ padding: 30, maxWidth: 400 }}>
      <h2>Создать новый пароль</h2>

      {error && (
        <div style={{ color: "red", marginBottom: 10 }}>{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <label>Новый пароль</label>
        <input
          type="password"
          style={{
            width: "100%",
            padding: 8,
            marginTop: 5,
            marginBottom: 15,
            borderRadius: 6,
            border: "1px solid #ccc",
          }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          type="submit"
          style={{
            width: "100%",
            padding: 10,
            background: "#2563eb",
            border: "none",
            borderRadius: 6,
            color: "white",
            cursor: "pointer",
          }}
        >
          Сменить пароль
        </button>
      </form>
    </div>
  );
}
