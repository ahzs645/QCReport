// Domain model of the NALS "*_RESULTS_*.xlsx" calculation workbook.
//
// Responsibilities:
//   - classify sheets (input / report / lookup)
//   - parse each per-sample reportable formula to discover, data-driven:
//       input cell, detection-limit cell (row 63), "<DL" label cell (row 64),
//       and whether the formula does Uncal / over-range flag checks
//   - build a machine-readable spec of the whole workbook
//   - clear sample data (for producing the blank template)
//
// Everything is derived by PARSING the workbook, not hard-coded row numbers, so
// the model survives REV changes as long as the formula shapes hold.

import ExcelJS from "exceljs";
import { buildReportMap } from "./report-map.mjs";
import {
  cellText,
  cellValue,
  isFormulaCell,
  numberToCol,
  parseRef,
  resolveFormula,
  toNumber,
} from "./sheet-utils.mjs";

export const SHEET_ROLES = Object.freeze({
  INSTRUMENT: "instrument", // ICPOES/ICPMS/ICPQQQ/IC RESULTS (input -> reportable region)
  DIRECT: "direct", // PHYSICAL/BIOLOGICAL RESULTS (report pulls input rows directly)
  REPORT: "report", // REPORT DATA + variants
  LOOKUP: "lookup", // CODES, INSTRUCTIONS, TRACKED CHANGES
});

const INSTRUMENT_SHEETS = ["ICPOES RESULTS", "ICPMS RESULTS", "ICPQQQ RESULTS", "IC RESULTS"];
const DIRECT_SHEETS = ["PHYSICAL RESULTS", "BIOLOGICAL RESULTS"];

export function classifySheet(name) {
  if (INSTRUMENT_SHEETS.includes(name)) return SHEET_ROLES.INSTRUMENT;
  if (DIRECT_SHEETS.includes(name)) return SHEET_ROLES.DIRECT;
  if (name.startsWith("REPORT DATA")) return SHEET_ROLES.REPORT;
  return SHEET_ROLES.LOOKUP;
}

/** Open an .xlsx into an exceljs workbook (Node — reads from a path). */
export async function openWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

/** Load an .xlsx from an ArrayBuffer/Buffer into an exceljs workbook (browser-safe). */
export async function loadWorkbook(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  return wb;
}

// Editable report header fields (col-A label -> the value cell to its right in col B).
// "perRun" fields vary per report (and are scrubbed from blank templates + entered
// in the app); "constant" fields (lab director, DL file) are stable defaults.
export const HEADER_FIELDS = [
  { key: "analyst", label: "Analyst", match: /^analyst/i, perRun: true },
  { key: "nalsDirector", label: "NALS Director", match: /^nals director/i, perRun: false },
  { key: "date", label: "Date", match: /^date/i, perRun: true },
  { key: "clientName", label: "Client Name", match: /^client name/i, perRun: true },
  { key: "supervisor", label: "Supervisor", match: /^supervisor/i, perRun: true },
  { key: "clientCompany", label: "Client Company Name", match: /^client company/i, perRun: true },
  { key: "referenceFile", label: "Reference File", match: /^reference file/i, perRun: true },
  { key: "numberOfSamples", label: "Number of Samples", match: /^number of samples/i, perRun: true },
  { key: "detectionLimitsFile", label: "Detection Limits File", match: /^detection limits file/i, perRun: false },
];

/**
 * Locate the header value cells in a sheet by scanning column A for the known
 * labels. Returns { key: "B5", … } for whichever fields are present.
 */
export function findHeaderFields(wb, sheetName) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return {};
  const refs = {};
  for (let r = 1; r <= 24; r += 1) {
    const label = cellText(ws.getCell(`A${r}`).value);
    if (!label) continue;
    for (const f of HEADER_FIELDS) {
      if (!refs[f.key] && f.match.test(label)) refs[f.key] = `B${r}`;
    }
  }
  return refs;
}

/** Workbook template version, from INSTRUCTIONS!A3 (falls back to CODES!A2 cached). */
export function getVersion(wb) {
  const instr = wb.getWorksheet("INSTRUCTIONS");
  if (instr) {
    const v = cellText(instr.getCell("A3"));
    if (v) return v;
  }
  const codes = wb.getWorksheet("CODES");
  return codes ? cellText(codes.getCell("A2")) : "";
}

/**
 * Parse a per-sample reportable formula and return the cells it depends on.
 * Handles the full ICPOES tree and the reduced ICPMS/ICPQQQ/IC tree.
 *
 * @returns {null | { inputRef, dlRef, labelRef, checksUncal, checksOver }}
 */
