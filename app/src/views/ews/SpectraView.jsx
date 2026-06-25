import React, { Suspense, useEffect, useMemo, useState } from "react";
import { spectra } from "../../core/esws.js";
import { getCharts } from "../../components/charts.js";

export default function SpectraView({ session, chartStyle }) {
  const { SpectrumPlot } = getCharts(chartStyle);
  const runs = useMemo(() => session.extract.runs.filter((r) => r.solutionKey), [session]);
  const [solIdx, setSolIdx] = useState(() => {
    const i = runs.findIndex((r) => /NALS\d/.test(r.label));
    return i >= 0 ? i : 0;
  });
  const [lines, setLines] = useState(null);
  const [lineKey, setLineKey] = useState(null);
  const [error, setError] = useState(null);

  const run = runs[solIdx];

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    setLines(null);
    spectra(session, run.solutionKey)
      .then((ls) => { if (!cancelled) { setLines(ls); setLineKey(ls.find((l) => /ca 317/i.test(l.key))?.key || ls[0]?.key); } })
      .catch((e) => !cancelled && setError(e.message || String(e)));
    return () => { cancelled = true; };
  }, [session, run]);

  const line = useMemo(() => lines?.find((l) => l.key === lineKey), [lines, lineKey]);

  if (error) return <div className="error">⚠ {error}</div>;

  return (
    <>
      <p className="sub" style={{ marginTop: 4 }}>
        Raw emission spectra — the intensity-vs-wavelength window the instrument integrates for each
        line (from <code>Results/Spectrum</code>). Pick a solution and a line to see its peak.
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        <label className="toggle">Solution&nbsp;
          <select value={solIdx} onChange={(e) => setSolIdx(Number(e.target.value))} style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6 }}>
            {runs.map((r, i) => <option key={i} value={i}>{r.label}</option>)}
          </select>
        </label>
        <label className="toggle">Line&nbsp;
          <select value={lineKey || ""} onChange={(e) => setLineKey(e.target.value)} disabled={!lines} style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6 }}>
            {lines?.map((l) => <option key={l.key} value={l.key}>{l.nearest || `${l.center.toFixed(3)} nm`}</option>)}
          </select>
        </label>
      </div>
      {!lines && <p className="hint">Reading spectra…</p>}
      {lines && lines.length === 0 && <p className="hint">No spectra stored for this solution.</p>}
      {line && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Suspense fallback={<p className="hint">Loading chart…</p>}><SpectrumPlot line={line} /></Suspense>
          <div className="hint" style={{ minWidth: 200 }}>
            <h3 style={{ marginTop: 0, color: "var(--text)" }}>{line.nearest || `${line.center.toFixed(3)} nm`}</h3>
            <p>peak {line.peak.toFixed(0)} cps<br />window {line.wavelengths[0].toFixed(3)}–{line.wavelengths[line.wavelengths.length - 1].toFixed(3)} nm<br />{line.wavelengths.length} pixels</p>
            <p>{lines.length} lines captured for this solution.</p>
          </div>
        </div>
      )}
    </>
  );
}
