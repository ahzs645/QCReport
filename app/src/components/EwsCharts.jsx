import React from "react";

// Dependency-free SVG plots for the EWS explorer (matches the hand-rolled
// ControlChart approach — no charting library).

const W = 540, H = 300, PAD = { l: 64, r: 16, t: 14, b: 42 };
const ix = (PAD.l), iw = (W - PAD.l - PAD.r), iy = PAD.t, ih = (H - PAD.t - PAD.b);
const fmt = (v) => (v === 0 ? "0" : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? v.toExponential(1) : v.toPrecision(3));

function axes(xMin, xMax, yMin, yMax, xLabel, yLabel) {
  const sx = (x) => ix + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const sy = (y) => iy + ih - ((y - yMin) / (yMax - yMin || 1)) * ih;
  const ticks = (min, max) => Array.from({ length: 5 }, (_, i) => min + (i / 4) * (max - min));
  return { sx, sy, xTicks: ticks(xMin, xMax), yTicks: ticks(yMin, yMax), xLabel, yLabel };
}

function Frame({ ax, children }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}>
      {ax.yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={ix} y1={ax.sy(t)} x2={ix + iw} y2={ax.sy(t)} stroke="var(--border)" strokeDasharray="3 3" />
          <text x={ix - 8} y={ax.sy(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(t)}</text>
        </g>
      ))}
      {ax.xTicks.map((t, i) => (
        <text key={`x${i}`} x={ax.sx(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">{fmt(t)}</text>
      ))}
      <text x={ix + iw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text)">{ax.xLabel}</text>
      <text x={14} y={iy + ih / 2} textAnchor="middle" fontSize="11" fill="var(--text)" transform={`rotate(-90 14 ${iy + ih / 2})`}>{ax.yLabel}</text>
      {children}
    </svg>
  );
}

export function CalibrationPlot({ curve }) {
  const xs = curve.points.map((p) => p.conc), ys = curve.points.map((p) => p.intensity);
  const ax = axes(0, Math.max(...xs) * 1.05 || 1, 0, Math.max(...ys) * 1.05 || 1, "concentration (mg/L)", "intensity (cps)");
  const fit = curve.fit;
  return (
    <Frame ax={ax}>
      {fit && (
        <line
          x1={ax.sx(0)} y1={ax.sy(fit.intercept)}
          x2={ax.sx(Math.max(...xs))} y2={ax.sy(fit.slope * Math.max(...xs) + fit.intercept)}
          stroke="var(--accent)" strokeWidth="1.5"
        />
      )}
      {curve.points.map((p, i) => (
        <circle key={i} cx={ax.sx(p.conc)} cy={ax.sy(p.intensity)} r="3.5" fill="var(--accent)" fillOpacity="0.55" stroke="var(--accent)">
          <title>{`${p.standard}: ${p.conc} mg/L → ${p.intensity.toFixed(0)} cps`}</title>
        </circle>
      ))}
      {fit && <text x={ix + 10} y={iy + 14} fontSize="11" fill="var(--text)">R² = {fit.r2.toFixed(5)}</text>}
    </Frame>
  );
}

export function SpectrumPlot({ line }) {
  const xs = line.wavelengths, ys = line.counts;
  const ax = axes(Math.min(...xs), Math.max(...xs), Math.min(...ys, 0), Math.max(...ys) * 1.05 || 1, "wavelength (nm)", "intensity (cps)");
  const path = xs.map((x, i) => `${i ? "L" : "M"}${ax.sx(x).toFixed(1)},${ax.sy(ys[i]).toFixed(1)}`).join(" ");
  return (
    <Frame ax={ax}>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {xs.map((x, i) => (
        <circle key={i} cx={ax.sx(x)} cy={ax.sy(ys[i])} r="2" fill="var(--accent)">
          <title>{`${x.toFixed(3)} nm → ${ys[i].toFixed(0)} cps`}</title>
        </circle>
      ))}
    </Frame>
  );
}
