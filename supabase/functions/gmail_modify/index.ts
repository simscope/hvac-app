// supabase/functions/gmail_modify/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ENC_KEY = Deno.env.get("ENCRYPTION_KEY");
const GCLIENT = Deno.env.get("GOOGLE_CLIENT_ID");
const GSECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const sb = createClient(SUPABASE_URL, SERVICE);
function json(code, body) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
async function decrypt(cipher) {
  const [ivB64, dataB64] = cipher.split(".");
  const key = await crypto.subtle.importKey("raw", jose.base64url.decode(ENC_KEY), "AES-GCM", false, [
    "decrypt"
  ]);
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: jose.base64url.decode(ivB64)
  }, key, jose.base64url.decode(dataB64));
  return new TextDecoder().decode(new Uint8Array(plain));
}
async function getAccAndToken() {
  const { data, error } = await sb.from("mail_accounts").select("*").eq("provider", "gmail").limit(1).single();
  if (error || !data) throw new Error("MAIL_ACCOUNT_NOT_FOUND");
  const exp = data.token_expires_at ? Date.parse(data.token_expires_at) : 0;
  if (exp > Date.now() + 60_000) {
    return {
      token: await decrypt(data.access_token_enc)
    };
  }
  // попытаться рефрешнуть — упрощённая версия, можно как в send/list
  if (!data.refresh_token_enc) return {
    token: await decrypt(data.access_token_enc)
  };
  const refresh = await decrypt(data.refresh_token_enc);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refresh
    })
  });
  if (!res.ok) throw new Error(`refresh_failed: ${await res.text()}`);
  const t = await res.json();
  await sb.from("mail_accounts").update({
    access_token_enc: await (async ()=>{
      const key = await crypto.subtle.importKey("raw", jose.base64url.decode(ENC_KEY), "AES-GCM", false, [
        "encrypt"
      ]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = await crypto.subtle.encrypt({
        name: "AES-GCM",
        iv
      }, key, new TextEncoder().encode(t.access_token));
      return `${jose.base64url.encode(iv)}.${jose.base64url.encode(new Uint8Array(enc))}`;
    })(),
    token_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }).eq("provider", "gmail");
  return {
    token: t.access_token
  };
}
serve(async (req)=>{
  try {
    if (req.method !== "POST") return json(405, {
      error: "Method Not Allowed"
    });
    const { id, addLabels, removeLabels } = await req.json();
    if (!id) return json(400, {
      error: "id required"
    });
    const { token } = await getAccAndToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        addLabelIds: addLabels || [],
        removeLabelIds: removeLabels || []
      })
    });
    if (!res.ok) return json(res.status, {
      error: await res.text()
    });
    return json(200, {
      status: "ok"
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "MAIL_ACCOUNT_NOT_FOUND") return json(404, {
      error: msg
    });
    return json(500, {
      error: msg
    });
  }
});
