import { useMemo, useState } from "react";

/**
 * Quality Check panel — blank / recovery / RPD pass-fail per analyte, as cards
 * (summary) or a sortable matrix (like the Excel SUMMARY TABLE).
 *
 * PURE / presentational: renders from props only, no engine import. Each result
 * must carry a pre-normalized `norm` label (used by the "reportable only" filter);
 * `reportableAnalytes` is the set of normalized reportable labels. The caller
 * (its data-prep / bridge) owns all computation.
 */

const fmt = (v) => (typeof v === "number" ? v.toFixed(1) : v ?? "");

// Short column labels for the matrix view, keyed by QC role key.
const SHORT = {
  ipcBlank: "IPC Blank",
  ccvCalib: "CCV (cal)",
  ccvBatch: "CCV (batch)",
  lrb: "LRB",
  digestLfb: "Digest LFB",
  duplicate: "RPD",
  lfmSpike: "LFM",
  instLfb: "Inst. LFB",
  interference: "Interf.",
  icv: "ICV",
};

function cellText(check, r) {
  if (!r) return "";
  if (check.kind === "blank") return r.status;
  if (check.kind === "rpd") return r.metric === null ? r.unit || "" : `${fmt(r.metric)}`;
  return r.metric === null ? "" : `${fmt(r.metric)}`; // recovery %
}
const statusClass = (s) => (s === "PASS" ? "qc-in" : s === "FAIL" ? "qc-out" : "");

function CheckCard({ check }) {
  const [open, setOpen] = useState(false);
  const scored = check.results.filter((r) => r.status === "PASS" || r.status === "FAIL");
  const fails = scored.filter((r) => r.status === "FAIL");
  const allPass = fails.length === 0 && scored.length > 0;
  return (
    <div className={`qc-card ${fails.length ? "has-fail" : "all-pass"}`}>
      <div className="qc-head" onClick={() => setOpen((o) => !o)}>
        <span className="qc-role">{check.role}</span>
        <span className="qc-kind">{check.kind}</span>
        <span className={`qc-badge ${allPass ? "pass" : fails.length ? "fail" : "na"}`}>
          {scored.length ? `${scored.length - fails.length}/${scored.length} pass` : "n/a"}
        </span>
      </div>
      {fails.length > 0 && (
        <ul className="qc-fails">
          {fails.map((r) => (
            <li key={r.analyte}>
              <b>{r.analyte}</b> — {r.unit === undefined || r.unit === "%recovery" ? `${fmt(r.metric)}% recovery` : String(r.reportable)}{" "}
              <span className="fail-tag">FAIL</span>
              {r.note && <span className="qc-note"> — {r.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <table className="qc-detail">
          <thead>
            <tr><th>Analyte</th><th>Reportable</th><th>Metric</th><th>Status</th></tr>
          </thead>
          <tbody>
            {check.results.map((r) => (
              <tr key={r.analyte} className={r.status === "FAIL" ? "row-fail" : ""}>
                <td>{r.analyte}</td>
                <td>{String(r.reportable)}</td>
                <td>{r.metric === null ? r.unit || "" : `${fmt(r.metric)} ${r.unit || ""}`}{r.note ? ` — ${r.note}` : ""}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QcTable({ checks }) {
  const [sort, setSort] = useState({ key: "analyte", dir: "asc" });
  const baseOrder = (checks.find((c) => c.results.length)?.results || []).map((r) => r.analyte);
  const byCheck = checks.map((c) => ({ check: c, map: new Map(c.results.map((r) => [r.analyte, r])) }));
  const checkByKey = new Map(byCheck.map((b) => [b.check.key, b]));

  const sortVal = (a) => {
    if (sort.key === "analyte") return a.toLowerCase();
    const b = checkByKey.get(sort.key);
    const r = b?.map.get(a);
    if (!r) return -Infinity;
    if (b.check.kind === "blank") return r.status === "FAIL" ? 2 : r.status === "PASS" ? 1 : 0;
    return typeof r.metric === "number" ? r.metric : -Infinity;
  };
  const analytes = [...baseOrder].sort((x, y) => {
    const vx = sortVal(x);
    const vy = sortVal(y);
    const c = vx < vy ? -1 : vx > vy ? 1 : 0;
    return sort.dir === "asc" ? c : -c;
  });

  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="table-scroll">
      <table className="qc-matrix">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggle("analyte")}>Analyte{arrow("analyte")}</th>
            {byCheck.map(({ check }) => (
              <th key={check.key} className="sortable" title={`${check.role} — ${check.kind} (click to sort)`} onClick={() => toggle(check.key)}>
                {SHORT[check.key] || check.key}{arrow(check.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analytes.map((a) => (
            <tr key={a}>
              <td className="analyte">{a}</td>
              {byCheck.map(({ check, map }) => {
                const r = map.get(a);
                return (
                  <td key={check.key} className={r ? statusClass(r.status) : ""} title={r?.note || undefined}>
                    {cellText(check, r)}{r?.note ? " *" : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QcPanel({ qc, reportableAnalytes = [] }) {
  const [mode, setMode] = useState("cards");
  const [reportableOnly, setReportableOnly] = useState(true);

  const reportableSet = useMemo(() => new Set(reportableAnalytes), [reportableAnalytes]);
  const hasReportable = reportableSet.size > 0;

  // Keep only reportable elements when the toggle is on (matched on each result's
  // pre-normalized `norm`), and recompute the pass/fail summary from what's shown.
  const view = useMemo(() => {
    const checks = qc?.checks || [];
    const keep = (norm) => !reportableOnly || !hasReportable || reportableSet.has(norm);
    const filtered = checks.map((c) => ({ ...c, results: c.results.filter((r) => keep(r.norm)) }));
    const scored = filtered.flatMap((c) => c.results);
    const pass = scored.filter((r) => r.status === "PASS").length;
    const fail = scored.filter((r) => r.status === "FAIL").length;
    return { checks: filtered, summary: { pass, fail } };
  }, [qc, reportableOnly, reportableSet, hasReportable]);

  if (!qc?.checks?.length) {
    return (
      <section className="qc-section">
        <h2>Quality Check</h2>
        <p className="hint">No QC rows matched the raw run.</p>
      </section>
    );
  }
  const { pass, fail } = view.summary;

  return (
    <section className="qc-section">
      <h2>
        Quality Check{" "}
        <span className={`summary-pill ${fail ? "fail" : "pass"}`}>{pass} pass · {fail} fail</span>
      </h2>
      <div className="qc-modebar">
        <span className="hint">Equations computed in code (blank below-RL, recovery = measured / true × 100, RPD).</span>
        <div className="qc-controls-right">
          {hasReportable && (
            <label className="toggle" title="Hide secondary/non-spiked wavelengths that aren't in the report">
              <input type="checkbox" checked={reportableOnly} onChange={(e) => setReportableOnly(e.target.checked)} />{" "}
              Reportable elements only ({reportableSet.size})
            </label>
          )}
          <div className="seg">
            <button className={mode === "cards" ? "on" : ""} onClick={() => setMode("cards")}>Cards</button>
            <button className={mode === "table" ? "on" : ""} onClick={() => setMode("table")}>Table</button>
          </div>
        </div>
      </div>
      {mode === "cards" ? (
        <div className="qc-grid">
          {view.checks.map((c) => <CheckCard key={c.key} check={c} />)}
        </div>
      ) : (
        <QcTable checks={view.checks} />
      )}
    </section>
  );
}
