import React, { useState } from "react";
import DropZone from "../components/DropZone.jsx";
import QcPanel from "../components/QcPanel.jsx";
import ResultsPreview from "../components/ResultsPreview.jsx";
import ReportFields from "../components/ReportFields.jsx";
import DownloadBar from "../components/DownloadBar.jsx";
import AdjUnadjPanel from "../components/AdjUnadjPanel.jsx";
import { analyze } from "../core/pipeline.js";

export default function QcResultsView() {
  const [status, setStatus] = useState("idle");
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [header, setHeader] = useState({});
  const [sampleNames, setSampleNames] = useState({});
  const [showAdjUnadj, setShowAdjUnadj] = useState(false);

  async function handleFiles(files) {
    setStatus("working");
    setError(null);
    try {
      const result = await analyze(files);
      setAnalysis(result);
      setHeader({}); // reset per-run fields for the new drop
      setSampleNames({});
      setStatus("ready");
    } catch (e) {
      setError(e.message || String(e));
      setStatus("error");
    }
  }

  return (
    <>
      <p className="sub">
        Drop the raw ICPOES export. The quality check is computed in code (not read from Excel);
        download the populated RESULTS and QC workbooks.
      </p>
      <DropZone
        onFiles={handleFiles}
        status={status}
        accept=".xlsx,.xls,.esws"
        match={/\.(xlsx?|esws)$/i}
        hint="Drop the raw ICPOES export — .esws worksheet or Concentration .xlsx (RESULTS / QC workbooks optional)."
      />
      {status === "error" && <div className="error">⚠ {error}</div>}
      {status === "ready" && analysis && (
        <>
          <section className="meta">
            <span><b>Template:</b> {analysis.version || "—"}</span>
            <span><b>Raw:</b> {analysis.sources.raw}</span>
            <span><b>Samples:</b> {analysis.samples.length}</span>
            <span><b>QC roles:</b> {analysis.sources.qcRoleSource}</span>
          </section>
          <ReportFields
            header={header}
            onHeader={(k, v) => setHeader((h) => ({ ...h, [k]: v }))}
            samples={analysis.samples}
            sampleNames={sampleNames}
            onSampleName={(id, v) => setSampleNames((s) => ({ ...s, [id]: v }))}
          />
          <DownloadBar analysis={analysis} overrides={{ header, sampleNames }} />
          <QcPanel qc={analysis.qc} reportableAnalytes={analysis.reportableAnalytes} />

          <section>
            <h2>
              Adjusted vs Unadjusted{" "}
              <label className="toggle" style={{ fontWeight: 400, fontSize: 13 }}>
                <input type="checkbox" checked={showAdjUnadj} onChange={(e) => setShowAdjUnadj(e.target.checked)} /> show comparison
              </label>
            </h2>
            {showAdjUnadj && (
              <AdjUnadjPanel
                adjusted={analysis._conc}
                unadjusted={analysis._unadj}
                samples={analysis.samples}
                reportableAnalytes={analysis.reportableAnalytes}
              />
            )}
          </section>

          <ResultsPreview matrix={analysis.reportMatrix} samples={analysis.samples} />
        </>
      )}
    </>
  );
}
