// supabase/functions/admin-delete-invoice-bundle/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
Deno.serve(async (req)=>{
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); // сервисный ключ
    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(()=>({}));
    const bucket = body?.bucket || 'invoices';
    const key = body?.key || ''; // например: "<job_id>/invoice_22.pdf"
    const job_id = body?.job_id ?? null;
    const invoice_no = body?.invoice_no != null ? Number(body.invoice_no) : null;
    const db_id = body?.db_id ?? null;
    const result = {
      ok: true,
      storage: null,
      db: null,
      input: {
        bucket,
        key,
        job_id,
        invoice_no,
        db_id
      }
    };
    // 1) Удаляем файл из Storage (если передан key)
    if (key) {
      const { error } = await admin.storage.from(bucket).remove([
        key
      ]);
      result.storage = {
        removed: !error,
        key,
        error: error?.message ?? null
      };
    }
    // 2) Удаляем запись из БД
    if (db_id) {
      const { error } = await admin.from('invoices').delete().eq('id', db_id);
      result.db = {
        by: 'id',
        ok: !error,
        error: error?.message ?? null
      };
    } else if (job_id && invoice_no != null) {
      const { error } = await admin.from('invoices').delete().eq('job_id', job_id).eq('invoice_no', invoice_no);
      result.db = {
        by: 'job_id+invoice_no',
        ok: !error,
        error: error?.message ?? null
      };
    } else {
      result.db = {
        by: 'none',
        ok: true,
        skipped: true
      };
    }
    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e?.message || e)
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
