import React, { useEffect, useState } from "react";
import { qc } from "../../core/esws.js";

const recClass = (r) => (r == null ? undefined : r >= 90 && r <= 110 ? "qc-in" : "qc-out");

export default function QcView({ session }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    qc(session).then((d) => !cancelled && setData(d)).catch((e) => !cancelled && setError(e.message || String(e)));
    return () => { cancelled = true; };
  }, [session]);

  if (error) return <div className="error">⚠ {error}</div>;
  if (!data) return <p className="hint">Reading QC solutions…</p>;

  // Only show analytes that some QC solution has a recovery for, to keep it readable.
  const cols = data.analytes.filter((a) => data.rows.some((r) => r.values[a.key]?.recovery != null));
  const shown = cols.length ? cols : data.analytes;

  return (
    <>
      <p className="sub" style={{ marginTop: 4 }}>
        QC solutions in run order (CCV / blanks / spikes). Cells show <b>% recovery</b> vs the expected
        concentration inferred from the label; green = 90–110%, red = outside. Reading top-to-bottom shows
        drift across the run. “Pass” is ICP Expert’s own QC verdict.
      </p>
      <div className="cc-table-scroll">
        <table className="cc-table qc-matrix">
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0 }}>QC solution</th>
              <th>Pass</th>
              <th>Exp.</th>
              {shown.map((a) => <th key={a.key} title={a.rawLabel}>{a.rawLabel.replace(/ nm$/, "")}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.seq}>
                <td style={{ position: "sticky", left: 0, background: "var(--card)", fontWeight: 600 }}>{r.label}</td>
                <td className={r.qcPassed === false ? "qc-out" : r.qcPassed === true ? "qc-in" : undefined}>
                  {r.qcPassed == null ? "—" : r.qcPassed ? "✓" : "✗"}
                </td>
                <td>{r.expected == null ? "" : r.expected}</td>
                {shown.map((a) => {
                  const v = r.values[a.key];
                  const rec = v?.recovery;
                  return (
                    <td key={a.key} className={recClass(rec)} title={v ? `${v.conc.toFixed(4)} mg/L` : ""}>
                      {rec != null ? `${rec.toFixed(0)}%` : v ? v.conc.toFixed(3) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
