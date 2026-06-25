// Code-side computation + cross-check against the workbook's cached values.
//
// Two independent checks:
//   1. crossCheckInstrumentSheets — for every analyte column x sample row, run
//      the JS formula-engine on the raw input and compare to the workbook's
//      cached reportable value. Proves the engine reproduces Excel.
//   2. crossCheckReportMatrix — for every parameter x sample in REPORT DATA,
//      select the source (honouring the instrument dropdown) and compare the
//      source's reportable value to REPORT DATA's cached cell. Proves the
//      source-selection / TRANSPOSE mapping is correct.

import { DEFAULT_FLAGS, reportableValue, valuesMatch } from "./formula-engine.mjs";
import { cellValue, numberToCol } from "./sheet-utils.mjs";
import { getSamples } from "./results-workbook.mjs";

/** Build the flag config for one analyte (some sheets skip Uncal/over-range). */
export function flagsForAnalyte(a) {
  return {
    uncal: a.checksUncal ? DEFAULT_FLAGS.uncal : null,
    uncalLabel: DEFAULT_FLAGS.uncalLabel,
    over: a.checksOver ? DEFAULT_FLAGS.over : [],
    overLabel: DEFAULT_FLAGS.overLabel,
    noData: DEFAULT_FLAGS.noData,
  };
}

/** Compute one reportable value from an instrument input cell, per the spec model. */
export function computeAnalyteCell(ws, analyte, inputRow) {
  const inputVal = cellValue(ws.getCell(`${analyte.inputCol}${inputRow}`).value);
  return reportableValue(inputVal, {
    detectionLimit: analyte.detectionLimitRaw ?? analyte.detectionLimit,
    belowLabel: analyte.belowLabel,
    flags: flagsForAnalyte(analyte),
  });
}

/** Check #1: engine vs cached reportable values across all instrument sheets. */
export function crossCheckInstrumentSheets(wb, spec) {
  const out = { total: 0, matched: 0, mismatches: [] };
  for (const [sheetName, model] of Object.entries(spec.instrumentSheets)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws || !model.inputRows || !model.reportableRows) continue;
    const count = model.inputRows.end - model.inputRows.start + 1;
    for (const analyte of model.analytes) {
      for (let i = 0; i < count; i += 1) {
        const inputRow = model.inputRows.start + i;
        const reportRow = model.reportableRows.start + i;
        const cached = cellValue(ws.getCell(`${analyte.reportableCol}${reportRow}`).value);
        const computed = computeAnalyteCell(ws, analyte, inputRow);
        out.total += 1;
        if (valuesMatch(computed, cached)) {
          out.matched += 1;
        } else {
          out.mismatches.push({
            sheet: sheetName,
            reportableCell: `${analyte.reportableCol}${reportRow}`,
            inputCell: `${analyte.inputCol}${inputRow}`,
            input: cellValue(ws.getCell(`${analyte.inputCol}${inputRow}`).value),
            computed,
            cached,
          });
        }
      }
    }
  }
  return out;
}

/** Pick the active source for a parameter, honouring the instrument dropdown. */
export function activeSource(param) {
  if (param.sources.length === 1) return param.sources[0];
  if (param.dropdownValue) {
    const match = param.sources.find((s) => s.when === param.dropdownValue);
    if (match) return match;
  }
  return param.sources.find((s) => s.when === null) || param.sources[0] || null;
}

/**
 * Check #2: REPORT DATA mapping. For each parameter x sample, read the value
 * from the selected source range and compare to the REPORT DATA cached cell.
 */
const isBlank = (v) => v === null || v === undefined || v === "";
/** Excel stores a blank cell as null in a direct cell but 0 in an array spill. */
const blankZeroArtifact = (a, b) =>
  (isBlank(a) && (b === 0 || isBlank(b))) || (isBlank(b) && (a === 0 || isBlank(a)));

export function crossCheckReportMatrix(wb, spec, reportSheetName = spec.primaryReportSheet) {
  const out = { total: 0, matched: 0, artifacts: 0, mismatches: [], reportSheet: reportSheetName };
  const report = spec.reportSheets[reportSheetName];
  const rd = wb.getWorksheet(reportSheetName);
  if (!report || !rd) return out;

  // The array-formula master lives in the source column itself and spills right,
  // so sample 1 is the source column (F), sample 2 is the next column (G), etc.
  // We check only real client samples (rows with a sample name); empty padding /
  // QC rows have inconsistent cached 0-vs-blank values that are not report data.
  const firstSampleCol = report.layout.sourceCol;
  // Real client samples + the RL reference column; skip empty padding rows.
  const samples = getSamples(wb, spec).filter((s) => s.kind !== "placeholder");
  out.samples = samples.length;

  for (const param of report.parameters) {
    const src = activeSource(param);
    if (!src) continue;
    const srcSheet = wb.getWorksheet(src.sheet);
    if (!srcSheet) continue;
    const srcCol = src.parsed.start.colLetter;
    const srcStartRow = src.parsed.start.row;

    for (const sample of samples) {
      const i = sample.index;
      const sourceVal = cellValue(srcSheet.getCell(`${srcCol}${srcStartRow + i}`).value);
      const reportCol = numberToCol(firstSampleCol + i);
      const reportVal = cellValue(rd.getCell(`${reportCol}${param.row}`).value);
      out.total += 1;
      if (valuesMatch(sourceVal, reportVal)) {
        out.matched += 1;
      } else if (blankZeroArtifact(sourceVal, reportVal)) {
        out.artifacts += 1;
      } else {
        out.mismatches.push({
          parameter: param.name,
          sample: sample.name,
          source: `${src.sheet}!${srcCol}${srcStartRow + i}`,
          reportCell: `${reportCol}${param.row}`,
          sourceVal,
          reportVal,
        });
      }
    }
  }
  return out;
}
