import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
serve(async ()=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.44.1");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Сегодня по NY
  const now = new Date();
  // timestamp 1 час назад:
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  // Ищем активные задачи на сегодня, по которым последний комментарий старше часа
  // или комментариев вообще нет.
  const { data: tasks, error } = await supabase.rpc('find_silent_tasks', {
    p_since: oneHourAgo
  }); // создадим rpc ниже
  if (error) return new Response(error.message, {
    status: 500
  });
  if (tasks && tasks.length) {
    const notifs = tasks.map((t)=>({
        user_id: t.assignee_id,
        kind: 'nudge',
        payload: {
          task_id: t.id,
          message: 'Нет комментария по активной задаче > 1 часа'
        }
      }));
    const { error: e2 } = await supabase.from('task_notifications').insert(notifs);
    if (e2) return new Response(e2.message, {
      status: 500
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    nudged: tasks?.length ?? 0
  }), {
    status: 200
  });
});
