// supabase/functions/on-new-message/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY"); // может пригодиться для других вызовов
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Общие заголовки для PostgREST с сервисным ключом (обходит RLS)
const REST_HDRS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation"
};
async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...REST_HDRS,
      ...init.headers || {}
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${path} ${res.status} ${t}`);
  }
  // для DELETE с Prefer:return=minimal тело пустое
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}
// Утилита: in.(...) c кавычками и экранированием
const inList = (values)=>`in.(${values.map((v)=>`"${v}"`).join(",")})`;
const ok = (obj)=>new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json"
    }
  });
const err = (e, code = 500)=>new Response(JSON.stringify({
    ok: false,
    error: String(e)
  }), {
    status: code,
    headers: {
      "content-type": "application/json"
    }
  });
// Разбивка массива на чанки
function chunk(arr, size) {
  const out = [];
  for(let i = 0; i < arr.length; i += size)out.push(arr.slice(i, i + size));
  return out;
}
serve(async ()=>{
  try {
    // 1) взять одну задачу из очереди
    const tasks = await rest("push_queue?select=*&order=created_at.asc&limit=1", {
      method: "GET"
    }) || [];
    if (tasks.length === 0) {
      return ok({
        ok: true,
        msg: "no tasks"
      });
    }
    const task = tasks[0];
    // 2) получить сообщение
    const msgs = await rest(`chat_messages?id=eq.${encodeURIComponent(task.message_id)}&select=id,chat_id,author_id,body,file_url,file_name,file_type,created_at`, {
      method: "GET"
    });
    const msg = msgs?.[0];
    if (!msg) {
      await rest(`push_queue?id=eq.${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        headers: {
          Prefer: "return=minimal"
        }
      });
      return ok({
        ok: true,
        msg: "no message"
      });
    }
    // 3) получатели (кроме автора)
    const recs = await rest(`v_message_recipients?message_id=eq.${encodeURIComponent(task.message_id)}&select=recipient_id`, {
      method: "GET"
    });
    const recipientIds = (recs || []).map((r)=>r.recipient_id).filter(Boolean);
    // удаляем автора, если он вдруг попал в представление
    const recipients = Array.from(new Set(recipientIds)).filter((id)=>id !== msg.author_id);
    if (recipients.length === 0) {
      await rest(`push_queue?id=eq.${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        headers: {
          Prefer: "return=minimal"
        }
      });
      return ok({
        ok: true,
        msg: "no recipients"
      });
    }
    // 4) токены
    const tokens = await rest(`user_push_tokens?select=expo_token,user_id&user_id=${encodeURIComponent(inList(recipients))}`, {
      method: "GET"
    });
    const expoTokens = Array.from(new Set((tokens || []).map((t)=>t.expo_token).filter(Boolean)));
    if (expoTokens.length === 0) {
      await rest(`push_queue?id=eq.${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        headers: {
          Prefer: "return=minimal"
        }
      });
      return ok({
        ok: true,
        msg: "no tokens"
      });
    }
    // 5) отправка через Expo push (чанками <= 99)
    const title = "Новое сообщение";
    const bodyText = String(msg.body || msg.file_name || "Вложение").slice(0, 140);
    const payloadBase = (to)=>({
        to,
        sound: "default",
        title,
        body: bodyText,
        data: {
          kind: "chat",
          chat_id: msg.chat_id,
          message_id: msg.id
        },
        priority: "high"
      });
    const chunks = chunk(expoTokens, 99);
    for (const group of chunks){
      const payload = group.map(payloadBase);
      const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      // можно залогировать ответ при необходимости:
      // const txt = await expoRes.text(); console.log(txt);
      await expoRes.text();
    }
    // 6) удаляем задачу
    await rest(`push_queue?id=eq.${encodeURIComponent(task.id)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal"
      }
    });
    return ok({
      ok: true,
      pushed: expoTokens.length,
      chunks: chunks.length
    });
  } catch (e) {
    return err(e, 500);
  }
});
