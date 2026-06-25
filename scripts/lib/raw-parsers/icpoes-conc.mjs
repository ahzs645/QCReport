// Parser for the raw ICPOES instrument export (.xlsx) — the "Conc" sheet that
// the analyst copy/pastes into ICPOES RESULTS.
//
// Layout:
//   row 1: headers — B "Rack:Tube", C "Solution Label", D.. analyte+wavelength
//          columns ("Al 396.152 nm mg/L")
//   row 2+: one row per run entry (blanks, standards, CCV, rinses, samples,
//           dilutions). Client samples carry the NALS id as the Solution Label
//           (e.g. "2026NALS02598 A06"); dilutions add "Dil. 10X".
//
// Returns a normalised structure; matching to workbook columns/samples is done
// by the ingest layer.

import ExcelJS from "exceljs";
import { cellValue, numberToCol } from "../sheet-utils.mjs";
import { dilutionFactor, isDilution, normalizeAnalyteLabel } from "./normalize.mjs";

const SOLUTION_LABEL_COL = 3; // C
const FIRST_ANALYTE_COL = 4; // D

/** Analyte matching key for ICPOES: the element+wavelength sans units. */
export const analyteKey = normalizeAnalyteLabel;

// Instrument exports name the adjusted-concentration sheet "Conc", "Concentration",
// or "Raw Data" (all carry "… nm mg/L" columns); the unadjusted sheet contains
// "Unad"/"Unadjusted". "Intensity" (… c/s) is neither.
const isUnadjustedName = (n) => /unad/i.test(n);

/** Pick the concentration sheet: kind = "adjusted" (default) | "unadjusted". */
export function pickConcSheet(wb, kind = "adjusted") {
  const sheets = wb.worksheets;
  if (kind === "unadjusted") {
    return (
      sheets.find((s) => isUnadjustedName(s.name) && /conc/i.test(s.name)) ||
      sheets.find((s) => isUnadjustedName(s.name)) ||
      null
    );
  }
  return (
    sheets.find((s) => /^(conc|concentration)$/i.test(s.name.trim())) ||
    sheets.find((s) => /^raw data$/i.test(s.name.trim())) ||
    sheets.find((s) => /conc/i.test(s.name) && !isUnadjustedName(s.name)) ||
    null
  );
}

/** Identify whether a workbook looks like a raw ICPOES export. */
export function isIcpoesConcWorkbook(wb) {
  return Boolean(pickConcSheet(wb, "adjusted") || pickConcSheet(wb, "unadjusted"));
}

/**
 * Parse the raw ICPOES Conc sheet.
 * @param {string} filePath
 * @param {object} [opts]
 * @param {string} [opts.sheet] - explicit sheet name (used if it exists)
 * @param {"adjusted"|"unadjusted"} [opts.kind] - which conc sheet to auto-pick
 * @returns {Promise<{ sheet, analytes, rows }>}
 */
export async function parseIcpoesConc(filePath, opts = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return parseIcpoesConcWorkbook(wb, opts);
}

/**
 * Pure variant: parse an already-loaded exceljs workbook (browser-safe — no I/O).
 * @param {import('exceljs').Workbook} wb
 * @param {object} [opts] - { sheet?, kind? }
 * @returns {{ sheet, analytes, rows }}
 */
export function parseIcpoesConcWorkbook(wb, opts = {}) {
  const ws = (opts.sheet && wb.getWorksheet(opts.sheet)) || pickConcSheet(wb, opts.kind || "adjusted");
  if (!ws) throw new Error("No concentration sheet (Conc / Concentration / Raw Data) found in workbook");

  // Header row → analyte columns.
  const analytes = [];
  const maxCol = ws.columnCount;
  for (let c = FIRST_ANALYTE_COL; c <= maxCol; c += 1) {
    const rawLabel = cellValue(ws.getCell(1, c).value);
    if (rawLabel === null || String(rawLabel).trim() === "") continue;
    analytes.push({ rawLabel: String(rawLabel), key: normalizeAnalyteLabel(rawLabel), col: numberToCol(c) });
  }

  // Data rows.
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const label = cellValue(ws.getCell(r, SOLUTION_LABEL_COL).value);
    if (label === null || String(label).trim() === "") continue;
    const values = {};
    for (const a of analytes) {
      const v = cellValue(ws.getCell(`${a.col}${r}`).value);
      if (v !== null) values[a.key] = v;
    }
    rows.push({
      row: r,
      label: String(label).trim(),
      isDilution: isDilution(label),
      dilutionFactor: dilutionFactor(label),
      values,
    });
  }

  return { sheet: ws.name, analytes, rows };
}
