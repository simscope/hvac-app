// /supabase/functions/staff-terminate/index.ts
// deno + supabase-js
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Разрешённые источники (можно оставить "*" или перечислить домены)
const ALLOWED_ORIGINS = [
  "*"
];
// Если хочешь жёстко: ["https://hvac-app.jade.vercel.app", "http://localhost:5173"]
function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes("*") || origin && ALLOWED_ORIGINS.includes(origin) ? origin ?? "*" : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    // credentials не нужны, т.к. работаем по Bearer; если будут cookies → добавь:
    // "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json"
  };
}
serve(async (req)=>{
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  // Preflight
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
    // Входные данные
    const { tech_id, auth_user_id, reason } = await req.json();
    if (!tech_id) {
      return new Response(JSON.stringify({
        ok: false,
        error: "tech_id is required"
      }), {
        status: 400,
        headers
      });
    }
    // Админ-клиент (service key)
    const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL".toUpperCase());
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY".toUpperCase());
    if (!url || !key) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      }), {
        status: 500,
        headers
      });
    }
    const admin = createClient(url, key, {
      auth: {
        persistSession: false
      }
    });
    // 1) Пометить технику неактивным и убрать из чатов (RPC)
    // RLS/SECURITY DEFINER RPC needs the verified caller identity, not a service JWT with no sub.
    // Keep the original service-only admin client for Auth administration.
    const rpcClient = createClient(url, key, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false }
    });
    // Preserve the RPC's org boundary. A missing mapping must fail, not report a no-op as success.
    const { data: callerOrg, error: orgError } = await rpcClient.rpc("current_org_id");
    if (orgError || callerOrg == null) return new Response(JSON.stringify({ok:false,error:"CALLER_ORG_UNRESOLVED"}),{status:409,headers});
    const { data: target, error: targetError } = await admin.from("technicians").select("id,org_id,auth_user_id,is_active").eq("id",tech_id).maybeSingle();
    if (targetError || !target) return new Response(JSON.stringify({ok:false,error:"TARGET_TECHNICIAN_NOT_FOUND"}),{status:404,headers});
    if (String(target.org_id)!==String(callerOrg)) return new Response(JSON.stringify({ok:false,error:"ORG_SCOPE_MISMATCH"}),{status:403,headers});
    if (auth_user_id && auth_user_id!==target.auth_user_id) return new Response(JSON.stringify({ok:false,error:"AUTH_IDENTITY_MISMATCH"}),{status:403,headers});
    const { error: rpcErr } = await rpcClient.rpc("deactivate_technician", {
      p_tech_id: tech_id,
      p_reason: reason ?? null
    });
    if (rpcErr) {
      return new Response(JSON.stringify({
        ok: false,
        error: rpcErr.message
      }), {
        status: 500,
        headers
      });
    }
    const { data: verified, error: verifyError } = await admin.from("technicians").select("is_active").eq("id",tech_id).single();
    if (verifyError || verified?.is_active!==false) return new Response(JSON.stringify({ok:false,error:"DEACTIVATION_NOT_CONFIRMED"}),{status:409,headers});
    // 2) Удалить пользователя из Auth (если передан auth_user_id)
    if (auth_user_id) {
      const { error: delErr } = await admin.auth.admin.deleteUser(auth_user_id);
      if (delErr) {
        // Частичный успех: техник деактивирован, но Auth удалить не удалось
        return new Response(JSON.stringify({
          ok: false,
          partial: true,
          error: delErr.message,
          message: "Technician deactivated, but auth user delete failed"
        }), {
          status: 207,
          headers
        });
      }
    }
    // Успех
    return new Response(JSON.stringify({
      ok: true,
      tech_id,
      auth_deleted: Boolean(auth_user_id)
    }), {
      status: 200,
      headers
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e)
    }), {
      status: 500,
      headers
    });
  }
});
