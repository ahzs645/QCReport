import React from "react";

const fmtVal = (v) => (typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3)) : String(v));

export default function ResultsPreview({ matrix, samples }) {
  if (!matrix?.length) return null;
  let lastSection = null;
  return (
    <section>
      <h2>RESULTS preview <span className="hint">(computed in code — REPORT DATA matrix)</span></h2>
      <div className="table-scroll">
        <table className="results">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Units</th>
              <th>CDWQ</th>
              {samples.map((s) => (
                <th key={s.id} title={s.id}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => {
              const sectionHeader = row.section !== lastSection ? row.section : null;
              lastSection = row.section;
              return (
                <React.Fragment key={row.parameter}>
                  {sectionHeader && (
                    <tr className="section-row">
                      <td colSpan={3 + samples.length}>{sectionHeader}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="param">{row.parameter}</td>
                    <td>{row.units}</td>
                    <td>{row.guideline}</td>
                    {row.values.map((v, i) => (
                      <td key={i} className="val">{fmtVal(v)}</td>
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
