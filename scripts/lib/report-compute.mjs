// Forward computation of report-facing values from parsed raw ICPOES data —
// shared by the browser app (preview) and Node (testing). Pure.

import { reportableValue } from "./formula-engine.mjs";
import { toNumber } from "./sheet-utils.mjs";
import { normalizeAnalyteLabel, normalizeSampleId } from "./raw-parsers/normalize.mjs";

/**
 * Compare the adjusted vs unadjusted concentration for each client sample × analyte.
 * adjusted = unadjusted × the sample's total dilution, so the ratio reveals the
 * applied dilution (≈1 = none). Returns flat rows for a comparison report.
 *
 * @param {object} adjusted   - parseIcpoesConcWorkbook() (Concentration/Raw Data)
 * @param {object} unadjusted - parseIcpoesConcWorkbook(..., {kind:"unadjusted"})
 * @param {Array<{name,id}>} samples
 * @returns {Array<{sample,id,analyte,key,adjusted,unadjusted,diff,ratio}>}
 */
export function adjustedVsUnadjusted(adjusted, unadjusted, samples) {
  const adjById = new Map(adjusted.rows.map((r) => [normalizeSampleId(r.label), r]));
  const unById = new Map((unadjusted?.rows || []).map((r) => [normalizeSampleId(r.label), r]));
  const rows = [];
  for (const s of samples) {
    const aRow = adjById.get(normalizeSampleId(s.id));
    if (!aRow) continue;
    const uRow = unById.get(normalizeSampleId(s.id));
    for (const a of adjusted.analytes) {
      const adj = aRow.values[a.key];
      const unadj = uRow ? uRow.values[a.key] : undefined;
      const an = toNumber(adj);
      const un = toNumber(unadj);
      if (an === null && un === null) continue;
      rows.push({
        sample: s.name,
        id: s.id,
        analyte: a.rawLabel,
        key: a.key,
        adjusted: adj ?? null,
        unadjusted: unadj ?? null,
        diff: an !== null && un !== null ? an - un : null,
        ratio: an !== null && un !== null && un !== 0 ? an / un : null,
      });
    }
  }
  return rows;
}

const QC_LABEL = /blank|standard|ccv|icv|ipc|rinse|interference|fortified|low level|no run|^iq/i;

/** Detect client samples directly from a raw run (used when no RESULTS workbook is given). */
export function detectClientSamples(conc) {
  const seen = new Set();
  const samples = [];
  for (const row of conc.rows) {
    if (row.isDilution) continue;
    if (!/\d{4}\s*nals\s*\d+/i.test(row.label) || QC_LABEL.test(row.label)) continue;
    const key = normalizeSampleId(row.label);
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push({ index: samples.length, name: row.label, id: row.label, kind: "client" });
  }
  return samples;
}

/**
 * The set of ICPOES analyte keys (normalised labels) that actually feed REPORT
 * DATA — i.e. the ~25–30 reportable elements, as opposed to all 111 wavelengths.
 * Used to filter the QC view to meaningful elements.
 */
export function reportableAnalyteKeys(spec, reportSheetName = "REPORT DATA") {
  const report = spec.reportSheets[reportSheetName];
  const oes = spec.instrumentSheets["ICPOES RESULTS"];
  if (!report || !oes) return new Set();
  const byCol = new Map(oes.analytes.map((a) => [a.reportableCol, normalizeAnalyteLabel(a.label)]));
  const set = new Set();
  for (const param of report.parameters) {
    for (const src of param.sources) {
      if (/ICPOES RESULTS/i.test(src.sheet)) {
        const key = byCol.get(src.parsed.start.colLetter);
        if (key) set.add(key);
      }
    }
  }
  return set;
}

/**
 * Forward-compute the REPORT DATA matrix (one row per parameter, one value per
 * sample) from the raw ICPOES Concentration data, honouring the instrument
 * dropdown. Parameters sourced from instruments not present in the drop yield "—".
 *
 * @param {object} spec - buildSpec() result
 * @param {Array<{name,id}>} samples
 * @param {object} conc - parseIcpoesConcWorkbook() result
 * @param {string} [reportSheetName="REPORT DATA"]
 */
export function computeReportMatrix(spec, samples, conc, reportSheetName = "REPORT DATA") {
  const report = spec.reportSheets[reportSheetName];
  const oes = spec.instrumentSheets["ICPOES RESULTS"];
  const byReportableCol = new Map(oes.analytes.map((a) => [a.reportableCol, a]));
  const concById = new Map(conc.rows.map((r) => [normalizeSampleId(r.label), r]));

  return report.parameters.map((param) => {
    const src = param.sources.find((s) => s.when === param.dropdownValue) || param.sources[0];
    const analyte = src && /ICPOES RESULTS/i.test(src.sheet) ? byReportableCol.get(src.parsed.start.colLetter) : null;
    const analyteKey = analyte ? normalizeAnalyteLabel(analyte.label) : null;
    const values = samples.map((s) => {
      if (!analyte) return "—";
      const raw = concById.get(normalizeSampleId(s.id));
      const measured = raw ? raw.values[analyteKey] : null;
      return reportableValue(measured ?? null, {
        detectionLimit: analyte.detectionLimitRaw ?? analyte.detectionLimit,
        belowLabel: analyte.belowLabel,
      });
    });
    return { parameter: param.name, units: param.units, guideline: param.guideline, section: param.section, values };
  });
}
