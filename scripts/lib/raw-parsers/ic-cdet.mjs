// Parser for the raw IC (ion chromatography) export (.xls, via SheetJS).
//
// The workbook has a "CDet" (conductivity) sheet and a "UV at 210nm" sheet:
//   row 0: headers — "Sample", then anion names (Fluoride, Chloride, …)
//   row 1: units (mg/L)
//   row 2+: one row per run entry; col 0 is the sample label
//           ("2026NALS02604 Kitchen", "… - Dil. 10X").
// An anion not measured on a detector reads "n.a."; the IC RESULTS reportable
// formula turns that (non-numeric) into the "<DL" label, matching the analyst.
//
// We use CDet as the primary detector (matches the analyst's paste); the UV sheet
// is parsed too and offered as a fallback for anions that are "n.a." on CDet.
//
// Analytes match the IC RESULTS row-16 labels by anion name (lowercased).

import * as XLSX from "xlsx";
import { isDilution, dilutionFactor } from "./normalize.mjs";

/** Analyte matching key for IC: the lowercased anion name. */
export const analyteKey = (label) => String(label ?? "").trim().toLowerCase();

const SAMPLE_COL = 0;

function parseSheet(ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  if (!grid.length) return { analytes: [], rows: [] };
  const header = grid[0] || [];
  const analytes = [];
  for (let c = SAMPLE_COL + 1; c < header.length; c += 1) {
    const name = header[c];
    if (name === undefined || String(name).trim() === "") continue;
    analytes.push({ rawLabel: String(name), key: analyteKey(name), col: c });
  }
  const rows = [];
  // grid[1] is the units row; data starts at grid[2]
  for (let r = 2; r < grid.length; r += 1) {
    const line = grid[r] || [];
    const label = line[SAMPLE_COL];
    if (label === undefined || String(label).trim() === "") continue;
    const values = {};
    for (const a of analytes) {
      const v = line[a.col];
      if (v !== undefined && v !== null && String(v).trim() !== "") values[a.key] = v;
    }
    rows.push({
      label: String(label).trim(),
      isDilution: isDilution(label),
      dilutionFactor: dilutionFactor(label),
      values,
    });
  }
  return { analytes, rows };
}

/** True if a SheetJS workbook looks like a raw IC export. */
export function isIcWorkbook(wb) {
  return wb.SheetNames.some((n) => /cdet|uv at/i.test(n));
}

/**
 * Parse the raw IC export, merging CDet (primary) with UV (fallback for n.a.).
 * @returns {{ sheet, analytes, rows }}
 */
/**
 * Parse an already-loaded SheetJS workbook (browser-safe — no I/O). Node callers
 * read the file themselves (`XLSX.readFile`); the browser uses
 * `XLSX.read(arrayBuffer, { type: "array" })`. The shared module avoids `readFile`
 * because the browser ESM build of SheetJS does not include it.
 * @returns {{ sheet, analytes, rows }}
 */
export function parseIcWorkbook(wb, { useUvFallback = true } = {}) {
  const cdetName = wb.SheetNames.find((n) => /cdet/i.test(n)) || wb.SheetNames[0];
  const cdet = parseSheet(wb.Sheets[cdetName]);
  if (!useUvFallback) return { sheet: cdetName, ...cdet };

  const uvName = wb.SheetNames.find((n) => /uv/i.test(n));
  if (!uvName) return { sheet: cdetName, ...cdet };
  const uv = parseSheet(wb.Sheets[uvName]);
  const uvByLabel = new Map(uv.rows.map((row) => [row.label.toLowerCase(), row]));

  // Merge: keep CDet values; where CDet is "n.a."/missing, borrow a numeric UV value.
  const analytes = [...cdet.analytes];
  const knownKeys = new Set(analytes.map((a) => a.key));
  for (const a of uv.analytes) if (!knownKeys.has(a.key)) analytes.push(a);
  for (const row of cdet.rows) {
    const uvRow = uvByLabel.get(row.label.toLowerCase());
    if (!uvRow) continue;
    for (const [key, value] of Object.entries(uvRow.values)) {
      const cur = row.values[key];
      const curIsNa = cur === undefined || /n\.?a\.?/i.test(String(cur));
      const uvIsNum = !/n\.?a\.?/i.test(String(value));
      if (curIsNa && uvIsNum) row.values[key] = value;
    }
  }
  return { sheet: cdetName, analytes, rows: cdet.rows };
}
