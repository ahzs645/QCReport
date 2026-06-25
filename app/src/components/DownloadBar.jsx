import React, { useState } from "react";
import { downloadQc, downloadResults } from "../core/pipeline.js";

export default function DownloadBar({ analysis, overrides = {} }) {
  const [busy, setBusy] = useState(null);

  const run = async (which, fn, name) => {
    setBusy(which);
    try {
      await fn(analysis, overrides, name);
    } catch (e) {
      alert(`Could not generate ${which}: ${e.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const stem = analysis.sources.raw.replace(/\.xlsx?$/i, "");

  return (
    <div className="downloadbar">
      <button
        disabled={busy !== null}
        onClick={() => run("RESULTS", downloadResults, `${stem}_RESULTS.xlsx`)}
      >
        {busy === "RESULTS" ? "Generating…" : "⬇ Download RESULTS workbook"}
      </button>
      <button
        disabled={busy !== null}
        onClick={() => run("QC", downloadQc, `${stem}_QC.xlsx`)}
      >
        {busy === "QC" ? "Generating…" : "⬇ Download QC workbook"}
      </button>
      <span className="hint">Workbooks open in Excel with live formulas (recalc on open).</span>
    </div>
  );
}
