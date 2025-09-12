import React, { useState } from "react";
import { supabase } from "../supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleLogin(e) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) setMsg(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    setMsg(null);
    if (!email.trim()) {
      setMsg("Укажите e-mail, чтобы отправить ссылку на сброс пароля.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) setMsg(error.message);
      else setMsg("Если такой адрес существует, письмо со сбросом отправлено.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <style>{`
        .auth-page{
          min-height:100vh; display:flex; align-items:center; justify-content:center;
          background:#f6f8fb; padding:24px;
          font:14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#111;
        }
        .card{
          width:420px; max-width:100%;
          background:#fff; border:1px solid #e5e9f2; border-radius:12px; padding:24px;
          box-shadow:0 8px 30px rgba(16,24,40,.08);
        }
        h1{margin:0 0 8px; font-size:22px}
        .sub{margin:0 0 16px; color:#667085}
        label{display:block; margin:14px 0 6px; font-weight:600}
        .input{
          width:100%; height:40px; padding:0 12px; box-sizing:border-box;
          border:1px solid #cfd6e4; border-radius:8px; background:#fff;
        }
        .input:focus{outline:none; border-color:#9aa8bf; box-shadow:0 0 0 3px rgba(59,130,246,.1)}
        .input-with-button{position:relative}
        .input-with-button .input{padding-right:92px} /* место для кнопки */
        .toggle{
          position:absolute; right:6px; top:50%; transform:translateY(-50%);
          height:28px; padding:0 10px; border:1px solid #cfd6e4; background:#fff;
          border-radius:6px; cursor:pointer; font-size:13px;
        }
        .btn{
          height:44px; border-radius:10px; border:1px solid #cfd6e4; background:#fff; cursor:pointer;
          width:100%;
        }
        .btn-primary{background:#111827; color:#fff; border-color:#111827}
        .btn-primary:disabled{opacity:.7}
        .btn-secondary{background:#eef0f4}
        .muted{color:#8a8f98; margin-top:10px}
        .msg{margin-top:10px; color:#b42318}
      `}</style>

      <form className="card" onSubmit={handleLogin}>
        <h1>Вход в систему</h1>
        <div className="sub">Sim Scope — HVAC & Appliances</div>

        <label>Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
        />

        <label>Пароль</label>
        <div className="input-with-button">
          <input
            className="input"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="toggle"
            onClick={() => setShow((s) => !s)}
          >
            {show ? "Скрыть" : "Показать"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Входим…" : "Войти"}
          </button>
        </div>

        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={loading}
          >
            Сбросить пароль
          </button>
        </div>

        {msg && <div className="msg">{msg}</div>}

        <p className="muted">
          Доступ выдаёт администратор. Если нет аккаунта — обратитесь к менеджеру.
        </p>
      </form>
    </div>
  );
}
