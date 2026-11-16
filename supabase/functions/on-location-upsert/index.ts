// supabase/functions/on-location-upsert/index.ts
// Без новых таблиц. Использует tech_locations / tech_locations_latest.
// Авто-статусы считаются, только если в jobs есть site_lat/site_lng.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
serve(async (req)=>{
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors()
      });
    }
    const body = await req.json();
    if (!body?.technician_id || typeof body.lat !== 'number' || typeof body.lng !== 'number') {
      return new Response("Bad payload", {
        status: 400,
        headers: cors()
      });
    }
    // 1) получим активную работу (адаптируй where под свои статусы)
    const { data: job, error: jErr } = await supabase.from('jobs').select('id, status, site_lat, site_lng, site_radius_m').eq('technician_id', body.technician_id).not('status', 'in', '("completed","cancelled")').order('appointment_time', {
      ascending: true,
      nullsFirst: false
    }).limit(1).maybeSingle();
    let next = 'idle';
    if (jErr || !job?.site_lat || !job?.site_lng) {
    // нет координат объекта — только idle/en_route определить нельзя.
    // оставляем idle, ничего не трогаем.
    } else {
      const dist = haversineM(body.lat, body.lng, job.site_lat, job.site_lng);
      const r = job.site_radius_m ?? 60;
      if (dist < r) {
        // внутри зоны — on_site/working (working если держимся на месте >10 мин)
        const { data: tech } = await supabase.from('technicians').select('live_state, live_state_updated_at').eq('id', body.technician_id).maybeSingle();
        const wasOnSite = tech?.live_state === 'on_site';
        const ts = tech?.live_state_updated_at ? new Date(tech.live_state_updated_at).getTime() : 0;
        if (wasOnSite && Date.now() - ts > 10 * 60 * 1000) next = 'working';
        else next = 'on_site';
      // желаешь — можно обновить job.status
      // if (String(job.status).toLowerCase() === 'assigned') {
      //   await supabase.from('jobs').update({ status: 'in progress' }).eq('id', job.id);
      // }
      } else if (dist < 1500) {
        next = 'en_route';
      } else {
        next = 'idle';
      }
    }
    await supabase.from('technicians').update({
      live_state: next,
      live_state_updated_at: new Date().toISOString()
    }).eq('id', body.technician_id);
    return new Response(JSON.stringify({
      ok: true,
      state: next
    }), {
      status: 200,
      headers: cors({
        json: true
      })
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e?.message || e)
    }), {
      status: 500,
      headers: cors({
        json: true
      })
    });
  }
});
function cors(opts) {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type'
  };
  if (opts?.json) h['Content-Type'] = 'application/json';
  return h;
}
// Haversine (метры), прямо в функции — без SQL RPC.
function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = (x)=>x * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}
