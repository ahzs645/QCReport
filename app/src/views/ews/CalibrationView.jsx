import React, { Suspense, useEffect, useMemo, useState } from "react";
import { calibration } from "../../core/esws.js";
import { getCharts } from "../../components/charts.js";

export default function CalibrationView({ session, chartStyle }) {
  const { CalibrationPlot } = getCharts(chartStyle);
  const [curves, setCurves] = useState(null);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    calibration(session)
      .then((c) => { if (!cancelled) { setCurves(c); setSel(c.find((x) => /ca 317/i.test(x.key))?.key || c[0]?.key); } })
      .catch((e) => !cancelled && setError(e.message || String(e)));
    return () => { cancelled = true; };
  }, [session]);

  const curve = useMemo(() => curves?.find((c) => c.key === sel), [curves, sel]);

  if (error) return <div className="error">⚠ {error}</div>;
  if (!curves) return <p className="hint">Building calibration curves…</p>;

  return (
    <>
      <p className="sub" style={{ marginTop: 4 }}>
        Per-analyte calibration: measured intensity vs the defined standard concentrations, with an
        ordinary-least-squares fit and R². Hover a point for its standard.
      </p>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
        <label className="toggle">Analyte&nbsp;
          <select value={sel || ""} onChange={(e) => setSel(e.target.value)} style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6 }}>
            {curves.map((c) => <option key={c.key} value={c.key}>{c.rawLabel}{c.fit ? ` — R²=${c.fit.r2.toFixed(4)}` : ""}</option>)}
          </select>
        </label>
      </div>
      {curve && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Suspense fallback={<p className="hint">Loading chart…</p>}><CalibrationPlot curve={curve} /></Suspense>
          <div style={{ minWidth: 220 }}>
            <h3 style={{ marginTop: 0 }}>{curve.rawLabel}</h3>
            <table className="cc-table" style={{ width: "auto" }}>
              <thead><tr><th>Standard</th><th>mg/L</th><th>cps</th></tr></thead>
              <tbody>
                {curve.points.map((p, i) => (
                  <tr key={i}><td style={{ textAlign: "left" }}>{p.standard}</td><td>{p.conc}</td><td>{p.intensity.toFixed(0)}</td></tr>
                ))}
              </tbody>
            </table>
            {curve.fit && (
              <p className="hint" style={{ marginTop: 8 }}>
                slope {curve.fit.slope.toFixed(1)} cps per mg/L · intercept {curve.fit.intercept.toFixed(0)} · <b>R² {curve.fit.r2.toFixed(5)}</b>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
