// Parse the "REPORT DATA" sheet into a structured parameter map.
//
// Each parameter row in REPORT DATA looks like:
//   A: instrument-source dropdown (metals only)   e.g. "ICPOES"
//   C: parameter name                             e.g. "Aluminum"
//   D: units   (formula -> CODES)                 e.g. "mg/L"
//   E: CDWQ guideline (formula -> CODES)          e.g. "2.9 (MAC) ; 0.1 (OG)"
//   F: spilling TRANSPOSE array formula pulling that parameter's reportable
//      column from an input sheet, across the sample columns G..AX.
//
// The F formula is the authority on WHERE each parameter's values come from:
//   single:  =TRANSPOSE('PHYSICAL RESULTS'!A18:A62)
//   switch:  =IF(A26="ICPOES",TRANSPOSE('ICPOES RESULTS'!E70:E114),
//                IF(A26="ICPQQQ",TRANSPOSE('ICPQQQ RESULTS'!G69:G113),"ERROR"))
//
// Pure parsing given an exceljs worksheet + helpers. No file I/O.

import { cellText, isFormulaCell, parseRange, resolveFormula } from "./sheet-utils.mjs";

// Matches: optional preceding `A26="ICPOES",` condition, then TRANSPOSE(<ref>).
const SOURCE_RE =
  /(?:([A-Z]+\d+)\s*=\s*"([^"]+)"\s*,\s*)?TRANSPOSE\(\s*(?:'([^']+)'|([A-Za-z0-9_ ]+?))!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)\s*\)/g;

/**
 * Parse a REPORT DATA column-F formula into its source(s).
 * @returns {{ dropdownRef: string|null, sources: Array<{when: string|null, sheet: string, range: string}> }}
 */
export function parseSourceFormula(formula) {
  const sources = [];
  let dropdownRef = null;
  let m;
  SOURCE_RE.lastIndex = 0;
  while ((m = SOURCE_RE.exec(formula)) !== null) {
    const [, condRef, condValue, quotedSheet, bareSheet, range] = m;
    if (condRef && !dropdownRef) dropdownRef = condRef;
    sources.push({
      when: condValue ?? null,
      sheet: (quotedSheet ?? bareSheet ?? "").trim(),
      range,
    });
  }
  return { dropdownRef, sources };
}

/**
 * Auto-detect the column layout of a REPORT DATA-style sheet.
 * The main sheet uses C/D/E/F (+A dropdown); the "ONLY" variants are shifted to
 * B/C/D/E. We anchor on the "Units" header cell, which is always one column
 * right of the parameter name and one left of the guideline + source columns.
 *
 * @returns {{nameCol, unitsCol, guidelineCol, sourceCol, dropdownCol}|null}
 */
export function detectLayout(ws) {
  const maxScan = Math.min(ws.rowCount, 30);
  for (let row = 1; row <= maxScan; row += 1) {
    for (let col = 1; col <= Math.min(ws.columnCount, 12); col += 1) {
      if (cellText(ws.getCell(row, col).value) !== "Units") continue;
      const unitsCol = col;
      const nameCol = col - 1;
      const guidelineCol = col + 1;
      // source col = first column right of the guideline holding a TRANSPOSE formula
      let sourceCol = col + 2;
      for (let c = col + 2; c <= col + 5; c += 1) {
        const f = resolveFormula(ws, ws.getCell(row, c), row, c);
        if (f && /TRANSPOSE\(/.test(f)) {
          sourceCol = c;
          break;
        }
      }
      // dropdown col: a column left of the name holding an instrument value somewhere
      let dropdownCol = null;
      for (let c = 1; c < nameCol; c += 1) {
        for (let r = row; r <= Math.min(ws.rowCount, row + 50); r += 1) {
          if (/^(ICPOES|ICPMS|ICPQQQ)$/.test(cellText(ws.getCell(r, c).value))) {
            dropdownCol = c;
            break;
          }
        }
        if (dropdownCol) break;
      }
      return { nameCol, unitsCol, guidelineCol, sourceCol, dropdownCol };
    }
  }
  return null;
}

/**
 * Build the parameter map for one REPORT DATA worksheet. Column layout is
 * auto-detected unless explicitly supplied in opts.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {object} [opts] - explicit { nameCol, unitsCol, guidelineCol, sourceCol, dropdownCol }
 * @returns {{ layout: object, headers: object[], parameters: object[] }}
 */
export function buildReportMap(ws, opts = {}) {
  const detected = detectLayout(ws) || {};
  const {
    nameCol = detected.nameCol ?? 3,
    unitsCol = detected.unitsCol ?? 4,
    guidelineCol = detected.guidelineCol ?? 5,
    sourceCol = detected.sourceCol ?? 6,
    dropdownCol = detected.dropdownCol ?? null,
  } = opts;
  const parameters = [];
  const headers = [];
  let currentSection = null;

  const lastRow = ws.rowCount;
  for (let row = 1; row <= lastRow; row += 1) {
    const sourceCell = ws.getCell(row, sourceCol);
    const name = cellText(ws.getCell(row, nameCol));

    // Section header rows have a name + a TRANSPOSE source (sample-name row) but
    // the "name" column holds the section title and units col reads "Units".
    const unitsText = cellText(ws.getCell(row, unitsCol));
    const isHeader = unitsText === "Units";
    if (isHeader) {
      currentSection = name;
      headers.push({ row, section: name });
      continue;
    }

    if (!name || !isFormulaCell(sourceCell.value)) continue;

    const formula = resolveFormula(ws, sourceCell, row, sourceCol);
    const { dropdownRef, sources } = parseSourceFormula(formula || "");
    if (sources.length === 0) continue;

    const dropdownValue =
      dropdownRef && dropdownCol ? cellText(ws.getCell(row, dropdownCol)) : null;

    parameters.push({
      row,
      section: currentSection,
      name,
      units: cellText(ws.getCell(row, unitsCol)),
      guideline: cellText(ws.getCell(row, guidelineCol)),
      dropdownRef,
      dropdownValue,
      sources: sources.map((s) => ({ ...s, parsed: parseRange(`${s.sheet}!${s.range}`) })),
    });
  }

  return { layout: { nameCol, unitsCol, guidelineCol, sourceCol, dropdownCol }, headers, parameters };
}
