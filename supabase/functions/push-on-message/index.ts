// supabase/functions/push-on-message/index.ts
// Отправка push через Expo + инкремент badge всем участникам чата (кроме автора).
// С CORS и fallback на expo_token / expo_push_token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EXPO_ENDPOINT = Deno.env.get("HVAC_LOCAL_PUSH_SINK") ?? "https://exp.host/--/api/v2/push/send";
// Разрешённые источники для браузера (если дергаешь из web-клиента)
const ALLOWED_ORIGINS = [
  "*"
]; // можешь заменить на ["https://hvac-app.jade.vercel.app", "http://localhost:19006"]
function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes("*") || origin && ALLOWED_ORIGINS.includes(origin) ? origin ?? "*" : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json"
  };
}
Deno.serve(async (req)=>{
  const headers = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers
    });
  }
  try {
    const payload = await req.json();
    const chatId = payload?.chatId ?? null;
    const authorProfileId = payload?.authorProfileId ?? null;
    const bodyText = payload?.body && String(payload.body).trim() || (payload?.file_name ? `📎 ${payload.file_name}` : "Сообщение");
    if (!chatId || !authorProfileId) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Bad Request: chatId and authorProfileId are required"
      }), {
        status: 400,
        headers
      });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false
      }
    });
    // Автор → его auth_user_id (чтоб не слать пуш самому себе)
    const { data: authorJoin, error: ajErr } = await admin.from("profiles").select("id, technicians!inner(auth_user_id)").eq("id", authorProfileId).maybeSingle();
    if (ajErr) throw ajErr;
    const authorAuthId = authorJoin?.technicians?.auth_user_id ?? null;
    // Участники чата (auth_user_id)
    const { data: members, error: memErr } = await admin.from("chat_members").select("member_id") // = auth_user_id
    .eq("chat_id", chatId);
    if (memErr) throw memErr;
    // Заголовок
    const { data: chatMeta } = await admin.from("chats").select("title").eq("id", chatId).maybeSingle();
    const chatTitle = (chatMeta?.title || "Новое сообщение").trim();
    // Рассылка
    for (const m of members ?? []){
      const authId = m?.member_id ?? null;
      if (!authId) continue;
      if (authorAuthId && authId === authorAuthId) continue;
      // Профиль получателя по technicians.auth_user_id
      const { data: prof, error: pErr } = await admin.from("profiles").select("id, badge, expo_token, technicians!inner(auth_user_id)").eq("technicians.auth_user_id", authId).maybeSingle();
      if (pErr) continue;
      const token = prof?.expo_token; // поддержим оба названия
      if (!token) continue;
      const nextBadge = (prof?.badge || 0) + 1;
      await admin.from("profiles").update({
        badge: nextBadge
      }).eq("id", prof.id);
      // Отправка через Expo
      await fetch(EXPO_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: token,
          title: chatTitle,
          body: bodyText,
          data: {
            chatId
          },
          sound: "default",
          badge: nextBadge
        })
      });
    }
    return new Response(JSON.stringify({
      ok: true
    }), {
      status: 200,
      headers
    });
  } catch (e) {
    console.error("[push-on-message] error:", e?.message || e);
    return new Response(JSON.stringify({
      ok: false,
      error: "Internal Error"
    }), {
      status: 500,
      headers
    });
  }
});
