import React, { useEffect, useMemo, useState } from "react";
import DropZone from "../components/DropZone.jsx";
import { parseEsws, toCsv, downloadText } from "../core/esws.js";

const fmt = (v) => {
  if (v == null) return "";
  if (typeof v === "number") return Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(4);
  return String(v); // over-range strings like "123.4 o" pass through
};
const isOver = (v) => typeof v === "string" && /\bo\s*$/i.test(v);
const baseName = (n) => n.replace(/\.esws$/i, "");

export default function EwsParserView() {
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState("adjusted");
  const [table, setTable] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");

  // (Re)parse whenever the file or the adjusted/unadjusted choice changes.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setStatus("working");
    setError(null);
    parseEsws(file, kind)
      .then((t) => { if (!cancelled) { setTable(t); setStatus("ready"); } })
      .catch((e) => { if (!cancelled) { setError(e.message || String(e)); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [file, kind]);

  const rows = useMemo(() => {
    if (!table) return [];
    const q = filter.trim().toLowerCase();
    return q ? table.rows.filter((r) => r.label.toLowerCase().includes(q)) : table.rows;
  }, [table, filter]);

  return (
    <>
      <p className="sub">
        Parse a raw Agilent ICP Expert worksheet (<code>.esws</code>) directly — no “Export to Excel”
        step. The file is a ZIP of .NET-serialized parts; it’s unzipped and decoded entirely in your
        browser. Values are verified against the matching <code>.xlsx</code> export (100% on test files).
      </p>

      <DropZone
        onFiles={(files) => setFile(files[0])}
        status={status}
        label="Drop an ICP Expert .esws worksheet here"
        hint="…or click to choose. One .esws at a time."
        accept=".esws"
        match={/\.esws$/i}
        multiple={false}
      />

      {status === "error" && <div className="error">⚠ {error}</div>}

      {table && status !== "error" && (
        <>
          <section className="meta">
            <span><b>File:</b> {table.fileName}</span>
            <span><b>Solutions:</b> {table.count}</span>
            <span><b>Analytes:</b> {table.analyteCount}</span>
            <span><b>Showing:</b> {table.sheet}</span>
          </section>

          <div className="cc-controls" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", margin: "4px 0 10px" }}>
            <div className="seg">
              <button className={kind === "adjusted" ? "on" : ""} onClick={() => setKind("adjusted")}>Adjusted (Raw Data)</button>
              <button className={kind === "unadjusted" ? "on" : ""} onClick={() => setKind("unadjusted")}>Unadjusted Conc</button>
            </div>
            <input
              className="filter"
              placeholder="Filter by solution label…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: "1 1 220px", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6 }}
            />
            <div className="downloadbar" style={{ margin: 0 }}>
              <button onClick={() => downloadText(toCsv(table), `${baseName(table.fileName)}-${kind}.csv`)}>Download CSV</button>
              <button onClick={() => downloadText(JSON.stringify({ ...table, rows: table.rows }, null, 2), `${baseName(table.fileName)}-${kind}.json`, "application/json")}>
                Download JSON
              </button>
            </div>
          </div>

          <div className="cc-table-scroll">
            <table className="cc-table">
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0 }}>Solution Label</th>
                  {table.columns.map((c) => (
                    <th key={c.key} title={c.label}>{c.label.replace(/ nm$/, "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.label}-${i}`}>
                    <td style={{ position: "sticky", left: 0, background: "var(--card)", fontWeight: 600 }}>
                      {row.label}
                    </td>
                    {table.columns.map((c) => {
                      const v = row.values[c.key];
                      return (
                        <td key={c.key} className={isOver(v) ? "row-fail" : undefined} title={isOver(v) ? "over calibration range" : undefined}>
                          {fmt(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="hint">No solutions match “{filter}”.</p>}
        </>
      )}
    </>
  );
}
