import React, { useMemo } from "react";
import {
  ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter,
  Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

// Recharts Shewhart plot — same props as ControlChartSvg (interchangeable behind
// the chart-style toggle). Control limits are ReferenceLines; measured points are
// a Scatter with a custom square marker (green if new) and a selection ring.

const COLORS = { center: "#7a7a7a", k1: "#2e8b57", k2: "#e8a33d", k3: "#e23b32", text: "#1f2328", muted: "#656d76", border: "#d8dee4", accent: "#0b6e4f" };
const tms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const num = (v, n = 4) => (typeof v === "number" ? v.toFixed(n) : "—");
const fmtShort = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d ?? "") : dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

export default function ControlChartRich({ series, points, showLine, selected, onSelect }) {
  const { limits } = series;
  const data = useMemo(
    () => points.map((p) => ({ ...p, t: tms(p.date) })).filter((p) => !Number.isNaN(p.t)).sort((a, b) => a.t - b.t),
    [points],
  );
  const ys = [limits.sigma3.upper, limits.sigma3.lower, series.acceptedValue, ...points.map((p) => p.value)].filter((v) => typeof v === "number");
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.1 || 0.01;

  const Marker = (props) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const sel = payload.id === selected;
    return (
      <g style={{ cursor: "pointer" }} onClick={() => onSelect(payload.id)}>
        {sel && <circle cx={cx} cy={cy} r={8} fill="none" stroke={COLORS.accent} strokeWidth={2} />}
        <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={payload.isNew ? COLORS.accent : "#111"} stroke={payload.isNew ? "#000" : "none"} strokeWidth={payload.isNew ? 1 : 0} />
      </g>
    );
  };

  const Tip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{ background: "var(--card)", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 9px", fontSize: 12 }}>
        <b>{fmtLong(p.date)}</b><br />
        value {num(p.value)}<br />
        RPD {num(p.rpd, 2)}% · <span style={{ color: p.performance === "FAIL" ? COLORS.k3 : COLORS.k1 }}>{p.performance}</span>{p.isNew ? " · new" : ""}
      </div>
    );
  };

  const limitLine = (val, color, dash, label) =>
    typeof val === "number" ? <ReferenceLine y={val} stroke={color} strokeDasharray={dash} strokeWidth={1.3} label={{ value: label, position: "right", fill: color, fontSize: 9 }} /> : null;

  return (
    <div style={{ flex: "1 1 560px", minWidth: 420, height: 360 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 56, bottom: 24, left: 8 }}>
          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
          <XAxis type="number" dataKey="t" domain={["dataMin", "dataMax"]} tickFormatter={fmtShort} tick={{ fill: COLORS.muted, fontSize: 10 }} stroke={COLORS.border} tickCount={8} />
          <YAxis type="number" domain={[yMin - pad, yMax + pad]} tickFormatter={(v) => v.toFixed(4)} tick={{ fill: COLORS.muted, fontSize: 10 }} stroke={COLORS.border} width={64} />
          <Tooltip content={<Tip />} />
          {limitLine(limits.sigma3.upper, COLORS.k3, "8 5", "+3σ")}
          {limitLine(limits.sigma3.lower, COLORS.k3, "8 5", "−3σ")}
          {limitLine(limits.sigma2.upper, COLORS.k2, "8 5", "+2σ")}
          {limitLine(limits.sigma2.lower, COLORS.k2, "8 5", "−2σ")}
          {limitLine(limits.sigma1.upper, COLORS.k1, "6 5", "+1σ")}
          {limitLine(limits.sigma1.lower, COLORS.k1, "6 5", "−1σ")}
          {limitLine(limits.center, COLORS.center, "", "CL")}
          {showLine && <Line type="linear" dataKey="value" stroke="#9aa7b1" strokeWidth={1} dot={false} isAnimationActive={false} legendType="none" />}
          <Scatter dataKey="value" shape={<Marker />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
