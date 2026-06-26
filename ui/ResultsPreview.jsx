import { Fragment } from "react";

const fmtVal = (v) => (typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3)) : String(v));

/**
 * The computed REPORT DATA matrix (parameters × samples) with section bands.
 * PURE: `matrix` = [{ parameter, units, guideline, section, values: [...] }],
 * `samples` = [{ id, name }] aligned to each row's `values`.
 */
export function ResultsPreview({ matrix, samples }) {
  if (!matrix?.length) return null;
  return (
    <section className="qc-section">
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
            {matrix.map((row, i) => {
              const sectionHeader = i === 0 || matrix[i - 1].section !== row.section ? row.section : null;
              return (
                <Fragment key={row.parameter}>
                  {sectionHeader && (
                    <tr className="section-row">
                      <td colSpan={3 + samples.length}>{sectionHeader}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="param">{row.parameter}</td>
                    <td>{row.units}</td>
                    <td>{row.guideline}</td>
                    {row.values.map((v, j) => (
                      <td key={j} className="val">{fmtVal(v)}</td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
