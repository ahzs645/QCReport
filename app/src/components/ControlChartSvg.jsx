import React from "react";

// Classic hand-rolled SVG Shewhart plot. Props are shared with ControlChartRich
// so the two are interchangeable behind the chart-style toggle. The selection
// state, stats panel, and table live in the ControlChart shell.

const W = 900, H = 360;
const M = { top: 18, right: 150, bottom: 64, left: 64 };
const COLORS = { center: "#7a7a7a", k1: "#2e8b57", k2: "#e8a33d", k3: "#e23b32" };
const t = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const num = (v, n = 4) => (typeof v === "number" ? v.toFixed(n) : "—");
const fmtDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d ?? "") : dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

export default function ControlChartSvg({ series, points, showLine, selected, onSelect }) {
  const { limits } = series;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const times = points.map((p) => t(p.date)).filter((n) => !Number.isNaN(n));
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const x = (d) => {
    const tt = t(d);
    if (Number.isNaN(tt) || tMax === tMin) return M.left + plotW / 2;
    return M.left + ((tt - tMin) / (tMax - tMin)) * plotW;
  };
  const ys = [limits.sigma3.upper, limits.sigma3.lower, series.acceptedValue, ...points.map((p) => p.value)].filter((v) => typeof v === "number");
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.1 || 0.01;
  const y = (v) => M.top + plotH - ((v - (yMin - pad)) / (yMax + pad - (yMin - pad))) * plotH;

  const hline = (val, color, dash, key) =>
    typeof val === "number" ? <line key={key} x1={M.left} x2={M.left + plotW} y1={y(val)} y2={y(val)} stroke={color} strokeDasharray={dash} strokeWidth="1.5" /> : null;

  const ticks = 8;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / ticks);
  const legend = [
    ["Measured Value", "square", "#111"],
    ["Control Line", "line", COLORS.center],
    ["±1σ (K=1)", "dash", COLORS.k1],
    ["±2σ (K=2)", "dash", COLORS.k2],
    ["±3σ (K=3)", "dash", COLORS.k3],
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet">
      {hline(limits.sigma3.upper, COLORS.k3, "8 5", "u3")}
      {hline(limits.sigma3.lower, COLORS.k3, "8 5", "l3")}
      {hline(limits.sigma2.upper, COLORS.k2, "8 5", "u2")}
      {hline(limits.sigma2.lower, COLORS.k2, "8 5", "l2")}
      {hline(limits.sigma1.upper, COLORS.k1, "6 5", "u1")}
      {hline(limits.sigma1.lower, COLORS.k1, "6 5", "l1")}
      {hline(limits.center, COLORS.center, "", "c")}

      {showLine && <polyline points={points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")} fill="none" stroke="#9aa7b1" strokeWidth="1" />}

      {points.map((p) => {
        const isSel = p.id === selected;
        return (
          <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }}>
            {isSel && <circle cx={x(p.date)} cy={y(p.value)} r="8" fill="none" stroke="#0b6e4f" strokeWidth="2" />}
            <rect x={x(p.date) - 3} y={y(p.value) - 3} width="6" height="6" fill={p.isNew ? "#0b6e4f" : "#111"} stroke={p.isNew ? "#000" : "none"} strokeWidth={p.isNew ? 1.5 : 0}>
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
        const lx = M.left + i * 150, ly = H - 8;
        return (
          <g key={txt}>
            {kind === "square"
              ? <rect x={lx} y={ly - 7} width="7" height="7" fill={color} />
              : <line x1={lx} x2={lx + 16} y1={ly - 3} y2={ly - 3} stroke={color} strokeWidth="2" strokeDasharray={kind === "dash" ? "5 3" : ""} />}
            <text x={lx + (kind === "square" ? 11 : 20)} y={ly} fontSize="9.5" fill="#333">{txt}</text>
          </g>
        );
      })}
    </svg>
  );
}
