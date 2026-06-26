import { useMemo, useState } from "react";

/**
 * Adjusted-vs-unadjusted dilution comparison. PURE: `rows` are pre-computed
 * (the caller runs the engine's adjustedVsUnadjusted), each
 * { id, sample, analyte, adjusted, unadjusted, diff, ratio }. `reportableAnalytes`
 * is the set of analyte labels to keep when "reportable only" is on.
 */

const fmt = (v, n = 4) =>
  typeof v === "number" ? v.toFixed(n) : v === null || v === undefined ? "—" : String(v);

const SORT = {
  sample: (r) => r.sample?.toLowerCase() || "",
  analyte: (r) => r.analyte?.toLowerCase() || "",
  adjusted: (r) => (typeof r.adjusted === "number" ? r.adjusted : -Infinity),
  unadjusted: (r) => (typeof r.unadjusted === "number" ? r.unadjusted : -Infinity),
  diff: (r) => (typeof r.diff === "number" ? Math.abs(r.diff) : -Infinity),
  ratio: (r) => (typeof r.ratio === "number" ? r.ratio : -Infinity),
};

export function AdjUnadjPanel({ rows: all = [], reportableAnalytes = [] }) {
  const [sort, setSort] = useState({ key: "ratio", dir: "desc" });
  const [reportableOnly, setReportableOnly] = useState(true);
  const reportableSet = useMemo(() => new Set(reportableAnalytes), [reportableAnalytes]);
  const hasReportable = reportableSet.size > 0;

  const dilutedCount = useMemo(
    () => all.filter((r) => typeof r.ratio === "number" && Math.abs(r.ratio - 1) > 0.02).length,
    [all],
  );

  const rows = useMemo(() => {
    const get = SORT[sort.key] || (() => 0);
    return all
      .filter((r) => !reportableOnly || !hasReportable || reportableSet.has(r.analyte))
      .sort((a, b) => {
        const c = get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0;
        return sort.dir === "asc" ? c : -c;
      });
  }, [all, sort, reportableOnly, reportableSet, hasReportable]);

  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const th = (key, label) => (
    <th className="sortable" onClick={() => toggle(key)}>{label}{arrow(key)}</th>
  );

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
