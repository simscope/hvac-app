// supabase/functions/calendar-badge/index.ts
// Обновляет badge на иконке приложения через Expo Push
// при любом изменении записи в таблице jobs.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== env / client =====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ===== types =====
type WebhookRow = {
  id?: string;
  technician_id?: string | null;
  appointment_time?: string | null;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: WebhookRow | null;
  old_record: WebhookRow | null;
};

// ===== helpers =====

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Вытащить technician_id из INSERT/UPDATE/DELETE события */
function extractTechnicianId(evt: WebhookPayload): string | null {
  const row = (evt.record || evt.old_record) as WebhookRow | null;
  if (!row || typeof row.technician_id !== "string") return null;
  const id = row.technician_id.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** Посчитать количество работ на сегодня для техника (по UTC-датам) */
async function getTodayJobsCount(technicianId: string): Promise<number> {
  const now = new Date();

  // сегодня (UTC)
  const startUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );
  const endUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  );

  const fromIso = startUtc.toISOString();
  const toIso = endUtc.toISOString();

  const { error, count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("technician_id", technicianId)
    .gte("appointment_time", fromIso)
    .lt("appointment_time", toIso);

  if (error) {
    console.error("[calendar-badge] jobs count error:", error.message);
    return 0;
  }

  return count ?? 0;
}

/** Найти всех Expo-токенов для техника через technicians → user_push_tokens */
async function getExpoTokensForTechnician(
  technicianId: string
): Promise<string[]> {
  // technicians.id -> technicians.auth_user_id
  const { data: tech, error: techErr } = await supabase
    .from("technicians")
    .select("auth_user_id")
    .eq("id", technicianId)
    .maybeSingle();

  if (techErr) {
    console.error("[calendar-badge] technician lookup error:", techErr.message);
    return [];
  }
  const userId = tech?.auth_user_id;
  if (!userId) return [];

  // user_push_tokens.user_id -> expo_token[]
  const { data: tokensData, error: tokErr } = await supabase
    .from("user_push_tokens")
    .select("expo_token")
    .eq("user_id", userId);

  if (tokErr) {
    console.error("[calendar-badge] tokens lookup error:", tokErr.message);
    return [];
  }

  const tokens =
    tokensData?.map((row: any) => String(row.expo_token)).filter(Boolean) ?? [];
  return Array.from(new Set(tokens)); // уникальные
}

/** Отправить Expo push с обновлённым badge для всех токенов */
async function sendBadgePush(tokens: string[], badge: number) {
  if (!tokens.length) return;
  const messages = tokens.map((token) => ({
    to: token,
    sound: null, // можно поставить 'default', если нужен звук
    badge,
    title: "Schedule updated",
    body:
      badge > 0
        ? `You have ${badge} job(s) today`
        : "You have no jobs for today",
    data: { kind: "calendar_badge" },
  }));

  const resp = await fetch(Deno.env.get("HVAC_LOCAL_PUSH_SINK") ?? "https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!resp.ok) {
    console.error(
      "[calendar-badge] Expo push error:",
      resp.status,
      await resp.text(),
    );
  }
}

/** Основная обработка одного события webhooks */
async function handleEvent(evt: WebhookPayload) {
  if (evt.table !== "jobs" || evt.schema !== "public") return;

  const technicianId = extractTechnicianId(evt);
  if (!technicianId) return;

  // Сколько работ у техника на сегодня
  const badge = await getTodayJobsCount(technicianId);

  // Все токены этого техника
  const tokens = await getExpoTokensForTechnician(technicianId);
  if (!tokens.length) return;

  await sendBadgePush(tokens, badge);
}

// ===== HTTP entrypoint =====

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (Array.isArray(body)) {
      // batch из нескольких событий
      await Promise.all(
        body.map((evt) => handleEvent(evt as WebhookPayload))
      );
    } else {
      await handleEvent(body as WebhookPayload);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (e) {
    console.error("[calendar-badge] error:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }
});
