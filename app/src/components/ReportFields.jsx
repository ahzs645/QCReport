import React from "react";
import { HEADER_FIELDS } from "../../../scripts/lib/results-workbook.mjs";

const PER_RUN = HEADER_FIELDS.filter((f) => f.perRun);

export default function ReportFields({ header, onHeader, samples, sampleNames, onSampleName }) {
  return (
    <section className="report-fields">
      <h2>Report details <span className="hint">(typed here → filled into the exported RESULTS / QC workbooks)</span></h2>
      <div className="rf-grid">
        {PER_RUN.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input
              type={f.key === "date" ? "date" : "text"}
              value={header[f.key] || ""}
              placeholder={f.label}
              onChange={(e) => onHeader(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      {samples.length > 0 && (
        <>
          <h3>Sample names <span className="hint">(friendly names for each NALS id → RESULTS column A)</span></h3>
          <div className="rf-samples">
            {samples.map((s) => (
              <label key={s.id}>
                <span className="sid" title={s.id}>{s.id}</span>
                <input
                  value={sampleNames[s.id] ?? s.name}
                  placeholder="Sample name"
                  onChange={(e) => onSampleName(s.id, e.target.value)}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
