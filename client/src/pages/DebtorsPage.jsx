import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * D E B T O R S  — FINAL LOGIC
 *
 * SHOW job ONLY IF:
 * 1) status === 'Completed'
 * 2) archived_at IS NULL
 * 3) payment NOT selected
 *    - scf > 0 && scf_payment_method empty
 *    OR
 *    - labor_price > 0 && labor_payment_method empty
 *
 * Save ONLY by Save button
 * Full Job Card opens on row click
 */

const PAYMENT_METHODS = ["-", "cash", "Zelle", "card", "check", "ACH"];

const isEmptyPay = (v) =>
  v === null || v === "-" || String(v).trim() === "";

// ⚠️ если у тебя другой роут — поменяй тут
const jobDetailsUrl = (id) => `/job/${id}`;

const calcDue = (j) => {
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  const scfDue = scf > 0 && isEmptyPay(j.scf_payment_method) ? scf : 0;
  const laborDue =
    labor > 0 && isEmptyPay(j.labor_payment_method) ? labor : 0;

  return scfDue + laborDue;
};

export default function DebtorsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ================= LOAD ================= */

  const load = async () => {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("jobs")
      .select(`
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
        clients:client_id (
          id,
          full_name,
          phone,
          address,
          company,
          blacklist
        )
      `)
      .eq("status", "Completed")
      .is("archived_at", null)
      .order("appointment_time", { ascending: false });

    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows(data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  /* ================= FILTER DEBTORS ================= */

  const debtors = useMemo(() => {
    return rows.filter((j) => {
      const scf = Number(j.scf || 0);
      const labor = Number(j.labor_price || 0);

      const scfUnpaid = scf > 0 && isEmptyPay(j.scf_payment_method);
      const laborUnpaid =
        labor > 0 && isEmptyPay(j.labor_payment_method);

      return scfUnpaid || laborUnpaid;
    });
  }, [rows]);

  const totalDue = useMemo(
    () => debtors.reduce((s, j) => s + calcDue(j), 0),
    [debtors]
  );

  /* ================= LOCAL UPDATE ================= */

  const setLocal = (id, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const stopRowClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const openDetails = (id) => {
    window.open(jobDetailsUrl(id), "_blank", "noopener,noreferrer");
  };

  /* ================= SAVE ================= */

  const saveJob = async (job) => {
    setError("");

    const payload = {
      scf: job.scf === "" ? null : Number(job.scf || 0),
      scf_payment_method: job.scf_payment_method ?? "-",
      labor_price:
        job.labor_price === "" ? null : Number(job.labor_price || 0),
      labor_payment_method: job.labor_payment_method ?? "-",
    };

    const { error } = await supabase
      .from("jobs")
      .update(payload)
      .eq("id", job.id);

    if (error) {
      setError(error.message);
      return;
    }

    await load();
  };

  /* ================= ARCHIVE ================= */

  const archiveJob = async (id) => {
    if (!window.confirm("Archive this completed job?")) return;

    const { error } = await supabase
      .from("jobs")
      .update({
        archived_at: new Date().toISOString(),
        archived_reason: "completed unpaid",
      })
      .eq("id", id);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /* ================= BLACKLIST ================= */

  const editBlacklist = async (client) => {
    const current = client.blacklist || "";
    const reason = window.prompt(
      "Blacklist reason (empty = remove)",
      current
    );
    if (reason === null) return;

    const value = reason.trim() || null;

    const { error } = await supabase
      .from("clients")
      .update({ blacklist: value })
      .eq("id", client.id);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.clients?.id === client.id
          ? { ...r, clients: { ...r.clients, blacklist: value } }
          : r
      )
    );
  };

  /* ================= RENDER ================= */

  return (
    <div style={{ padding: 16 }}>
      <h2>
        Debtors · Completed Jobs · Total Due $
        {totalDue.toFixed(2)}
      </h2>

      {error && (
        <div style={{ color: "#ff6b6b", marginBottom: 10 }}>
          {error}
        </div>
      )}

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
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: 8,
                      textAlign: "left",
                      borderBottom:
                        "1px solid rgba(255,255,255,.15)",
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
                const due = calcDue(j);

                return (
                  <tr
                    key={j.id}
                    onClick={() => openDetails(j.id)}
                    style={{
                      cursor: "pointer",
                      background: c.blacklist
                        ? "rgba(255,0,0,0.18)"
                        : "rgba(255,200,200,0.12)",
                    }}
                  >
                    <td style={{ padding: 8 }}>
                      <b>{j.job_number}</b>
                    </td>

                    <td style={{ padding: 8 }}>
                      <b>{c.full_name}</b>
                      <div style={{ fontSize: 12 }}>
                        {c.company}
                      </div>
                      {c.blacklist && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#ff6b6b",
                          }}
                        >
                          BLACKLIST: {c.blacklist}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: 8 }}>
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          onClick={stopRowClick}
                        >
                          {c.phone}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td style={{ padding: 8 }}>
                      {c.address}
                    </td>

                    <td style={{ padding: 8 }}>
                      {j.system_type}
                    </td>

                    <td style={{ padding: 8 }}>
                      {j.issue}
                    </td>

                    <td
                      style={{ padding: 8 }}
                      onClick={stopRowClick}
                    >
                      <input
                        value={j.scf ?? ""}
                        onChange={(e) =>
                          setLocal(j.id, {
                            scf: e.target.value,
                          })
                        }
                        style={{ width: 70 }}
                      />
                    </td>

                    <td
                      style={{ padding: 8 }}
                      onClick={stopRowClick}
                    >
                      <select
                        value={j.scf_payment_method ?? "-"}
                        onChange={(e) =>
                          setLocal(j.id, {
                            scf_payment_method:
                              e.target.value,
                          })
                        }
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </td>

                    <td
                      style={{ padding: 8 }}
                      onClick={stopRowClick}
                    >
                      <input
                        value={j.labor_price ?? ""}
                        onChange={(e) =>
                          setLocal(j.id, {
                            labor_price:
                              e.target.value,
                          })
                        }
                        style={{ width: 90 }}
                      />
                    </td>

                    <td
                      style={{ padding: 8 }}
                      onClick={stopRowClick}
                    >
                      <select
                        value={
                          j.labor_payment_method ??
                          "-"
                        }
                        onChange={(e) =>
                          setLocal(j.id, {
                            labor_payment_method:
                              e.target.value,
                          })
                        }
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <b>${due.toFixed(2)}</b>
                    </td>

                    <td
                      style={{ padding: 8 }}
                      onClick={stopRowClick}
                    >
                      <button
                        onClick={() => saveJob(j)}
                      >
                        Save
                      </button>{" "}
                      <button
                        onClick={() =>
                          archiveJob(j.id)
                        }
                      >
                        Archive
                      </button>{" "}
                      <button
                        onClick={() =>
                          editBlacklist(c)
                        }
                      >
                        Blacklist
                      </button>
                    </td>
                  </tr>
                );
              })}

              {debtors.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ padding: 16 }}>
                    No unpaid completed jobs 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
