import React, { useEffect, useMemo, useRef, useState } from "react";

const W = 900;
const H = 360;
const M = { top: 18, right: 150, bottom: 64, left: 64 };
const COLORS = { center: "#7a7a7a", k1: "#2e8b57", k2: "#e8a33d", k3: "#e23b32" };

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

export default function ControlChart({ series, title, showLine = false }) {
  const { points, limits, stats } = series;
  const [selected, setSelected] = useState(null); // stable point id (index in series.points)
  const [sort, setSort] = useState({ key: "date", dir: "asc" });
  const scrollRef = useRef(null);

  // Stable id per point so chart markers and table rows stay linked across sorting.
  const indexed = useMemo(() => points.map((p, i) => ({ ...p, id: i })), [points]);
  const sortedRows = useMemo(() => {
    const get = SORT_VAL[sort.key] || (() => 0);
    const arr = [...indexed].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.dir === "asc" ? c : -c;
    });
    return arr;
  }, [indexed, sort]);

  useEffect(() => {
    if (selected == null || !scrollRef.current) return;
    scrollRef.current.querySelector(`tr[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  if (!points.length || !limits) return <p className="hint">No data in the selected period.</p>;

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const times = indexed.map((p) => t(p.date)).filter((n) => !Number.isNaN(n));
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const x = (d) => {
    const tt = t(d);
    if (Number.isNaN(tt) || tMax === tMin) return M.left + plotW / 2;
    return M.left + ((tt - tMin) / (tMax - tMin)) * plotW;
  };
  const ys = [limits.sigma3.upper, limits.sigma3.lower, series.acceptedValue, ...points.map((p) => p.value)].filter(
    (v) => typeof v === "number",
  );
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.1 || 0.01;
  const y = (v) => M.top + plotH - ((v - (yMin - pad)) / (yMax + pad - (yMin - pad))) * plotH;

  const hline = (val, color, dash, key) =>
    typeof val === "number" ? (
      <line key={key} x1={M.left} x2={M.left + plotW} y1={y(val)} y2={y(val)} stroke={color} strokeDasharray={dash} strokeWidth="1.5" />
    ) : null;

  const ticks = 8;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / ticks);
  const legend = [
    ["Measured Value", "square", "#111"],
    ["Control Line", "line", COLORS.center],
    ["±1σ (K=1)", "dash", COLORS.k1],
    ["±2σ (K=2)", "dash", COLORS.k2],
    ["±3σ (K=3)", "dash", COLORS.k3],
  ];

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const sortable = (key, label) => (
    <th className="sortable" onClick={() => toggleSort(key)}>{label}{arrow(key)}</th>
  );

  return (
    <div className="control-chart">
      {title && <h3>{title}</h3>}
      <div className="cc-top">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet">
          {hline(limits.sigma3.upper, COLORS.k3, "8 5", "u3")}
          {hline(limits.sigma3.lower, COLORS.k3, "8 5", "l3")}
          {hline(limits.sigma2.upper, COLORS.k2, "8 5", "u2")}
          {hline(limits.sigma2.lower, COLORS.k2, "8 5", "l2")}
          {hline(limits.sigma1.upper, COLORS.k1, "6 5", "u1")}
          {hline(limits.sigma1.lower, COLORS.k1, "6 5", "l1")}
          {hline(limits.center, COLORS.center, "", "c")}

          {showLine && (
            <polyline points={indexed.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")} fill="none" stroke="#9aa7b1" strokeWidth="1" />
          )}

          {indexed.map((p) => {
            const isSel = p.id === selected;
            return (
              <g key={p.id} onClick={() => setSelected(p.id)} style={{ cursor: "pointer" }}>
                {isSel && <circle cx={x(p.date)} cy={y(p.value)} r="8" fill="none" stroke="#0b6e4f" strokeWidth="2" />}
                <rect
                  x={x(p.date) - 3}
                  y={y(p.value) - 3}
                  width="6"
                  height="6"
                  fill={p.isNew ? "#0b6e4f" : "#111"}
                  stroke={p.isNew ? "#000" : "none"}
                  strokeWidth={p.isNew ? 1.5 : 0}
                >
                  <title>{`${fmtDate(p.date)} — ${p.value}\nRPD ${num(p.rpd, 2)}% · ${p.performance}${p.isNew ? " [new]" : ""}`}</title>
                </rect>
              </g>
            );
          })}

          <text x={M.left - 8} y={y(yMax) + 3} fontSize="10" fill="#656d76" textAnchor="end">{yMax.toFixed(4)}</text>
          <text x={M.left - 8} y={y(yMin) + 3} fontSize="10" fill="#656d76" textAnchor="end">{yMin.toFixed(4)}</text>

          {tickVals.map((tv, i) => (
            <text key={i} x={x(tv)} y={H - M.bottom + 14} fontSize="9" fill="#656d76" textAnchor="end" transform={`rotate(-40 ${x(tv)} ${H - M.bottom + 14})`}>
              {new Date(tv).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </text>
          ))}

          {legend.map(([txt, kind, color], i) => {
            const lx = M.left + i * 150;
            const ly = H - 8;
            return (
              <g key={txt}>
                {kind === "square" ? (
                  <rect x={lx} y={ly - 7} width="7" height="7" fill={color} />
                ) : (
                  <line x1={lx} x2={lx + 16} y1={ly - 3} y2={ly - 3} stroke={color} strokeWidth="2" strokeDasharray={kind === "dash" ? "5 3" : ""} />
                )}
                <text x={lx + (kind === "square" ? 11 : 20)} y={ly} fontSize="9.5" fill="#333">{txt}</text>
              </g>
            );
          })}
        </svg>
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
