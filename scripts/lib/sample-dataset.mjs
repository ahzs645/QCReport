// The "sample dataset" — the bridge format between a populated workbook (or the
// raw-instrument ingest in Phase 2) and the re-export / report steps.
//
// It captures exactly the cells that distinguish one run from another:
//   - cells:     every sample-input value (the cells clearSampleData blanks)
//   - dropdowns: the REPORT DATA instrument-source selections (col A)
//   - samples:   the classified sample list (client / rl / placeholder)
//
// extractInputs() reads a dataset from a populated workbook (round-trip / re-export
// of an existing run); injectInputs() stamps a dataset into the blank template.

import { cellValue, numberToCol } from "./sheet-utils.mjs";
import { eachInputCell, getSamples } from "./results-workbook.mjs";

/** Capture the dropdown (instrument-source) cells for every report sheet. */
function extractDropdowns(wb, spec) {
  const dropdowns = [];
  for (const [sheetName, report] of Object.entries(spec.reportSheets)) {
    const col = report.layout?.dropdownCol;
    if (!col) continue;
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    for (const param of report.parameters) {
      if (!param.dropdownRef) continue;
      const ref = `${numberToCol(col)}${param.row}`;
      const value = cellValue(ws.getCell(ref).value);
      if (value !== null && value !== "") dropdowns.push({ sheet: sheetName, ref, value });
    }
  }
  return dropdowns;
}

/**
 * Build a dataset from a populated workbook.
 * @returns {{ version, source, samples, cells, dropdowns }}
 */
export function extractInputs(wb, spec, source = null) {
  const cells = [];
  eachInputCell(wb, spec, (ws, cell, sheet, row, col) => {
    cells.push({ sheet, ref: `${numberToCol(col)}${row}`, value: cellValue(cell.value) });
  });
  return {
    version: spec.version,
    source,
    samples: getSamples(wb, spec),
    cells,
    dropdowns: extractDropdowns(wb, spec),
  };
}

/**
 * Inject a dataset into a (blank) template workbook in place.
 * Writes input values, then dropdown selections. Formulas are untouched, and the
 * workbook recalculates on open (fullCalcOnLoad set by clearSampleData).
 *
 * @returns {{ cells: number, dropdowns: number, missingSheets: string[] }}
 */
export function injectInputs(wb, dataset) {
  const missingSheets = new Set();
  let cellCount = 0;
  let dropdownCount = 0;

  for (const { sheet, ref, value } of dataset.cells || []) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) {
      missingSheets.add(sheet);
      continue;
    }
    ws.getCell(ref).value = value;
    cellCount += 1;
  }

  for (const { sheet, ref, value } of dataset.dropdowns || []) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) {
      missingSheets.add(sheet);
      continue;
    }
    ws.getCell(ref).value = value;
    dropdownCount += 1;
  }

  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return { cells: cellCount, dropdowns: dropdownCount, missingSheets: [...missingSheets] };
}
