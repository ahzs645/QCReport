import React, { useMemo, useState } from "react";
import { adjustedVsUnadjusted } from "../../../scripts/lib/report-compute.mjs";
import { normalizeAnalyteLabel } from "../../../scripts/lib/raw-parsers/normalize.mjs";

const fmt = (v, n = 4) => (typeof v === "number" ? v.toFixed(n) : v === null || v === undefined ? "—" : String(v));
const SORT = {
  sample: (r) => r.sample?.toLowerCase() || "",
  analyte: (r) => r.analyte?.toLowerCase() || "",
  adjusted: (r) => (typeof r.adjusted === "number" ? r.adjusted : -Infinity),
  unadjusted: (r) => (typeof r.unadjusted === "number" ? r.unadjusted : -Infinity),
  diff: (r) => (typeof r.diff === "number" ? Math.abs(r.diff) : -Infinity),
  ratio: (r) => (typeof r.ratio === "number" ? r.ratio : -Infinity),
};

export default function AdjUnadjPanel({ adjusted, unadjusted, samples, reportableAnalytes = [] }) {
  const [sort, setSort] = useState({ key: "ratio", dir: "desc" });
  const [reportableOnly, setReportableOnly] = useState(true);
  const reportableSet = useMemo(() => new Set(reportableAnalytes), [reportableAnalytes]);
  const hasReportable = reportableSet.size > 0;

  // Compare every sample row in the run (NALS-id rows, including dilution reruns),
  // not just the reported roster — that's how the run is checked for differences.
  // Prefer reported friendly names where the row matches a roster sample.
  const runSamples = useMemo(() => {
    const nameById = new Map((samples || []).map((s) => [s.id, s.name]));
    return (adjusted?.rows || [])
      .filter((r) => /\d{4}\s*nals\s*\d+/i.test(r.label))
      .map((r) => ({ id: r.label, name: nameById.get(r.label) || r.label }));
  }, [adjusted, samples]);

  const all = useMemo(() => adjustedVsUnadjusted(adjusted, unadjusted, runSamples), [adjusted, unadjusted, runSamples]);
  const dilutedCount = useMemo(() => all.filter((r) => typeof r.ratio === "number" && Math.abs(r.ratio - 1) > 0.02).length, [all]);

  const rows = useMemo(() => {
    const get = SORT[sort.key] || (() => 0);
    return all
      .filter((r) => !reportableOnly || !hasReportable || reportableSet.has(normalizeAnalyteLabel(r.analyte)))
      .sort((a, b) => {
        const c = get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0;
        return sort.dir === "asc" ? c : -c;
      });
  }, [all, sort, reportableOnly, reportableSet, hasReportable]);

  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const th = (key, label) => <th className="sortable" onClick={() => toggle(key)}>{label}{arrow(key)}</th>;

  if (!all.length) return <p className="hint">No adjusted/unadjusted data for the matched samples.</p>;

  return (
    <div className="adjunadj">
      <p className="hint">
        adjusted = unadjusted × total dilution. Ratio ≈ 1 means no dilution; a higher ratio is the
        applied dilution factor (should be consistent across a sample's analytes).
        {dilutedCount === 0 && " — this run shows no differences (adjusted = unadjusted)."}
      </p>
      {hasReportable && (
        <label className="toggle" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={reportableOnly} onChange={(e) => setReportableOnly(e.target.checked)} />{" "}
          Reportable elements only ({reportableSet.size})
        </label>
      )}
      <div className="table-scroll" style={{ maxHeight: 420 }}>
        <table className="cc-table">
          <thead>
            <tr>
              {th("sample", "Sample")}
              {th("analyte", "Analyte")}
              {th("adjusted", "Adjusted")}
              {th("unadjusted", "Unadjusted")}
              {th("diff", "Difference")}
              {th("ratio", "Ratio (×)")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const diluted = typeof r.ratio === "number" && Math.abs(r.ratio - 1) > 0.02;
              return (
                <tr key={i} className={diluted ? "row-diluted" : ""}>
                  <td title={r.id}>{r.sample}</td>
                  <td>{r.analyte}</td>
                  <td>{fmt(r.adjusted)}</td>
                  <td>{fmt(r.unadjusted)}</td>
                  <td>{fmt(r.diff)}</td>
                  <td>{typeof r.ratio === "number" ? `${r.ratio.toFixed(2)}×` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
