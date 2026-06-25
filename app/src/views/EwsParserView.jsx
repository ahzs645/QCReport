import React, { useState } from "react";
import DropZone from "../components/DropZone.jsx";
import { loadEsws } from "../core/esws.js";
import { CHART_STYLES, loadChartStyle, saveChartStyle } from "../components/charts.js";
import ResultsView from "./ews/ResultsView.jsx";
import CalibrationView from "./ews/CalibrationView.jsx";
import QcView from "./ews/QcView.jsx";
import SpectraView from "./ews/SpectraView.jsx";

const SUBTABS = [
  { id: "results", label: "Results", View: ResultsView },
  { id: "calibration", label: "Calibration", View: CalibrationView },
  { id: "qc", label: "QC", View: QcView },
  { id: "spectra", label: "Spectra", View: SpectraView },
];

export default function EwsParserView() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [sub, setSub] = useState("results");
  const [chartStyle, setChartStyle] = useState(loadChartStyle);

  const chooseChartStyle = (id) => { setChartStyle(id); saveChartStyle(id); };
  const chartsApply = sub === "calibration" || sub === "spectra";

  async function handleFiles(files) {
    setStatus("working");
    setError(null);
    setSession(null);
    try {
      setSession(await loadEsws(files[0]));
      setSub("results");
      setStatus("ready");
    } catch (e) {
      setError(e.message || String(e));
      setStatus("error");
    }
  }

  const ActiveView = SUBTABS.find((t) => t.id === sub)?.View;
  const ri = session?.runInfo;

  return (
    <>
      <p className="sub">
        Parse a raw Agilent ICP Expert worksheet (<code>.esws</code>) directly — no “Export to Excel”
        step. The ZIP of .NET-serialized parts is unzipped and decoded entirely in your browser.
        Concentrations are verified against the matching <code>.xlsx</code> export (100% on test files).
      </p>

      <DropZone
        onFiles={handleFiles}
        status={status}
        label="Drop an ICP Expert .esws worksheet here"
        hint="…or click to choose. One .esws at a time."
        accept=".esws"
        match={/\.esws$/i}
        multiple={false}
      />

      {status === "error" && <div className="error">⚠ {error}</div>}

      {session && status === "ready" && (
        <>
          <section className="meta">
            <span><b>File:</b> {session.fileName}</span>
            <span><b>Instrument:</b> {ri.instrumentSerial || "—"}</span>
            <span><b>Software:</b> {ri.softwareVersion || "—"}</span>
            <span><b>Solutions:</b> {ri.solutionCount}</span>
            <span><b>Analytes:</b> {session.extract.analytes.length}</span>
            <span><b>Spectra:</b> {ri.spectrumCount}</span>
          </section>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <nav className="tabs" style={{ margin: 0 }}>
              {SUBTABS.map((t) => (
                <button key={t.id} className={sub === t.id ? "active" : ""} onClick={() => setSub(t.id)}>{t.label}</button>
              ))}
            </nav>
            {chartsApply && (
              <label className="toggle" style={{ fontSize: 12.5 }}>
                Chart style
                <span className="seg" style={{ marginLeft: 6 }}>
                  {CHART_STYLES.map((s) => (
                    <button key={s.id} className={chartStyle === s.id ? "on" : ""} onClick={() => chooseChartStyle(s.id)}>{s.label}</button>
                  ))}
                </span>
              </label>
            )}
          </div>

          {ActiveView && <ActiveView session={session} chartStyle={chartStyle} />}
        </>
      )}
    </>
  );
}
