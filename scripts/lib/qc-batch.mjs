// QC BatchA workbook (template NALS_WTRICPOES_QC_XL) — ingest + validate.
//
// The BATCH sheet receives the ICPOES *Unadjusted* QC data into GREEN cells:
//   row 17: analyte headers (same "Ag 328.068 nm" labels as ICPOES RESULTS)
//   row 18: "QA/QC SAMPLES NAMES" | "Comment" | units …
//   rows 19..N: one QC row each —
//       col A = QC role  ("IPC Blank after Calibration", "Digest LFB", "SAMPLE,
//               RPD Calculated", "LFM Background (10X Dil.)", …)
//       col B = the raw solution label that feeds this row ("IPC Blank",
//               "CCV 500ppb", "2026NALS02621 A03 - Dil. 10X", …)
//       col C..  = the pasted analyte values (GREEN)
//   then "Reportable Limit …" rows.
//
// Reconstruction: column B tells us which raw Unadjusted row to pull for each QC
// row; analytes match by label (row 17). The QC-role -> raw-row choice itself is
// the analyst's (it's recorded in column B), so we honour the existing mapping.

import { cellValue, isFormulaCell, numberToCol } from "./sheet-utils.mjs";
import { normalizeAnalyteLabel, normalizeSampleId } from "./raw-parsers/normalize.mjs";

const FIRST_ANALYTE_COL = 3; // C
const ROLE_COL = 1; // A
const RAWLABEL_COL = 2; // B
const SKIP_RAWLABEL = /DO NOT INPUT|USED ONLY|^N\/?A$/i;

/**
 * Parse the BATCH sheet structure of a QC workbook.
 * @returns {{ headerRow, analyteRow, analytes:[{label,key,col}], qcRows:[{row,role,rawLabel}] }}
 */
export function parseQcBatch(wb) {
  const ws = wb.getWorksheet("BATCH");
  if (!ws) throw new Error("QC workbook has no BATCH sheet");

  // Find the "QA/QC SAMPLES NAMES" header row; analyte labels are the row above.
  let headerRow = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r += 1) {
    if (/QA\/QC SAMPLES NAMES/i.test(String(cellValue(ws.getCell(r, ROLE_COL).value) ?? ""))) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) throw new Error("Could not locate the 'QA/QC SAMPLES NAMES' header row");
  const analyteRow = headerRow - 1;

  const analytes = [];
  for (let c = FIRST_ANALYTE_COL; c <= ws.columnCount; c += 1) {
    const label = cellValue(ws.getCell(analyteRow, c).value);
    if (label === null || String(label).trim() === "") continue;
    analytes.push({ label: String(label), key: normalizeAnalyteLabel(label), col: numberToCol(c) });
  }

  const qcRows = [];
  let limitRowStart = null;
  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const role = cellValue(ws.getCell(r, ROLE_COL).value);
    if (role === null) continue;
    if (/Reportable Limit/i.test(String(role))) {
      limitRowStart = r;
      break;
    }
    const rawLabel = cellValue(ws.getCell(r, RAWLABEL_COL).value);
    if (rawLabel === null || SKIP_RAWLABEL.test(String(rawLabel))) continue;
    qcRows.push({ row: r, role: String(role), rawLabel: String(rawLabel) });
  }

  // The two "Reportable Limit" rows hold per-analyte DL numbers then "<DL" labels.
  if (limitRowStart) {
    for (const a of analytes) {
      a.detectionLimit = cellValue(ws.getCell(`${a.col}${limitRowStart}`).value);
      a.belowLabel = String(cellValue(ws.getCell(`${a.col}${limitRowStart + 1}`).value) ?? "");
    }
  }

  return { headerRow, analyteRow, analytes, qcRows, limitRowStart };
}

/**
 * Reconstruct the QC green cells from the raw ICPOES *Unadjusted* data.
 * @param {object} qc - parseQcBatch() result
 * @param {object} rawUnadjusted - parseIcpoesConc(..., {sheet:"Unadjusted Concentration"})
 * @returns {{ cells, warnings, matchedRows }}
 */
export function ingestQcBatch(qc, rawUnadjusted, { sheetName = "BATCH" } = {}) {
  const cells = [];
  const warnings = [];

  // Keep every occurrence of each label — QC labels like "IPC Blank" / "CCV 500ppb"
  // recur through a run, and which one feeds a given QC row (after calibration vs
  // after batch) is the analyst's positional choice, not encoded in the label.
  const rawByLabel = new Map();
  for (const row of rawUnadjusted.rows) {
    const key = normalizeSampleId(row.label);
    if (!rawByLabel.has(key)) rawByLabel.set(key, []);
    rawByLabel.get(key).push(row);
  }

  let matchedRows = 0;
  let ambiguousRows = 0;
  for (const qcRow of qc.qcRows) {
    const matches = rawByLabel.get(normalizeSampleId(qcRow.rawLabel)) || [];
    if (matches.length === 0) {
      warnings.push({ kind: "qc_raw_row_not_found", role: qcRow.role, rawLabel: qcRow.rawLabel });
      continue;
    }
    if (matches.length > 1) {
      ambiguousRows += 1;
      warnings.push({
        kind: "qc_ambiguous_label",
        role: qcRow.role,
        rawLabel: qcRow.rawLabel,
        occurrences: matches.length,
        note: "label recurs in the run; used first occurrence — verify (e.g. after-calibration vs after-batch)",
      });
    }
    const raw = matches[0];
    matchedRows += 1;
    for (const a of qc.analytes) {
      const value = raw.values[a.key];
      if (value === undefined) continue;
      cells.push({ sheet: sheetName, ref: `${a.col}${qcRow.row}`, value });
    }
  }

  return { cells, warnings, matchedRows, ambiguousRows };
}

/**
 * Clear the QC green input cells (analyte values in the QC rows) in place,
 * preserving formulas, so a QC workbook can be re-populated from raw. Mutates wb.
 * @returns {number} cells cleared
 */
export function clearQcGreenCells(wb, qc, sheetName = "BATCH") {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return 0;
  let cleared = 0;
  for (const qcRow of qc.qcRows) {
    for (const a of qc.analytes) {
      const cell = ws.getCell(`${a.col}${qcRow.row}`);
      if (cell.value === null || cell.value === undefined || isFormulaCell(cell.value)) continue;
      cell.value = null;
      cleared += 1;
    }
  }
  return cleared;
}
