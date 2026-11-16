// supabase/functions/gmail_attachment/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Gmail отдаёт base64url ( - и _ ) и иногда без padding '='
// Приводим к обычному base64, чтобы браузер мог декодировать
function normalizeGmailBase64UrlToBase64(s: string) {
  let out = (s || "").replace(/-/g, "+").replace(/_/g, "/");
  // padding
  while (out.length % 4 !== 0) out += "=";
  return out;
}

function stripPlainPrefix(v: unknown): string {
  const s = String(v ?? "");
  return s.replace(/^plain:/, "");
}

function parseTimestamptzToMs(v: unknown): number | null {
  if (!v) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in function env");
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const txt = await r.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch { /* ignore */ }

  if (!r.ok) {
    throw new Error(`Google refresh failed: ${r.status} ${txt}`);
  }

  const access_token = data?.access_token;
  const expires_in = data?.expires_in; // seconds
  if (!access_token) throw new Error("Google refresh: missing access_token");

  const expiresAtMs =
    typeof expires_in === "number" && Number.isFinite(expires_in)
      ? Date.now() + expires_in * 1000
      : null;

  return { access_token: String(access_token), expiresAtMs };
}

async function fetchGmailAttachment(accessToken: string, messageId: string, attachmentId: string) {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const txt = await r.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch { /* ignore */ }

  return { ok: r.ok, status: r.status, raw: txt, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const apikey = req.headers.get("apikey") || "";

    if (!authHeader) return json(401, { error: "Missing Authorization header" });
    if (!apikey) return json(401, { error: "Missing apikey header" });

    const body = await req.json().catch(() => ({}));
    const messageId = body?.id;
    const attachmentId = body?.attachmentId;
    const filename = body?.filename || null;
    const mimeType = body?.mimeType || null;

    if (!messageId || !attachmentId) {
      return json(400, { error: "Missing id or attachmentId" });
    }

    // Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseKey = serviceKey || anonKey;

    if (!supabaseUrl || !supabaseKey) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE keys in env" });
    }

    const sb = createClient(supabaseUrl, supabaseKey, {
      // Validate the caller separately; DB access uses the local service client.
      auth: { persistSession: false },
    });

    // Validate user session (кто вызвал)
    const { data: userData, error: userErr } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (userErr || !userData?.user) return json(401, { error: "Invalid Supabase session" });

    // Токены хранятся у тебя в mail_accounts без user_id, provider='gmail'
    const { data: acc, error: accErr } = await sb
      .from("mail_accounts")
      .select("id, provider, email, access_token_enc, refresh_token_enc, token_expires_at")
      .eq("provider", "gmail")
      .single();

    if (accErr || !acc?.access_token_enc) {
      return json(404, { error: "MAIL_ACCOUNT_NOT_FOUND", details: String(accErr?.message || accErr || "") });
    }

    let accessToken = stripPlainPrefix(acc.access_token_enc);
    const refreshToken = acc.refresh_token_enc ? stripPlainPrefix(acc.refresh_token_enc) : null;

    const expiresAtMs = parseTimestamptzToMs(acc.token_expires_at);
    const now = Date.now();

    // если токен скоро протух (меньше 60с), пытаемся обновить заранее
    if (expiresAtMs && (expiresAtMs - now) < 60_000 && refreshToken) {
      try {
        const refreshed = await refreshGoogleAccessToken(refreshToken);
        accessToken = refreshed.access_token;

        const update: any = {
          access_token_enc: `plain:${refreshed.access_token}`,
        };
        if (refreshed.expiresAtMs) {
          update.token_expires_at = new Date(refreshed.expiresAtMs).toISOString();
        }

        await sb.from("mail_accounts").update(update).eq("id", acc.id);
      } catch (e) {
        // не падаем — попробуем старым токеном
        console.error("pre-refresh failed:", e);
      }
    }

    // скачиваем вложение
    let res = await fetchGmailAttachment(accessToken, messageId, attachmentId);

    // если 401 — токен точно протух → refresh и повтор
    if (!res.ok && res.status === 401 && refreshToken) {
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      accessToken = refreshed.access_token;

      const update: any = {
        access_token_enc: `plain:${refreshed.access_token}`,
      };
      if (refreshed.expiresAtMs) {
        update.token_expires_at = new Date(refreshed.expiresAtMs).toISOString();
      }

      await sb.from("mail_accounts").update(update).eq("id", acc.id);

      res = await fetchGmailAttachment(accessToken, messageId, attachmentId);
    }

    if (!res.ok) {
      return json(502, {
        error: "GMAIL_ATTACHMENT_FETCH_FAILED",
        status: res.status,
        details: res.raw,
      });
    }

    const gmailData = res.data;
    const b64url = gmailData?.data || "";
    const size = gmailData?.size ?? null;

    if (!b64url) {
      return json(502, { error: "EMPTY_ATTACHMENT_DATA" });
    }

    const base64 = normalizeGmailBase64UrlToBase64(String(b64url));

    return json(200, {
      filename: filename || "attachment",
      mimeType: mimeType || "application/octet-stream",
      base64,
      size,
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: String(e?.message || e) });
  }
});
