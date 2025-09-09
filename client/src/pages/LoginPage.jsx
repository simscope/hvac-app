import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  async function send(e) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'https://hvac-app-jade.vercel.app' } // твой домен
    });
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <form onSubmit={send} style={{maxWidth:360, margin:'80px auto'}}>
      <h2>Вход</h2>
      <input type="email" required placeholder="email"
             value={email} onChange={e=>setEmail(e.target.value)}
             style={{width:'100%',padding:8,margin:'8px 0'}}/>
      <button type="submit">Отправить ссылку</button>
      {sent && <div style={{color:'green', marginTop:8}}>Ссылка отправлена на почту</div>}
      {err && <div style={{color:'crimson', marginTop:8}}>{err}</div>}
    </form>
  );
}
