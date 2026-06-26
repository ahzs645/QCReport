import { useEffect, useMemo, useRef, useState } from "react";
import { ControlChartSvg } from "./ControlChartSvg.jsx";

/**
 * Shewhart control-chart shell: the SVG plot + a stats side-panel + a sortable
 * data table, with chart↔table selection linked by a stable point id. PURE:
 * `series` is buildSeries() output. (The "rich"/Recharts variant from the
 * standalone app is intentionally omitted so this library carries no chart dep.)
 */

const t = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const fmtDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime())
    ? String(d ?? "")
    : dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const num = (v, n = 4) => (typeof v === "number" ? v.toFixed(n) : "—");

function Stats({ series }) {
  const { stats, limits, criterion, acceptedValue } = series;
  return (
    <div className="cc-side">
      <div><span>Mean</span><b>{num(stats.mean)}</b></div>
      <div><span>Standard Deviation</span><b>{num(stats.std)}</b></div>
      <div><span>Upper Control Limit (1)</span><b>{num(limits.sigma1.upper)}</b></div>
      <div><span>Lower Control Limit (1)</span><b>{num(limits.sigma1.lower)}</b></div>
      <div><span>Upper Control Limit (2)</span><b>{num(limits.sigma2.upper)}</b></div>
      <div><span>Lower Control Limit (2)</span><b>{num(limits.sigma2.lower)}</b></div>
      <div><span>Upper Control Limit (3)</span><b>{num(limits.sigma3.upper)}</b></div>
      <div><span>Lower Control Limit (3)</span><b>{num(limits.sigma3.lower)}</b></div>
      <div className="sep"><span>Performance Criteria (%)</span><b>{criterion ?? "—"}</b></div>
      <div><span>Accepted Value (mg/L)</span><b>{acceptedValue ?? "—"}</b></div>
    </div>
  );
}

const SORT_VAL = {
  date: (p) => t(p.date),
  value: (p) => (typeof p.value === "number" ? p.value : -Infinity),
  rpd: (p) => (typeof p.rpd === "number" ? p.rpd : -Infinity),
  performance: (p) => p.performance || "",
};

export function ControlChart({ series, title, showLine = false }) {
  const { points, limits } = series;
  const [selected, setSelected] = useState(null); // stable point id (index in series.points)
  const [sort, setSort] = useState({ key: "date", dir: "asc" });
  const scrollRef = useRef(null);

  // Stable id per point so chart markers and table rows stay linked across sorting.
  const indexed = useMemo(() => points.map((p, i) => ({ ...p, id: i })), [points]);
  const sortedRows = useMemo(() => {
    const get = SORT_VAL[sort.key] || (() => 0);
    return [...indexed].sort((a, b) => {
      const va = get(a), vb = get(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.dir === "asc" ? c : -c;
    });
  }, [indexed, sort]);

  useEffect(() => {
    if (selected == null || !scrollRef.current) return;
    scrollRef.current.querySelector(`tr[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  if (!points.length || !limits) return <p className="hint">No data in the selected period.</p>;

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const sortable = (key, label) => <th className="sortable" onClick={() => toggleSort(key)}>{label}{arrow(key)}</th>;

  return (
    <div className="control-chart">
      {title && <h3>{title}</h3>}
      <div className="cc-top">
        <ControlChartSvg series={series} points={indexed} showLine={showLine} selected={selected} onSelect={setSelected} />
        <Stats series={series} />
      </div>

      <p className="hint cc-tablehint">Click a header to sort · click a point or a row to locate it.</p>
      <div className="cc-table-scroll" ref={scrollRef}>
        <table className="cc-table">
          <thead>
            <tr>
              {sortable("date", "Date")}
              {sortable("value", "Measured")}
              <th>Control Line</th>
              <th>UCL (K=1)</th><th>LCL (K=1)</th>
              <th>UCL (K=2)</th><th>LCL (K=2)</th>
              <th>UCL (K=3)</th><th>LCL (K=3)</th>
              {sortable("rpd", "RPD (%)")}
              {sortable("performance", "Performance")}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((p) => (
              <tr
                key={p.id}
                data-id={p.id}
                className={`${p.performance === "FAIL" ? "row-fail" : ""}${p.id === selected ? " row-selected" : ""}`}
                onClick={() => setSelected(p.id)}
                style={{ cursor: "pointer" }}
              >
                <td>{fmtDate(p.date)}</td>
                <td>{num(p.value)}</td>
                <td>{num(limits.center)}</td>
                <td>{num(limits.sigma1.upper)}</td><td>{num(limits.sigma1.lower)}</td>
                <td>{num(limits.sigma2.upper)}</td><td>{num(limits.sigma2.lower)}</td>
                <td>{num(limits.sigma3.upper)}</td><td>{num(limits.sigma3.lower)}</td>
                <td>{num(p.rpd, 2)}</td>
                <td className={p.performance === "FAIL" ? "perf-fail" : "perf-pass"}>{p.performance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
