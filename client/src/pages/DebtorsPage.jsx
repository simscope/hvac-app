import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const PAYMENT_METHODS = ["-", "cash", "Zelle", "card", "check", "ACH"];

const isEmptyPay = (v) =>
  v === null || v === "-" || String(v).trim() === "";

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
      const laborUnpaid = labor > 0 && isEmptyPay(j.labor_payment_method);

      return scfUnpaid || laborUnpaid;
    });
  }, [rows]);

  /* ================= LOCAL UPDATE ================= */

  const setLocal = (id, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  /* ================= SAVE ================= */

  const saveJob = async (job) => {
    setError("");

    const payload = {
      scf: job.scf,
      scf_payment_method: job.scf_payment_method,
      labor_price: job.labor_price,
      labor_payment_method: job.labor_payment_method,
      status: job.status,
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

  const toggleBlacklist = async (client) => {
    const current = client.blacklist || "";
    const reason = window.prompt(
      "Blacklist reason (empty = remove from blacklist)",
      current
    );

    if (reason === null) return;

    const { error } = await supabase
      .from("clients")
      .update({ blacklist: reason.trim() || null })
      .eq("id", client.id);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.clients?.id === client.id
          ? { ...r, clients: { ...r.clients, blacklist: reason.trim() || null } }
          : r
      )
    );
  };

  /* ================= RENDER ================= */

  return (
    <div style={{ padding: 16 }}>
      <h2>Debtors</h2>

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
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #333",
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

                return (
                  <tr
                    key={j.id}
                    style={{
                      background: blacklisted
                        ? "rgba(255,0,0,0.12)"
                        : "rgba(255,200,200,0.12)",
                    }}
                  >
                    <td style={{ padding: 8 }}>{j.job_number}</td>

                    <td style={{ padding: 8 }}>
                      <b>{c.full_name}</b>
                      <div style={{ fontSize: 12 }}>{c.company}</div>
                      {blacklisted && (
                        <div style={{ fontSize: 11, color: "#ff6b6b" }}>
                          BLACKLIST: {c.blacklist}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: 8 }}>{c.phone}</td>
                    <td style={{ padding: 8, minWidth: 240 }}>{c.address}</td>
                    <td style={{ padding: 8 }}>{j.system_type}</td>
                    <td style={{ padding: 8, minWidth: 260 }}>{j.issue}</td>

                    <td style={{ padding: 8 }}>
                      <input
                        value={j.scf ?? ""}
                        onChange={(e) =>
                          setLocal(j.id, { scf: e.target.value })
                        }
                        style={{ width: 70 }}
                      />
                    </td>

                    <td style={{ padding: 8 }}>
                      <select
                        value={j.scf_payment_method ?? "-"}
                        onChange={(e) =>
                          setLocal(j.id, {
                            scf_payment_method: e.target.value,
                          })
                        }
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <input
                        value={j.labor_price ?? ""}
                        onChange={(e) =>
                          setLocal(j.id, { labor_price: e.target.value })
                        }
                        style={{ width: 90 }}
                      />
                    </td>

                    <td style={{ padding: 8 }}>
                      <select
                        value={j.labor_payment_method ?? "-"}
                        onChange={(e) =>
                          setLocal(j.id, {
                            labor_payment_method: e.target.value,
                          })
                        }
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <input
                        value={j.status ?? ""}
                        onChange={(e) =>
                          setLocal(j.id, { status: e.target.value })
                        }
                        style={{ width: 140 }}
                      />
                    </td>

                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      <button onClick={() => saveJob(j)}>Save</button>{" "}
                      <button onClick={() => archiveJob(j.id)}>Archive</button>{" "}
                      <button onClick={() => toggleBlacklist(c)}>
                        Blacklist
                      </button>
                    </td>
                  </tr>
                );
              })}

              {debtors.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ padding: 16 }}>
                    No unpaid jobs 🎉
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
