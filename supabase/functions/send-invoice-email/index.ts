// supabase/functions/send-invoice-email/index.ts
// Скачивает PDF инвойса из Storage и отправляет письмо через вашу Edge-функцию gmail_send.
//
// ENV:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ALLOWED_ORIGIN  (например, https://hvac-app-jade.vercel.app)
//
// Деплой: supabase functions deploy send-invoice-email
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
/* ---------------- CORS ---------------- */ const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type"
};
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS))h.set(k, v);
  return new Response(res.body, {
    status: res.status,
    headers: h
  });
}
/* ---------------- helpers ---------------- */ // base64 по байтам (без переполнения стека)
function bytesToBase64(bytes) {
  let out = "";
  const CHUNK = 0x8000;
  for(let i = 0; i < bytes.length; i += CHUNK){
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
// Приводим тему к безопасному ASCII, чтобы gmail_send не ломала кодировку
function sanitizeSubject(input) {
  let s = (input || "").replace(/[\r\n]+/g, " ").trim();
  // заменяем частые юникод-символы на ASCII
  const replacements = {
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2015": "-",
    "\u2212": "-",
    "\u00A0": " ",
    "\u2018": "'",
    "\u2019": "'",
    "\u201A": "'",
    "\u2032": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u201E": '"'
  };
  s = s.replace(/[\u2010-\u2015\u2212\u00A0\u2018\u2019\u201A\u2032\u201C\u201D\u201E]/g, (ch)=>replacements[ch] ?? "");
  // убираем диакритику (NFKD) и оставляем ASCII 0x20..0x7E
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^\x20-\x7E]/g, "");
  // сжимаем пробелы и обрезаем длину (заодно защита от длиннющих тем)
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 200) s = s.slice(0, 200);
  return s || "Invoice";
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
  if (req.method !== "POST") return withCors(new Response("Method Not Allowed", {
    status: 405
  }));
  try {
    const incomingAuth = req.headers.get("authorization") || "";
    const body = await req.json().catch(()=>({}));
    // ожидаем: { to, subject, text?, bucket:"invoices", key:"<jobId>/<filename>.pdf" }
    const { to, subject, text, bucket, key } = body || {};
    if (!to || !bucket || !key) {
      return withCors(new Response(JSON.stringify({
        error: "Missing required fields: to, bucket, key"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      }));
    }
    // Supabase client и загрузка PDF
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return withCors(new Response(JSON.stringify({
        error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }));
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: {
        persistSession: false
      }
    });
    const dl = await sb.storage.from(String(bucket)).download(String(key));
    if (dl.error) {
      return withCors(new Response(JSON.stringify({
        error: "Storage download failed",
        details: dl.error.message
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      }));
    }
    const pdfBytes = new Uint8Array(await dl.data.arrayBuffer());
    const pdfBase64 = bytesToBase64(pdfBytes);
    const filename = key.split("/").pop() || "invoice.pdf";
    // Точный URL вашей gmail_send
    // Local URL uses the configured gateway, without Cloud-hostname rewriting.
    const gmailSendUrl = new URL("functions/v1/gmail_send", SUPABASE_URL.replace(/\/?$/, "/")).toString();
    // Готовим безопасную тему
    const safeSubject = sanitizeSubject(subject || "Invoice - Sim Scope Inc.");
    // Тело под контракт gmail_send
    const gmailPayload = {
      to: [
        String(to)
      ],
      subject: safeSubject,
      text: (text || `Hello,

Please find your invoice attached.

Best regards,
Sim Scope Inc.`).replace(/[\r\n]{3,}/g, "\n\n"),
      attachments: [
        {
          filename,
          mimeType: "application/pdf",
          base64: pdfBase64
        }
      ]
    };
    const headers = {
      "Content-Type": "application/json"
    };
    if (incomingAuth) headers["authorization"] = incomingAuth; // gmail_send требует авторизацию
    const res = await fetch(gmailSendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(gmailPayload)
    });
    if (!res.ok) {
      return withCors(new Response(JSON.stringify({
        error: "gmail_send failed",
        details: {
          status: res.status,
          body: await res.text().catch(()=>"")
        }
      }), {
        status: 502,
        headers: {
          "Content-Type": "application/json"
        }
      }));
    }
    return withCors(new Response(JSON.stringify({
      ok: true
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  } catch (e) {
    return withCors(new Response(JSON.stringify({
      error: e?.message || "Unhandled error"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
});
