import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://hvac-app-jade.vercel.app"
]);
function corsHeaders(origin) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
}
serve(async (req)=>{
  const origin = req.headers.get("origin");
  const base = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: base
  });
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Only POST is allowed"
      }), {
        status: 405,
        headers: {
          ...base,
          "Content-Type": "application/json"
        }
      });
    }
    const body = await req.json().catch(()=>({}));
    const job_id = String(body.job_id ?? "").trim();
    const invoice_no_raw = body.invoice_no;
    const bucket = String(body.bucket ?? "invoices");
    if (!job_id || invoice_no_raw === undefined || invoice_no_raw === null) {
      return new Response(JSON.stringify({
        error: "job_id and invoice_no are required"
      }), {
        status: 400,
        headers: {
          ...base,
          "Content-Type": "application/json"
        }
      });
    }
    // приводим invoice_no к числу (для eq по integer-колонке)
    if (bucket !== 'invoices' || !/^[0-9a-f-]{36}$/i.test(String(job_id))) {
      return new Response(JSON.stringify({error:'LOCAL_INVOICE_SCOPE_REQUIRED'}), {status:400,headers:{...base,'Content-Type':'application/json'}});
    }
    const invoice_no = Number(invoice_no_raw);
    if (!Number.isFinite(invoice_no)) {
      return new Response(JSON.stringify({
        error: "invoice_no must be a number"
      }), {
        status: 400,
        headers: {
          ...base,
          "Content-Type": "application/json"
        }
      });
    }
    // поддержка и key, и file_name из фронта
    // key: "jobId/invoice_56.pdf"
    // file_name: "invoice_56.pdf" (или иногда уже "jobId/invoice_56.pdf")
    let key = body.key ?? null;
    const file_name = body.file_name ?? null;
    if (!key && file_name) {
      key = file_name.includes("/") ? file_name : `${job_id}/${file_name}`;
    }
    // если пришёл key без job_id — добавим
    if (key && !key.startsWith(`${job_id}/`)) {
      key = `${job_id}/${key}`;
    }
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (key && (key !== `${job_id}/invoice_${invoice_no}.pdf`)) {
      return new Response(JSON.stringify({error:'LOCAL_INVOICE_KEY_MISMATCH'}), {status:400,headers:{...base,'Content-Type':'application/json'}});
    }
    const admin = createClient(url, service);
    // 1) Удаляем PDF из Storage (если знаем путь)
    let storageDeleted = false;
    if (key) {
      const { error: stErr } = await admin.storage.from(bucket).remove([
        key
      ]);
      if (!stErr) storageDeleted = true;
    // если файла нет — не считаем это ошибкой
    }
    // 2) Чистим запись в БД
    const { error: dbErr } = await admin.from("invoices").delete().eq("job_id", job_id).eq("invoice_no", invoice_no); // число!
    if (dbErr) throw dbErr;
    return new Response(JSON.stringify({
      ok: true,
      storageDeleted
    }), {
      headers: {
        ...base,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e?.message ?? String(e)
    }), {
      status: 500,
      headers: {
        ...corsHeaders(req.headers.get("origin")),
        "Content-Type": "application/json"
      }
    });
  }
});
