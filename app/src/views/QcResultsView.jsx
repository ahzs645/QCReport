import React, { useState } from "react";
import DropZone from "../components/DropZone.jsx";
import QcPanel from "../components/QcPanel.jsx";
import ResultsPreview from "../components/ResultsPreview.jsx";
import ReportFields from "../components/ReportFields.jsx";
import DownloadBar from "../components/DownloadBar.jsx";
import AdjUnadjPanel from "../components/AdjUnadjPanel.jsx";
import RackView from "../components/RackView.jsx";
import { analyze } from "../core/pipeline.js";

export default function QcResultsView() {
  const [status, setStatus] = useState("idle");
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [header, setHeader] = useState({});
  const [sampleNames, setSampleNames] = useState({});
  const [showAdjUnadj, setShowAdjUnadj] = useState(false);
  const [showRack, setShowRack] = useState(false);

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
        download the populated RESULTS and QC workbooks. Optionally add the RESULTS, QC, HotBlock
        digestion, and/or Labels workbooks — each is used if present, ignored if not.
      </p>
      <DropZone
        onFiles={handleFiles}
        status={status}
        accept=".xlsx,.xls,.esws"
        match={/\.(xlsx?|esws)$/i}
        multiple
        hint="Drop the raw ICPOES export (+ optional RESULTS / QC / HotBlock digestion / Labels workbooks)."
      />
      {status === "error" && <div className="error">⚠ {error}</div>}
      {status === "ready" && analysis && (
        <>
          <section className="meta">
            <span><b>Template:</b> {analysis.version || "—"}</span>
            <span><b>Raw:</b> {analysis.sources.raw}</span>
            <span><b>Samples:</b> {analysis.samples.length}</span>
            <span><b>Names from:</b> {analysis.sources.nameSource}</span>
            <span><b>QC roles:</b> {analysis.sources.qcRoleSource}</span>
            <span><b>QC limits:</b> {analysis.sources.qcCriteriaSource}</span>
            {analysis.sources.hotblock && <span><b>HotBlock:</b> {analysis.sources.hotblock}</span>}
            {analysis.sources.labels && <span><b>Labels:</b> {analysis.sources.labels}</span>}
          </section>
          {analysis.prep?.warnings?.length > 0 && (
            <section className="prep-warn">
              {analysis.prep.warnings.map((w, i) => (
                <div key={i} className="hint">
                  {w.kind === "prep_row_excluded" && <>⊘ Excluded <b>{w.id}</b> — prep/QC ({w.role}: “{w.name}”), not a client sample.</>}
                  {w.kind === "name_mismatch" && <>⚠ Name mismatch for <b>{w.id}</b>: RESULTS “{w.results}” vs HotBlock “{w.prep}”.</>}
                </div>
              ))}
            </section>
          )}
          <ReportFields
            header={header}
            onHeader={(k, v) => setHeader((h) => ({ ...h, [k]: v }))}
            samples={analysis.samples}
            sampleNames={sampleNames}
            onSampleName={(id, v) => setSampleNames((s) => ({ ...s, [id]: v }))}
          />
          <DownloadBar analysis={analysis} overrides={{ header, sampleNames }} />
          <QcPanel qc={analysis.qc} reportableAnalytes={analysis.reportableAnalytes} />
          {analysis.qcRoleHints?.length > 0 && (
            <p className="hint" style={{ marginTop: 6 }}>
              QC/prep roles cross-referenced from HotBlock:{" "}
              {analysis.qcRoleHints.map((h) => `${h.id} = ${h.role}`).join(" · ")}
            </p>
          )}

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

          <section>
            <h2>
              Rack &amp; prep layout{" "}
              <span className="hint">(experimental)</span>{" "}
              <label className="toggle" style={{ fontWeight: 400, fontSize: 13 }}>
                <input type="checkbox" checked={showRack} onChange={(e) => setShowRack(e.target.checked)} /> show
              </label>
            </h2>
            {showRack && <RackView prep={analysis.prep} />}
          </section>

          <ResultsPreview matrix={analysis.reportMatrix} samples={analysis.samples} />
        </>
      )}
    </>
  );
}
