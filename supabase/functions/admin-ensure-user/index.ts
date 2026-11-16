// Создание/обновление/приглашение и удаление сотрудника.
// Работает даже если тело пришло как text/plain и принимает technician_id | technicianId | id.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const J = (body, status = 200)=>new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    }
  });
async function readBody(req) {
  // Пытаемся честно разобрать JSON
  try {
    return await req.json();
  } catch (_) {
    // Иногда Supabase/браузер присылают text/plain
    try {
      const txt = await req.text();
      return txt ? JSON.parse(txt) : {};
    } catch  {
      return {};
    }
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return J({
    ok: true,
    stage: "preflight"
  });
  let stage = "start";
  try {
    // === ENV ===
    stage = "env";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || new URL(req.url).origin;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!SERVICE_ROLE_KEY) {
      return J({
        error: "Missing SUPABASE_SERVICE_ROLE_KEY",
        stage,
        hint: "Добавьте секрет в Edge Functions → Secrets и redeploy."
      }, 500);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false
      }
    });
    // === CALLER / ADMIN CHECK ===
    stage = "jwt";
    const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!jwt) return J({
      error: "No Authorization header",
      stage
    }, 401);
    stage = "caller";
    const { data: callerData } = await admin.auth.getUser(jwt);
    const caller = callerData.user;
    if (!caller) return J({
      error: "Invalid token",
      stage
    }, 401);
    stage = "admin-check";
    let isAdmin = caller.app_metadata?.role === "admin";
    if (!isAdmin) {
      const p = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
      if (!p.error && p.data) isAdmin = p.data.role === "admin";
    }
    if (!isAdmin) {
      const t = await admin.from("technicians").select("role, is_admin").eq("auth_user_id", caller.id).maybeSingle();
      if (!t.error && t.data) isAdmin = t.data.role === "admin" || !!t.data.is_admin;
    }
    if (!isAdmin) return J({
      error: "Only admin can call",
      stage
    }, 403);
    // === BODY ===
    stage = "parse-body";
    const raw = await readBody(req);
    const action = (raw.action || "").toString();
    // ---------- DELETE ----------
    if (action === "delete") {
      stage = "delete-validate";
      const idRaw = raw.technician_id ?? raw.technicianId ?? raw.id ?? null;
      if (!idRaw) return J({
        error: "technician_id required",
        stage
      }, 400);
      // id может прийти как строка или число; храним в таблице как UUID/число — просто приводим к строке
      const technician_id = String(idRaw);
      const alsoDeleteAuth = !!raw.alsoDeleteAuth;
      // найдём uid для возможного удаления auth
      const ti = await admin.from("technicians").select("id, auth_user_id").eq("id", technician_id).maybeSingle();
      if (ti.error) return J({
        error: "select technicians failed",
        stage: "delete-select",
        details: ti.error.message
      }, 400);
      if (!ti.data) return J({
        ok: true,
        stage: "delete-done",
        message: "already deleted"
      });
      const uid = ti.data.auth_user_id ?? null;
      // удаляем profile (если есть связь technician_id -> profiles.technician_id)
      await admin.from("profiles").delete().eq("technician_id", technician_id);
      // удаляем запись из technicians
      const delT = await admin.from("technicians").delete().eq("id", technician_id);
      if (delT.error) return J({
        error: "delete technicians failed",
        stage: "delete-tech",
        details: delT.error.message
      }, 400);
      // опционально удаляем auth
      if (alsoDeleteAuth && uid) {
        try {
          await admin.auth.admin.deleteUser(uid);
        } catch (e) {
        // не падаем из-за проблем с auth
        }
      }
      return J({
        ok: true,
        stage: "delete-done",
        technician_id,
        alsoDeleteAuth
      });
    }
    // ---------- ENSURE (создание/привязка) ----------
    if (action === "ensure") {
      stage = "ensure-validate";
      const email = (raw.email || "").toString().trim().toLowerCase();
      const password = (raw.password || "").toString();
      const name = (raw.name || "").toString().trim();
      const phone = raw.phone ? String(raw.phone) : null;
      const role = (raw.role || "technician").toString().trim(); // admin | manager | technician
      const createAuth = !!raw.createAuth; // чекбокс на форме
      const link_if_exists = raw.link_if_exists !== false;
      if (!email || !name || !role) return J({
        error: "email, name, role are required",
        stage
      }, 400);
      async function insertTechnician(uid) {
        const ins = await admin.from("technicians").insert({
          name,
          phone,
          role: role === "tech" ? "tech" : role,
          is_admin: role === "admin",
          auth_user_id: uid,
          email
        }).select("id").single();
        if (ins.error) return {
          error: ins.error.message
        };
        const technician_id = ins.data.id;
        // profile (если нет — создаём, если есть — обновим связь)
        const pr = await admin.from("profiles").select("id").eq("id", uid ?? "").maybeSingle();
        if (uid && (!pr.error || pr.data)) {
          await admin.from("profiles").upsert({
            id: uid,
            full_name: name,
            role,
            technician_id
          });
        }
        return {
          ok: true,
          technician_id
        };
      }
      // Без Auth: просто technicians (+profiles при наличии uid позже)
      if (!createAuth) {
        const r = await insertTechnician(null);
        if ("error" in r) return J({
          error: r.error,
          stage: "technician-only"
        }, 400);
        return J({
          ok: true,
          stage: "technician-only",
          technician_id: r.technician_id
        });
      }
      // С Auth: пытаемся найти существующего пользователя
      stage = "auth-ensure";
      let uid = null;
      if (link_if_exists) {
        try {
          const f = await admin.auth.admin.getUserByEmail(email);
          uid = f.data?.user?.id ?? null;
        } catch (_) {
          uid = null;
        }
      }
      // Если не нашли — создаём
      if (!uid) {
        const cu = await admin.auth.admin.createUser({
          email,
          password: password && password.length >= 6 ? password : undefined,
          email_confirm: true,
          app_metadata: {
            role
          },
          user_metadata: {
            full_name: name,
            phone
          }
        });
        if (cu.error || !cu.data?.user?.id) {
          return J({
            status: 400,
            error: "Auth user was not created",
            stage: "auth-ensure",
            details: cu.error ? cu.error.message : "unknown",
            hint: "Проверьте: Allow signups включён; Email provider можно оставить выключенным; пароль ≥6; service-role в секрете функции."
          }, 400);
        }
        uid = cu.data.user.id;
      } else {
        // Обновим существующего
        try {
          await admin.auth.admin.updateUserById(uid, {
            email_confirm: true,
            app_metadata: {
              role
            },
            user_metadata: {
              full_name: name,
              phone
            }
          });
        } catch (_) {}
      }
      const r = await insertTechnician(uid);
      if ("error" in r) return J({
        error: r.error,
        stage: "insert-technicians"
      }, 400);
      return J({
        ok: true,
        stage: "ensure-done",
        technician_id: r.technician_id,
        auth_user_id: uid,
        email,
        role
      });
    }
    // ---------- INVITE (ссылка входа/регистрации) ----------
    if (action === "invite") {
      stage = "invite-validate";
      const email = (raw.email || "").toString().trim().toLowerCase();
      const password = (raw.password || "").toString();
      if (!email) return J({
        error: "email required",
        stage
      }, 400);
      const link = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password: password && password.length >= 6 ? password : undefined
      }).catch((e)=>({
          error: e
        }));
      if (!("data" in link) || !link.data?.properties?.action_link) {
        return J({
          error: "cannot generate signup link",
          stage: "invite-generate",
          details: link && "error" in link ? String(link.error) : null
        }, 400);
      }
      return J({
        ok: true,
        stage: "invite-done",
        action_link: link.data.properties.action_link
      });
    }
    // неизвестное действие
    return J({
      error: "unknown action",
      stage: "validate",
      got: action
    }, 400);
  } catch (e) {
    return J({
      error: "Unhandled exception",
      stage,
      details: String(e)
    }, 500);
  }
});
