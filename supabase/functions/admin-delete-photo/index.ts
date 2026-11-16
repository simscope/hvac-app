import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const corsHeaders = {
  // при желании вместо "*" укажи точный домен фронта:
  // "Access-Control-Allow-Origin": "https://hvac-app-jade.vercel.app",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
serve(async (req)=>{
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Method Not Allowed"
      }), {
        status: 405,
        headers: corsHeaders
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false
      }
    });
    // JWT из заголовка
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: corsHeaders
      });
    }
    // Правильный способ: серверным клиентом валидируем токен
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user?.id) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: corsHeaders
      });
    }
    const uid = userRes.user.id;
    // Проверка роли (admin/manager) в technicians или profiles
    const { data: tech } = await admin.from("technicians").select("role,is_active").eq("auth_user_id", uid).maybeSingle();
    const { data: prof } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
    const role = (prof?.role || tech?.role || "").toString().toLowerCase();
    const active = tech?.is_active ?? true;
    const isAdmin = [
      "admin",
      "manager",
      "админ",
      "администратор",
      "менеджер"
    ].includes(role) && active;
    if (!isAdmin) {
      return new Response(JSON.stringify({
        error: "Forbidden: admin/manager only"
      }), {
        status: 403,
        headers: corsHeaders
      });
    }
    // Параметры
    const { bucket, path } = await req.json().catch(()=>({}));
    if (!bucket || !path) {
      return new Response(JSON.stringify({
        error: "bucket and path are required"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // Удаление
    const { error } = await admin.storage.from(bucket).remove([
      path
    ]);
    if (error) {
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    return new Response(JSON.stringify({
      ok: true
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message || "Internal Error"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
