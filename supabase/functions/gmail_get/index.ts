import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
/* ==== CORS ==== */ const ORIGINS = new Set([
  "https://hvac-app-jade.vercel.app",
  "https://www.hvac-app-jade.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000"
]);
const cors = (o)=>({
    "Access-Control-Allow-Origin": o && ORIGINS.has(o) ? o : "https://hvac-app-jade.vercel.app",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-auth",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  });
const json = (req, data, init)=>new Response(JSON.stringify(data), {
    ...init || {},
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors(req.headers.get("Origin")),
      ...init?.headers || {}
    }
  });
/* ============= */ /* ==== crypto helpers (decrypt if encrypted) ==== */ function base64ToUint8(b64) {
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
/* ============================================== */ const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/* base64url -> utf8 */ function decodeB64UrlToUtf8(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4;
  if (pad) b += "=".repeat(4 - pad);
  const bin = atob(b);
  const u8 = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++)u8[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u8);
}
function collectParts(part, acc) {
  if (!part) return;
  const mt = String(part.mimeType || "");
  if (part.body?.data && !part.filename) {
    if (mt === "text/html") acc.html += decodeB64UrlToUtf8(part.body.data);
    if (mt === "text/plain") acc.text += decodeB64UrlToUtf8(part.body.data);
  }
  if ((part.filename || (mt !== "text/plain" && mt !== "text/html")) && part.body?.attachmentId) {
    acc.attachments.push({
      filename: part.filename || "file",
      mimeType: mt || "application/octet-stream",
      size: part.body?.size || 0,
      attachmentId: part.body.attachmentId
    });
  }
  (part.parts || []).forEach((p)=>collectParts(p, acc));
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(req.headers.get("Origin"))
    });
  }
  try {
    if (req.method !== "POST") return json(req, {
      error: "Method Not Allowed"
    }, {
      status: 405
    });
    const { id } = await req.json().catch(()=>({}));
    if (!id) return json(req, {
      ok: false,
      error: "Missing id"
    }, {
      status: 400
    });
    // 1) токены
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const r = await fetch(`${supabaseUrl}/rest/v1/mail_accounts?provider=eq.gmail&select=*&limit=1`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    if (!r.ok) return json(req, {
      ok: false,
      error: await r.text()
    }, {
      status: 500
    });
    const rows = await r.json();
    if (!rows.length) return json(req, {
      ok: false,
      code: "MAIL_ACCOUNT_NOT_FOUND"
    }, {
      status: 404
    });
    const row = rows[0];
    let access = await decryptMaybe(row.access_token_enc);
    const refresh = await decryptMaybe(row.refresh_token_enc);
    const exp = new Date(row.token_expires_at).getTime();
    if (!access || Date.now() > exp) {
      const body = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
        refresh_token: refresh,
        grant_type: "refresh_token"
      });
      const tr = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      });
      if (!tr.ok) return json(req, {
        ok: false,
        step: "refresh",
        status: tr.status,
        error: await tr.text()
      }, {
        status: 502
      });
      const tj = await tr.json();
      access = String(tj.access_token || "");
    }
    // 2) сам месседж
    const rMsg = await fetch(`${GMAIL}/messages/${id}?format=full`, {
      headers: {
        Authorization: `Bearer ${access}`
      }
    });
    if (!rMsg.ok) return json(req, {
      ok: false,
      step: "get_message",
      status: rMsg.status,
      error: await rMsg.text()
    }, {
      status: 502
    });
    const g = await rMsg.json();
    const hs = g.payload?.headers ?? [];
    const headers = {};
    for (const h of hs)headers[h.name] = h.value;
    const acc = {
      html: "",
      text: "",
      attachments: []
    };
    collectParts(g.payload, acc);
    return json(req, {
      ok: true,
      id: g.id,
      threadId: g.threadId,
      subject: headers["Subject"] || "(без темы)",
      from: headers["From"] || "",
      to: headers["To"] || "",
      date: headers["Date"] || "",
      snippet: g.snippet || "",
      html: acc.html,
      text: acc.text,
      attachments: acc.attachments
    });
  } catch (e) {
    return json(req, {
      ok: false,
      error: `gmail_get error: ${String(e)}`
    }, {
      status: 500
    });
  }
});