export function parseReportableFormula(formula) {
  if (!formula || !/ISBLANK\(/.test(formula) || !/NO DATA/.test(formula)) return null;
  const inputRef = (formula.match(/ISBLANK\((\$?[A-Z]+\$?\d+)\)/) || [])[1];
  const dlRef = (formula.match(/<\s*(\$?[A-Z]+\$?\d+)/) || [])[1];
  // label is the "value if true" of: IF(OR(in<dl, ISNUMBER(in)=FALSE), LABEL, in)
  const labelRef = (formula.match(/ISNUMBER\([A-Z]+\d+\)\s*=\s*FALSE\)\s*,\s*(\$?[A-Z]+\$?\d+)/) || [])[1];
  if (!inputRef || !dlRef || !labelRef) return null;
  return {
    inputRef: inputRef.replace(/\$/g, ""),
    dlRef: dlRef.replace(/\$/g, ""),
    labelRef: labelRef.replace(/\$/g, ""),
    checksUncal: /FIND\(CODES!\$A\$12/.test(formula),
    checksOver: /FIND\(CODES!\$A\$1[01]/.test(formula),
  };
}

/**
 * Build the model of one instrument input sheet: the analyte columns with their
 * input/DL/label cells, sample-name columns, and the input/reportable row bands.
 */
export function buildInstrumentSheetModel(ws) {
  // One analyte entry per reportable COLUMN (DL/label are column-anchored at $63/$64,
  // so a single representative row per column is sufficient).
  const byCol = new Map();
  const sampleNameCols = new Map(); // reportable col -> input source col (e.g. A70 = =A18)
  let inputRowMin = Infinity;
  let inputRowMax = -Infinity;
  let reportRowMin = Infinity;
  let reportRowMax = -Infinity;

  ws.eachRow({ includeEmpty: false }, (rowObj, rowNumber) => {
    rowObj.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!isFormulaCell(cell.value)) return;
      const formula = resolveFormula(ws, cell, rowNumber, colNumber);
      const parsed = parseReportableFormula(formula);
      if (parsed) {
        const reportableCol = numberToCol(colNumber);
        const inRow = parseRef(parsed.inputRef).row;
        inputRowMin = Math.min(inputRowMin, inRow);
        inputRowMax = Math.max(inputRowMax, inRow);
        reportRowMin = Math.min(reportRowMin, rowNumber);
        reportRowMax = Math.max(reportRowMax, rowNumber);
        if (!byCol.has(reportableCol)) {
          const inputCol = parseRef(parsed.inputRef).colLetter;
          // analyte label lives two rows above the input band (e.g. row 16: "Al 396.152 nm")
          const labelRow = inputRowMin - 2;
          const label = labelRow > 0 ? cellText(ws.getCell(`${inputCol}${labelRow}`).value) : "";
          byCol.set(reportableCol, {
            reportableCol,
            inputCol,
            label,
            dlRef: parsed.dlRef,
            labelRef: parsed.labelRef,
            checksUncal: parsed.checksUncal,
            checksOver: parsed.checksOver,
            detectionLimitRaw: cellValue(ws.getCell(parsed.dlRef).value),
            detectionLimit: toNumber(cellValue(ws.getCell(parsed.dlRef).value)),
            belowLabel: cellText(ws.getCell(parsed.labelRef).value),
          });
        }
      } else if (/^=\$?[A-Z]+\$?\d+$/.test(formula || "")) {
        // sample-name / id pass-through like =A18
        const reportableCol = numberToCol(colNumber);
        if (!sampleNameCols.has(reportableCol)) {
          sampleNameCols.set(reportableCol, parseRef(formula.slice(1)).colLetter);
        }
      }
    });
  });

  return {
    analytes: [...byCol.values()],
    sampleNameCols: Object.fromEntries(sampleNameCols),
    inputRows: Number.isFinite(inputRowMin) ? { start: inputRowMin, end: inputRowMax } : null,
    reportableRows: Number.isFinite(reportRowMin) ? { start: reportRowMin, end: reportRowMax } : null,
  };
}

/**
 * Build the complete machine-readable spec of the workbook.
 * @returns {object} serialisable spec (write to templates/workbook-spec.json)
 */
export function buildSpec(wb) {
  const sheets = wb.worksheets.map((ws) => ({ name: ws.name, role: classifySheet(ws.name) }));

  const reportSheets = {};
  for (const ws of wb.worksheets) {
    if (classifySheet(ws.name) === SHEET_ROLES.REPORT) {
      reportSheets[ws.name] = buildReportMap(ws);
    }
  }

  const instrumentSheets = {};
  for (const name of INSTRUMENT_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (ws) instrumentSheets[name] = buildInstrumentSheetModel(ws);
  }

  return {
    version: getVersion(wb),
    generatedFrom: null, // filled by the extract script
    sheets,
    instrumentSheets,
    reportSheets,
    primaryReportSheet: reportSheets["REPORT DATA"] ? "REPORT DATA" : Object.keys(reportSheets)[0] || null,
  };
}

/**
 * The {sheet: {start,end}} data bands that hold sample-specific typed input:
 * the instrument input row bands plus the direct-sheet data bands.
 */
