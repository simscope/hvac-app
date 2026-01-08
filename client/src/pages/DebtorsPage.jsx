// client/src/pages/DebtorsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * ✅ ЛОГИКА ДОЛЖНИКОВ (как ты сказал)
 * Неоплаченные = где НЕ выбран тип оплаты (NULL / '' / '-')
 *
 * ДОЛЖНИК = archived_at IS NULL
 *   и ( scf > 0 && scf_payment_method пустой )
 *   или ( labor_price > 0 && labor_payment_method пустой )
 *
 * ✅ Открытие полной карточки заявки:
 * кликаешь по строке (или кнопка View) → открывает JobDetailsPage в новом окне
 *
 * ⚠️ ВАЖНО: путь карточки может отличаться в твоём роутере.
 * По умолчанию стоит /job/:id. Если у тебя другой — поменяй функцию jobDetailsUrl ниже.
 */

const PAYMENT_METHODS = ["-", "cash", "Zelle", "card", "check", "ACH"];

const isEmptyPay = (v) => v === null || v === "-" || String(v).trim() === "";

// 👉 Если у тебя другой роут на карточку — поменяй здесь
const jobDetailsUrl = (jobId) => `/job/${jobId}`; // например: `/jobs/${jobId}`

const calcDue = (j) => {
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  const scfDue = scf > 0 && isEmptyPay(j.scf_payment_method) ? scf : 0;
  const laborDue = labor > 0 && isEmptyPay(j.labor_payment_method) ? labor : 0;

  return scfDue + laborDue;
};

