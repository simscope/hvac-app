import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/* ==== CORS ==== */
const ORIGINS = new Set([
  "http://127.0.0.1:18280",
  "https://hvac-app-jade.vercel.app",
  "https://www.hvac-app-jade.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);

const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ORIGINS.has(o) ? o : "https://hvac-app-jade.vercel.app",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-auth",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
});

const json = (req: Request, data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...(init || {}),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors(req.headers.get("Origin")),
      ...(init?.headers || {}),
    },
  });

/* ==== crypto helpers ==== */
function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getAesKey(): Promise<CryptoKey | null> {
  const b64 = Deno.env.get("MAIL_ENC_KEY_B64");
  if (!b64) return null;

  const raw = base64ToUint8(b64);
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt", "encrypt"]);
}

async function decryptMaybe(stored: string): Promise<string> {
  if (stored.startsWith("plain:")) return stored.slice(6);

  const key = await getAesKey();
  if (!key) throw new Error("MAIL_ENC_KEY_B64 missing needed to decrypt");

  const buf = base64ToUint8(stored);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);

  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function encryptAccessToken(access: string): Promise<string> {
  const key = await getAesKey();

  if (!key) {
    return `plain:${access}`;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(access),
  );

  const combined = new Uint8Array(iv.length + (ct as ArrayBuffer).byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct as ArrayBuffer), iv.length);

  let s = "";
  for (const b of combined) s += String.fromCharCode(b);

  return btoa(s);
}
/* ========================= */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

function headerValue(headers: Array<{ name: string; value: string }>, name: string) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function safeMaxResults(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 10;
  if (n < 1) return 10;
  if (n > 10) return 10;
  return Math.floor(n);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(req.headers.get("Origin")),
    });
  }

  try {
    if (req.method !== "POST") {
      return json(req, { ok: false, error: "Method Not Allowed" }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));

    const folder = String(body.folder || "inbox").toLowerCase();
    const q = String(body.q || "").trim();
    const pageToken = String(body.pageToken || "");
    const maxResults = safeMaxResults(body.maxResults);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return json(
        req,
        { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 },
      );
    }

    const r = await fetch(
      `${supabaseUrl}/rest/v1/mail_accounts?provider=eq.gmail&select=*&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (!r.ok) {
      return json(req, { ok: false, step: "mail_accounts", error: await r.text() }, { status: 500 });
    }

    const rows = await r.json();

    if (!rows.length) {
      return json(req, { ok: false, code: "MAIL_ACCOUNT_NOT_FOUND" }, { status: 404 });
    }

    const row = rows[0];

    let access = await decryptMaybe(row.access_token_enc);
    const refresh = await decryptMaybe(row.refresh_token_enc);
    const exp = new Date(row.token_expires_at).getTime();

    if (!access || Date.now() > exp) {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        return json(
          req,
          { ok: false, error: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET" },
          { status: 500 },
        );
      }

      const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      });

      const tr = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      });

      if (!tr.ok) {
        return json(
          req,
          {
            ok: false,
            step: "refresh",
            status: tr.status,
            error: await tr.text(),
          },
          { status: 502 },
        );
      }

      const tj = await tr.json();

      access = String(tj.access_token || "");

      if (!access) {
        return json(req, { ok: false, step: "refresh", error: "Empty access_token" }, { status: 502 });
      }

      const newExp = new Date(
        Date.now() + (Number(tj.expires_in ?? 3600) - 60) * 1000,
      ).toISOString();

      const access_token_enc = await encryptAccessToken(access);

      const upd = await fetch(`${supabaseUrl}/rest/v1/mail_accounts?id=eq.${row.id}`, {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          access_token_enc,
          token_expires_at: newExp,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!upd.ok) {
        return json(
          req,
          { ok: false, step: "save_access", error: await upd.text() },
          { status: 500 },
        );
      }
    }

    const labels: string[] = [];

    if (folder === "inbox" || folder === "входящие") labels.push("INBOX");
    if (folder === "sent" || folder === "отправленные") labels.push("SENT");
    if (folder === "spam") labels.push("SPAM");
    if (folder === "drafts" || folder === "черновики") labels.push("DRAFT");

    const listUrl = new URL(`${GMAIL}/messages`);

    if (labels.length) listUrl.searchParams.set("labelIds", labels.join(","));
    if (q) listUrl.searchParams.set("q", q);

    listUrl.searchParams.set("maxResults", String(maxResults));

    if (pageToken) {
      listUrl.searchParams.set("pageToken", pageToken);
    }

    const l = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${access}`,
      },
    });

    if (!l.ok) {
      return json(
        req,
        {
          ok: false,
          step: "list",
          status: l.status,
          error: await l.text(),
        },
        { status: 502 },
      );
    }

    const lj: {
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    } = await l.json();

    const ids = lj.messages ?? [];
    const emails: any[] = [];

    if (ids.length) {
      for (const m of ids) {
        const msgUrl =
          `${GMAIL}/messages/${m.id}` +
          `?format=metadata` +
          `&metadataHeaders=From` +
          `&metadataHeaders=To` +
          `&metadataHeaders=Subject` +
          `&metadataHeaders=Date`;

        const g = await fetch(msgUrl, {
          headers: {
            Authorization: `Bearer ${access}`,
          },
        });

        if (!g.ok) continue;

        const d = await g.json();

        const hs = (d.payload?.headers ?? []) as Array<{ name: string; value: string }>;

        emails.push({
          id: d.id,
          threadId: d.threadId,
          from: headerValue(hs, "From") ?? "",
          to: headerValue(hs, "To") ?? "",
          subject: headerValue(hs, "Subject") ?? "",
          date: headerValue(hs, "Date") ?? "",
          snippet: d.snippet ?? "",
        });
      }
    }

    return json(req, {
      ok: true,
      emails,
      nextPageToken: lj.nextPageToken || null,
      maxResults,
    });
  } catch (e) {
    return json(
      req,
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
});