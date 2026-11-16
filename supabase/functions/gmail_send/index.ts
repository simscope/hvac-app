import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
/* ================== CORS ================== */ const ORIGINS = new Set([
  "http://127.0.0.1:18280",
  "https://hvac-app-jade.vercel.app",
  "https://www.hvac-app-jade.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000"
]);
const cors = (o)=>({
    "Access-Control-Allow-Origin": o && ORIGINS.has(o) ? o : "https://hvac-app-jade.vercel.app",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-auth",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  });
const json = (req, data, init)=>new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors(req.headers.get("Origin")),
      ...init?.headers
    }
  });
/* ========== Crypto helpers (AES-GCM + plain:) ========== */ function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++)out[i] = bin.charCodeAt(i);
  return out;
}
async function getAesKey() {
  const b64 = Deno.env.get("MAIL_ENC_KEY_B64");
  if (!b64) return null;
  const raw = base64ToUint8(b64);
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "decrypt",
    "encrypt"
  ]);
}
async function decryptMaybe(stored) {
  if (stored.startsWith("plain:")) return stored.slice(6);
  const key = await getAesKey();
  if (!key) throw new Error("MAIL_ENC_KEY_B64 missing (needed to decrypt)");
  const buf = base64ToUint8(stored);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv
  }, key, ct);
  return new TextDecoder().decode(pt);
}
/* ================== Gmail API ================== */ const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
/* ================== utils ================== */ function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes)bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function foldHeader(name, value) {
  // легкая защита от CRLF
  const safe = value.replace(/[\r\n]+/g, " ").trim();
  return `${name}: ${safe}\r\n`;
}
/** RFC 2047: кодируем тему письма в UTF-8 Base64 */ function encodeSubject(subject) {
  const enc = new TextEncoder().encode(subject);
  let bin = "";
  for (const b of enc)bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return `=?UTF-8?B?${b64}?=`;
}
/** Собираем MIME; attachments = [{ filename, mimeType, base64 }] */ function buildMime(from, to, subject, text, attachments) {
  const encoder = new TextEncoder();
  if (!attachments?.length) {
    const headers = foldHeader("From", from) + foldHeader("To", to.join(", ")) + foldHeader("Subject", encodeSubject(subject || "")) + "MIME-Version: 1.0\r\n" + "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
    return encoder.encode(headers + (text || ""));
  }
  const boundary = "mix_" + crypto.randomUUID().replace(/-/g, "");
  let head = foldHeader("From", from) + foldHeader("To", to.join(", ")) + foldHeader("Subject", encodeSubject(subject || "")) + "MIME-Version: 1.0\r\n" + `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  // текстовая часть
  head += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text || ""}\r\n`;
  // вложения
  for (const att of attachments){
    const name = att.filename || "file";
    const mime = att.mimeType || "application/octet-stream";
    const b64 = String(att.base64 || "").replace(/\r?\n/g, "");
    head += `--${boundary}\r\n`;
    head += `Content-Type: ${mime}; name="${name}"\r\n`;
    head += "Content-Transfer-Encoding: base64\r\n";
    head += `Content-Disposition: attachment; filename="${name}"\r\n\r\n`;
    for(let i = 0; i < b64.length; i += 76)head += b64.slice(i, i + 76) + "\r\n";
  }
  head += `--${boundary}--\r\n`;
  return encoder.encode(head);
}
/* ================== MAIN ================== */ serve(async (req)=>{
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(origin)
    });
  }
  try {
    if (req.method !== "POST") return json(req, {
      error: "Method Not Allowed"
    }, {
      status: 405
    });
    const rawBody = await req.text();
    const body = JSON.parse(rawBody || '{}');
    const to = Array.isArray(body.to) ? body.to : [];
    const subject = body.subject ?? "";
    const text = body.text ?? "";
    const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!to.length) return json(req, {
      ok: false,
      error: "NO_RECIPIENTS"
    }, {
      status: 400
    });
    // === 1) Достаём Gmail-аккаунт ===
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const mailRes = await fetch(`${supabaseUrl}/rest/v1/mail_accounts?provider=eq.gmail&select=*&limit=1`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    if (!mailRes.ok) return json(req, {
      ok: false,
      error: await mailRes.text()
    }, {
      status: 500
    });
    const rows = await mailRes.json();
    if (!rows.length) return json(req, {
      ok: false,
      code: "MAIL_ACCOUNT_NOT_FOUND"
    }, {
      status: 404
    });
    const row = rows[0];
    let fromEmail = row.email || "me";
    // === 2) Access token (refresh при необходимости) ===
    let access = await decryptMaybe(row.access_token_enc);
    const refresh = await decryptMaybe(row.refresh_token_enc);
    const expMs = new Date(row.token_expires_at).getTime();
    if (!access || Date.now() > expMs) {
      const tokenR = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
          client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
          refresh_token: refresh,
          grant_type: "refresh_token"
        })
      });
      if (!tokenR.ok) return json(req, {
        ok: false,
        step: "refresh",
        status: tokenR.status,
        error: await tokenR.text()
      }, {
        status: 502
      });
      const tj = await tokenR.json();
      access = String(tj.access_token || "");
      const newExp = new Date(Date.now() + (Number(tj.expires_in ?? 3600) - 60) * 1000).toISOString();
      try {
        const key = await getAesKey();
        let enc;
        if (key) {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = await crypto.subtle.encrypt({
            name: "AES-GCM",
            iv
          }, key, new TextEncoder().encode(access));
          const combo = new Uint8Array(iv.length + ct.byteLength);
          combo.set(iv, 0);
          combo.set(new Uint8Array(ct), iv.length);
          let s = "";
          for (const b of combo)s += String.fromCharCode(b);
          enc = btoa(s);
        } else enc = `plain:${access}`;
        await fetch(`${supabaseUrl}/rest/v1/mail_accounts?id=eq.${row.id}`, {
          method: "PATCH",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            access_token_enc: enc,
            token_expires_at: newExp,
            updated_at: new Date().toISOString()
          })
        });
      } catch  {}
    }
    const senderResponse=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${access}`}});
    if (!senderResponse.ok) return json(req,{ok:false,step:'sender_profile',error:'AUTHENTICATED_SENDER_UNAVAILABLE'},{status:502});
    const senderProfile=await senderResponse.json();
    if (typeof senderProfile.emailAddress!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderProfile.emailAddress)) return json(req,{ok:false,error:'AUTHENTICATED_SENDER_INVALID'},{status:502});
    fromEmail=senderProfile.emailAddress;
    // === 3) Нормализуем вложения: base64 либо скачать из Storage ===
    const storageBase = `${supabaseUrl}/storage/v1/object`;
    const attachments = [];
    for (const a of rawAttachments){
      if (a?.base64) {
        attachments.push({
          filename: a.filename || "file",
          mimeType: a.mimeType || "application/pdf",
          base64: String(a.base64)
        });
        continue;
      }
      const bucket = a?.bucket?.trim();
      const key = a?.key?.trim();
      if (!bucket || !key) {
        return json(req, {
          ok: false,
          error: "ATTACHMENT_MISSING_DATA"
        }, {
          status: 400
        });
      }
      const url = `${storageBase}/${encodeURIComponent(bucket)}/${key}`;
      const fileRes = await fetch(url, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      });
      if (!fileRes.ok) {
        return json(req, {
          ok: false,
          step: "storage",
          status: fileRes.status,
          error: await fileRes.text()
        }, {
          status: 502
        });
      }
      const buf = new Uint8Array(await fileRes.arrayBuffer());
      // -> base64
      let bin = "";
      for(let i = 0; i < buf.length; i++)bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      const mime = a.mimeType || fileRes.headers.get("content-type") || "application/pdf";
      const fname = a.filename || key.split("/").pop() || "file.pdf";
      attachments.push({
        filename: fname,
        mimeType: String(mime),
        base64: b64
      });
    }
    // === 4) Сборка и отправка письма ===
    const mimeBytes = buildMime(fromEmail, to, subject, text, attachments);
    const raw = toBase64Url(mimeBytes);
    const sendRes = await fetch(GMAIL_SEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        raw
      })
    });
    if (!sendRes.ok) {
      return json(req, {
        ok: false,
        step: "send",
        status: sendRes.status,
        error: await sendRes.text()
      }, {
        status: 502
      });
    }
    const resp = await sendRes.json();

    return json(req, {
      ok: true,
      id: resp.id,
      threadId: resp.threadId
    }, {
      status: 200
    });
  } catch (e) {
    return json(req, {
      ok: false,
      error: String(e)
    }, {
      status: 500
    });
  }
});
