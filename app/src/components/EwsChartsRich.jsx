import React from "react";
import {
  CartesianGrid, ComposedChart, Label, Line, LineChart, ResponsiveContainer,
  Scatter, Tooltip, XAxis, YAxis,
} from "recharts";

// Recharts implementations of the EWS plots, with the SAME props as the
// hand-rolled EwsCharts.jsx so the two are interchangeable behind the chart-style
// toggle. Theme colors mirror styles.css.
const ACCENT = "#0b6e4f", TEXT = "#1f2328", MUTED = "#656d76", BORDER = "#d8dee4";
const H = 300, MAXW = 560;
const axisLabel = (value, position) => <Label value={value} position={position} fill={TEXT} fontSize={11} />;
const tickStyle = { fill: MUTED, fontSize: 10 };
const numFmt = (v) => (v === 0 ? "0" : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? v.toExponential(1) : v.toPrecision(3));

function Wrap({ children }) {
  return (
    <div style={{ width: "100%", maxWidth: MAXW, height: H, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 8px 4px" }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

export function CalibrationPlot({ curve }) {
  const fit = curve.fit;
  const data = curve.points.map((p) => ({ conc: p.conc, intensity: p.intensity, standard: p.standard, fit: fit ? fit.slope * p.conc + fit.intercept : null }));
  return (
    <Wrap>
      <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 28, left: 16 }}>
        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="conc" tick={tickStyle} tickFormatter={numFmt} stroke={BORDER} domain={[0, "dataMax"]}>
          {axisLabel("concentration (mg/L)", "bottom")}
        </XAxis>
        <YAxis tick={tickStyle} tickFormatter={numFmt} stroke={BORDER} width={56}>
          {axisLabel("intensity (cps)", "left")}
        </YAxis>
        <Tooltip
          formatter={(v, name) => [Number(v).toFixed(0), name === "fit" ? "fit" : "cps"]}
          labelFormatter={(l) => `${l} mg/L`}
          contentStyle={{ fontSize: 12, borderColor: BORDER }}
        />
        {fit && <Line type="linear" dataKey="fit" stroke={ACCENT} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
        <Scatter dataKey="intensity" fill={ACCENT} fillOpacity={0.55} stroke={ACCENT} isAnimationActive={false} />
      </ComposedChart>
    </Wrap>
  );
}

export function SpectrumPlot({ line }) {
  const data = line.wavelengths.map((w, i) => ({ w, c: line.counts[i] }));
  return (
    <Wrap>
      <LineChart data={data} margin={{ top: 16, right: 16, bottom: 28, left: 16 }}>
        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="w" tick={tickStyle} tickFormatter={(v) => v.toFixed(2)} stroke={BORDER} domain={["dataMin", "dataMax"]}>
          {axisLabel("wavelength (nm)", "bottom")}
        </XAxis>
        <YAxis tick={tickStyle} tickFormatter={numFmt} stroke={BORDER} width={56}>
          {axisLabel("intensity (cps)", "left")}
        </YAxis>
        <Tooltip
          formatter={(v) => [Number(v).toFixed(0), "cps"]}
          labelFormatter={(l) => `${Number(l).toFixed(3)} nm`}
          contentStyle={{ fontSize: 12, borderColor: BORDER }}
        />
        <Line type="monotone" dataKey="c" stroke={ACCENT} strokeWidth={1.5} dot={{ r: 2, fill: ACCENT }} isAnimationActive={false} />
      </LineChart>
    </Wrap>
  );
}