export function inputBands(spec) {
  const bands = {};
  for (const [name, model] of Object.entries(spec.instrumentSheets)) {
    if (model.inputRows) bands[name] = model.inputRows;
  }
  Object.assign(bands, directSheetBands(spec));
  return bands;
}

/**
 * Iterate every sample-input cell (non-formula cells within the input bands),
 * invoking cb(ws, cell, sheetName, row, col). Shared by clearSampleData and the
 * dataset extractor so "what counts as sample data" is defined in one place.
 */
export function eachInputCell(wb, spec, cb) {
  for (const [name, band] of Object.entries(inputBands(spec))) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const maxCol = ws.columnCount;
    for (let r = band.start; r <= band.end; r += 1) {
      for (let c = 1; c <= maxCol; c += 1) {
        const cell = ws.getCell(r, c);
        if (cell.value === null || cell.value === undefined) continue;
        if (isFormulaCell(cell.value)) continue; // keep formulas (hardness, =A18, etc.)
        cb(ws, cell, name, r, c);
      }
    }
  }
}

/**
 * Clear all sample-specific typed data in place (preserving every formula),
 * producing a blank template. Mutates the workbook.
 */
export function clearSampleData(wb, spec) {
  const perSheet = {};
  eachInputCell(wb, spec, (ws, cell, name) => {
    cell.value = null;
    perSheet[name] = (perSheet[name] || 0) + 1;
  });
  // Force Excel to recalculate cached results when the blank template is opened.
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  const sheets = Object.entries(perSheet).map(([name, cleared]) => ({ name, cleared }));
  return { cells: sheets.reduce((s, x) => s + x.cleared, 0), sheets };
}

/**
 * Drop conditional-formatting rules exceljs cannot round-trip (extension/x14
 * rules arrive with no operator/formulae and crash on write). Cosmetic only —
 * the blue input / red over-range highlighting may be lost; formulas are intact.
 * Mutates the workbook. Returns the number of rules removed.
 */
export function sanitizeConditionalFormatting(wb) {
  let removed = 0;
  for (const ws of wb.worksheets) {
    const cfs = ws.conditionalFormattings;
    if (!Array.isArray(cfs) || cfs.length === 0) continue;
    for (const cf of cfs) {
      const before = (cf.rules || []).length;
      cf.rules = (cf.rules || []).filter((rule) => {
        if (rule.type === "cellIs") return Boolean(rule.operator) && Array.isArray(rule.formulae);
        if (rule.type === "expression") return Array.isArray(rule.formulae);
        return true; // colorScale / dataBar / iconSet etc. left as-is
      });
      removed += before - cf.rules.length;
    }
    ws.conditionalFormattings = cfs.filter((cf) => cf.rules && cf.rules.length > 0);
  }
  return removed;
}

const PLACEHOLDER_NAME = /^Sample \d+$/;

/**
 * The samples in the workbook, in column order. Sample identity is owned by
 * ICPOES RESULTS columns A (name) and B (id) across the input row band; every
 * other sheet references those. `index` 0 maps to REPORT DATA's first sample
 * (source) column. Each row is classified:
 *   kind: "client" — a real client sample (real name + NALS id)
 *         "rl"     — the reporting-limit reference column (name/id "RL")
 *         "placeholder" — empty "Sample N" padding row
 */
export function getSamples(wb, spec) {
  const owner = wb.getWorksheet("ICPOES RESULTS");
  const band = spec.instrumentSheets?.["ICPOES RESULTS"]?.inputRows;
  if (!owner || !band) return [];
  const samples = [];
  for (let row = band.start; row <= band.end; row += 1) {
    const name = cellText(owner.getCell(`A${row}`).value);
    if (!name) continue;
    const id = cellText(owner.getCell(`B${row}`).value);
    let kind = "client";
    if (name === "RL" || id === "RL") kind = "rl";
    else if (PLACEHOLDER_NAME.test(name) && !id) kind = "placeholder";
    samples.push({ index: row - band.start, row, name, id, kind });
  }
  return samples;
}

/** Real client samples only — one Water Analysis Report is produced per entry. */
export function getClientSamples(wb, spec) {
  return getSamples(wb, spec).filter((s) => s.kind === "client");
}

/** Derive {sheet: {start,end}} data bands for DIRECT sheets from report-map ranges. */
export function directSheetBands(spec) {
  const bands = {};
  for (const report of Object.values(spec.reportSheets)) {
    for (const param of report.parameters) {
      for (const src of param.sources) {
        if (classifySheet(src.sheet) !== SHEET_ROLES.DIRECT) continue;
        const { start, end } = src.parsed;
        const cur = bands[src.sheet] || { start: Infinity, end: -Infinity };
        cur.start = Math.min(cur.start, start.row);
        cur.end = Math.max(cur.end, end.row);
        bands[src.sheet] = cur;
      }
    }
  }
  return bands;
}