export default function DebtorsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [hideBlacklisted, setHideBlacklisted] = useState(false);

  /* ================= LOAD ================= */

  const load = async () => {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("jobs")
      .select(
        `
        id,
        job_number,
        status,
        issue,
        system_type,
        scf,
        scf_payment_method,
        labor_price,
        labor_payment_method,
        appointment_time,
        archived_at,
        archived_reason,
        clients:client_id (
          id,
          full_name,
          phone,
          address,
          company,
          blacklist
        )
      `
      )
      .is("archived_at", null)
      .order("appointment_time", { ascending: false });

    if (error) {
      setError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  /* ================= FILTER DEBTORS ================= */

  const debtors = useMemo(() => {
    const q = query.trim().toLowerCase();

    return (rows || [])
      .filter((j) => {
        // debtor logic
        const scf = Number(j.scf || 0);
        const labor = Number(j.labor_price || 0);

        const scfUnpaid = scf > 0 && isEmptyPay(j.scf_payment_method);
        const laborUnpaid = labor > 0 && isEmptyPay(j.labor_payment_method);

        return scfUnpaid || laborUnpaid;
      })
      .filter((j) => {
        const c = j.clients || {};
        if (hideBlacklisted && c.blacklist) return false;

        if (!q) return true;

        const hay = [
          j.job_number,
          j.status,
          j.issue,
          j.system_type,
          c.full_name,
          c.company,
          c.phone,
          c.address,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(q);
      });
  }, [rows, query, hideBlacklisted]);

  const totalDue = useMemo(() => {
    return debtors.reduce((s, j) => s + calcDue(j), 0);
  }, [debtors]);

  /* ================= LOCAL UPDATE ================= */

  const setLocal = (id, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  /* ================= OPEN DETAILS ================= */

  const openDetails = (jobId) => {
    const url = jobDetailsUrl(jobId);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // чтобы клик по input/select/button НЕ открывал карточку
  const stopRowClick = (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
  };

  /* ================= SAVE ================= */

  const saveJob = async (job) => {
    setError("");

    // Нормализуем значения
    const payload = {
      scf: job.scf === "" ? null : Number(job.scf || 0),
      scf_payment_method: job.scf_payment_method ?? "-",
      labor_price: job.labor_price === "" ? null : Number(job.labor_price || 0),
      labor_payment_method: job.labor_payment_method ?? "-",
      status: job.status ?? "",
    };

    const { error } = await supabase.from("jobs").update(payload).eq("id", job.id);

    if (error) {
      setError(error.message);
      return;
    }

    await load();
  };

  /* ================= ARCHIVE ================= */

  const archiveJob = async (jobId) => {
    if (!window.confirm("Archive this job?")) return;

    const { error } = await supabase
      .from("jobs")
      .update({
        archived_at: new Date().toISOString(),
        archived_reason: "manual (debtors)",
      })
      .eq("id", jobId);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((prev) => prev.filter((r) => r.id !== jobId));
  };

  /* ================= BLACKLIST ================= */

  const editBlacklist = async (client) => {
    const current = client.blacklist || "";
    const reason = window.prompt(
      "Blacklist reason (empty = remove from blacklist)",
      current
    );
    if (reason === null) return;

    const next = reason.trim();

    const { error } = await supabase
      .from("clients")
      .update({ blacklist: next ? next : null })
      .eq("id", client.id);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.clients?.id === client.id
          ? {
              ...r,
              clients: { ...r.clients, blacklist: next ? next : null },
            }
          : r
      )
    );
  };

  /* ================= RENDER ================= */

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h2 style={{ margin: 0 }}>Debtors</h2>

        <button onClick={load} disabled={loading}>
          Refresh
        </button>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={hideBlacklisted}
            onChange={(e) => setHideBlacklisted(e.target.checked)}
          />
          Hide blacklisted
        </label>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: job#, client, phone, address, issue..."
          style={{ minWidth: 320, padding: 6 }}
        />

        <div style={{ marginLeft: "auto", fontWeight: 800 }}>
          Total due: ${totalDue.toFixed(2)}
        </div>
      </div>

      {error ? (
        <div style={{ color: "#ff6b6b", marginBottom: 10, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Job #",
                  "Client",
                  "Phone",
                  "Address",
                  "System",
                  "Issue",
                  "SCF",
                  "SCF payment",
                  "Labor",
                  "Labor payment",
                  "Due",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid rgba(255,255,255,0.12)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {debtors.map((j) => {
                const c = j.clients || {};
                const blacklisted = !!c.blacklist;
                const due = calcDue(j);

                return (
                  <tr
                    key={j.id}
                    onClick={() => openDetails(j.id)}
                    title="Click to open full job details"
                    style={{
                      cursor: "pointer",
                      background: blacklisted
                        ? "rgba(255,0,0,0.14)"
                        : "rgba(255,200,200,0.10)",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      <b>{j.job_number}</b>
                    </td>

                    <td style={{ padding: 8, minWidth: 180 }}>
                      <div style={{ fontWeight: 800 }}>{c.full_name || "-"}</div>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>
                        {c.company || ""}
                      </div>
                      {blacklisted && (
                        <div style={{ fontSize: 11, color: "#ff6b6b" }}>
                          BLACKLIST: {c.blacklist}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      {c.phone ? (
                        <a
                          href={`tel:${String(c.phone).replace(/[^\d+]/g, "")}`}
                          onClick={stopRowClick}
                          style={{ color: "#60a5fa", textDecoration: "none" }}
                          title="Call"
                        >
                          {c.phone}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td style={{ padding: 8, minWidth: 260 }}>
                      {c.address || "-"}
                    </td>

                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      {j.system_type || "-"}
                    </td>

                    <td style={{ padding: 8, minWidth: 260 }}>
                      {j.issue || "-"}
                    </td>

                    <td style={{ padding: 8 }} onClick={stopRowClick}>
                      <input
                        value={j.scf ?? ""}
                        onChange={(e) => setLocal(j.id, { scf: e.target.value })}
                        style={{ width: 70, padding: 6 }}
                      />
                    </td>

                    <td style={{ padding: 8 }} onClick={stopRowClick}>
                      <select
                        value={j.scf_payment_method ?? "-"}
                        onChange={(e) =>
                          setLocal(j.id, { scf_payment_method: e.target.value })
                        }
                        style={{ padding: 6 }}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }} onClick={stopRowClick}>
                      <input
                        value={j.labor_price ?? ""}
                        onChange={(e) =>
                          setLocal(j.id, { labor_price: e.target.value })
                        }
                        style={{ width: 90, padding: 6 }}
                      />
                    </td>

                    <td style={{ padding: 8 }} onClick={stopRowClick}>
                      <select
                        value={j.labor_payment_method ?? "-"}
                        onChange={(e) =>
                          setLocal(j.id, {
                            labor_payment_method: e.target.value,
                          })
                        }
                        style={{ padding: 6 }}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      <b>${due.toFixed(2)}</b>
                    </td>

                    <td style={{ padding: 8 }} onClick={stopRowClick}>
                      <input
                        value={j.status ?? ""}
                        onChange={(e) => setLocal(j.id, { status: e.target.value })}
                        style={{ width: 140, padding: 6 }}
                      />
                    </td>

                    <td style={{ padding: 8, whiteSpace: "nowrap" }} onClick={stopRowClick}>
                      <button onClick={() => openDetails(j.id)} style={{ marginRight: 8 }}>
                        View
                      </button>

                      <button onClick={() => saveJob(j)} style={{ marginRight: 8 }}>
                        Save
                      </button>

                      <button onClick={() => archiveJob(j.id)} style={{ marginRight: 8 }}>
                        Archive
                      </button>

                      <button
                        onClick={() => editBlacklist(c)}
                        title="Edit blacklist reason (empty = remove)"
                      >
                        Blacklist
                      </button>
                    </td>
                  </tr>
                );
              })}

              {debtors.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: 16, opacity: 0.85 }}>
                    No unpaid jobs 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
            Tip: click a row to open full job card. Controls (inputs/selects/buttons) won’t open it.
          </div>
        </div>
      )}
    </div>
  );
}
