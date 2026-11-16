// Устанавливай зависимости в functions: date-fns-tz
// npm i date-fns date-fns-tz
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
serve(async ()=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.44.1");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Берём активные задачи на сегодня
  const today = new Date();
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(today).reduce((acc, p)=>{
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const dueISO = `${ny.year}-${ny.month}-${ny.day}`;
  const { data: tasks, error } = await supabase.from('tasks').select('id,assignee_id,status,due_date').eq('due_date', dueISO).eq('status', 'active');
  if (error) return new Response(error.message, {
    status: 500
  });
  const userSet = new Set();
  tasks?.forEach((t)=>userSet.add(t.assignee_id));
  // Вставляем по одному уведомлению на пользователя
  if (userSet.size > 0) {
    const rows = Array.from(userSet).map((uid)=>({
        user_id: uid,
        kind: 'morning',
        payload: {
          message: 'У вас активные задачи на сегодня'
        }
      }));
    const { error: e2 } = await supabase.from('task_notifications').insert(rows);
    if (e2) return new Response(e2.message, {
      status: 500
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    count: tasks?.length ?? 0
  }), {
    status: 200
  });
});
