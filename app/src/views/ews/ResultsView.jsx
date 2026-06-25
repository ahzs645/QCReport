import React, { useMemo, useState } from "react";
import { resultsTable, solutionDetail, toCsv, downloadText } from "../../core/esws.js";

const isOver = (v) => typeof v === "string" && /\bo\s*$/i.test(v);
const baseName = (n) => n.replace(/\.esws$/i, "");

function fmtConc(m, kind) {
  if (!m) return "";
  if (m.uncal) return "Uncal";
  const v = kind === "unadjusted" ? m.unadjusted : m.adjusted;
  if (v == null) return "";
  const s = Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(4);
  return m.over ? `${s} o` : s;
}
const fmtNum = (v, d = 0) => (v == null ? "" : Math.abs(v) >= 100 ? v.toFixed(d) : v.toPrecision(4));

export default function ResultsView({ session }) {
  const { analytes, runs } = session.extract;
  const [mode, setMode] = useState("conc"); // conc | intensity | rsd
  const [kind, setKind] = useState("adjusted");
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? runs.filter((r) => r.label.toLowerCase().includes(q)) : runs;
  }, [runs, filter]);

  const cell = (m) => {
    if (mode === "conc") return fmtConc(m, kind);
    if (mode === "intensity") return fmtNum(m?.intensity);
    return m?.rsd == null ? "" : `${m.rsd.toFixed(1)}%`;
  };

  async function openDetail(run) {
    setLoadingDetail(true);
    try { setDetail(await solutionDetail(session, run.part)); } finally { setLoadingDetail(false); }
  }

  const downloadCsv = () => {
    const t = resultsTable(session, kind);
    downloadText(toCsv(t), `${baseName(session.fileName)}-${kind}.csv`);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "6px 0 10px" }}>
        <div className="seg">
          <button className={mode === "conc" ? "on" : ""} onClick={() => setMode("conc")}>Concentration</button>
          <button className={mode === "intensity" ? "on" : ""} onClick={() => setMode("intensity")}>Intensity</button>
          <button className={mode === "rsd" ? "on" : ""} onClick={() => setMode("rsd")}>%RSD</button>
        </div>
        {mode === "conc" && (
          <div className="seg">
            <button className={kind === "adjusted" ? "on" : ""} onClick={() => setKind("adjusted")}>Adjusted</button>
            <button className={kind === "unadjusted" ? "on" : ""} onClick={() => setKind("unadjusted")}>Unadjusted</button>
          </div>
        )}
        <input className="filter" placeholder="Filter solutions…" value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ flex: "1 1 200px", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6 }} />
        <div className="downloadbar" style={{ margin: 0 }}><button onClick={downloadCsv}>Download CSV</button></div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Click a row to inspect its replicates.</p>

      <div className="cc-table-scroll">
        <table className="cc-table">
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0 }}>Solution Label</th>
              {analytes.map((a) => <th key={a.key} title={a.rawLabel}>{a.rawLabel.replace(/ nm$/, "")}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.label}-${i}`} onClick={() => openDetail(r)} style={{ cursor: "pointer" }}>
                <td style={{ position: "sticky", left: 0, background: "var(--card)", fontWeight: 600 }}>{r.label}</td>
                {analytes.map((a) => {
                  const v = cell(r.measurements[a.key]);
                  return <td key={a.key} className={mode === "conc" && isOver(v) ? "row-fail" : undefined}>{v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(detail || loadingDetail) && (
        <section style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 6 }}>
            Replicates {detail ? `— ${detail.label}` : "…"}
            {detail && <button className="linkish" onClick={() => setDetail(null)} style={{ marginLeft: 10, fontSize: 12 }}>close</button>}
          </h3>
          {loadingDetail && <p className="hint">Reading replicates…</p>}
          {detail && (
            <div className="cc-table-scroll" style={{ maxHeight: 300 }}>
              <table className="cc-table">
                <thead><tr><th style={{ position: "sticky", left: 0 }}>Analyte</th><th>Mean</th><th>%RSD</th><th>Rep 1</th><th>Rep 2</th><th>Rep 3</th></tr></thead>
                <tbody>
                  {detail.analytes.map((a) => (
                    <tr key={a.key} className={a.rsd > 10 ? "row-fail" : undefined}>
                      <td style={{ position: "sticky", left: 0, background: "var(--card)", fontWeight: 600 }}>{a.rawLabel.replace(/ nm$/, "")}</td>
                      <td>{fmtNum(a.conc)}</td>
                      <td>{a.rsd == null ? "" : `${a.rsd.toFixed(1)}%`}</td>
                      {[0, 1, 2].map((k) => <td key={k} style={{ opacity: a.replicates[k]?.included === false ? 0.4 : 1 }}>{fmtNum(a.replicates[k]?.conc)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
