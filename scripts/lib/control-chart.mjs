// Shewhart control charts for the Digest LFB (lab fortified blank) recovery,
// tracked per element across the year's batches. Reproduces the
// NALS_DIGEST_LFB_…_ControlChart workbook: center line = mean of the LFB values
// (ignoring zeros), control limits at ±1σ/±2σ/±3σ. The LFB values are the same
// Unadjusted measurements the QC engine uses, so each ingested run adds a point.
//
// Pure — no I/O. Tested in test/control-chart.test.mjs and verified against the
// real workbook's cached mean/std.

import { cellValue, numberToCol } from "./sheet-utils.mjs";
import { toNumber } from "./sheet-utils.mjs";

/** Mean and sample (n−1) standard deviation of the non-zero, numeric values. */
export function controlStats(values) {
  const nums = values.map(toNumber).filter((v) => v !== null && v !== 0);
  const n = nums.length;
  if (n === 0) return { mean: null, std: null, n: 0 };
  const mean = nums.reduce((s, v) => s + v, 0) / n;
  const std = n > 1 ? Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, std, n };
}

/** Control limits at ±1σ/±2σ/±3σ around the mean. */
export function controlLimits(mean, std) {
  const band = (k) => ({ upper: mean + k * std, lower: mean - k * std });
  return { center: mean, sigma1: band(1), sigma2: band(2), sigma3: band(3) };
}

/** Classify a point against the limits (Shewhart rule 1: beyond 3σ = out of control). */
export function pointStatus(value, limits) {
  const v = toNumber(value);
  if (v === null || !limits) return "n/a";
  if (v > limits.sigma3.upper || v < limits.sigma3.lower) return "out";
  if (v > limits.sigma2.upper || v < limits.sigma2.lower) return "warn";
  return "in";
}

/** Percent deviation from the accepted value: |measured − accepted| / accepted × 100. */
export function rpdFromAccepted(value, acceptedValue) {
  const v = toNumber(value);
  if (v === null || !acceptedValue) return null;
  return (Math.abs(v - acceptedValue) / acceptedValue) * 100;
}

/** Performance vs the criterion (e.g. 20%): PASS when RPD ≤ criterion. */
export function performance(rpd, criterion) {
  if (rpd === null || criterion == null) return "n/a";
  return rpd <= criterion ? "PASS" : "FAIL";
}

/**
 * Parse the ControlChart workbook's RAW DATA sheet.
 * @param {import('exceljs').Workbook} wb
 * @returns {{ acceptedValue, criterion, variable, year, elements:[{label,col}], batches:[{file,date,comment,values}] }}
 */
export function parseControlChartRawData(wb) {
  const ws = wb.getWorksheet("RAW DATA");
  if (!ws) throw new Error("Control-chart workbook has no RAW DATA sheet");

  const acceptedValue = toNumber(cellValue(ws.getCell("C7").value));
  const criterion = toNumber(cellValue(ws.getCell("C6").value));
  const variable = cellValue(ws.getCell("C2").value);
  const year = cellValue(ws.getCell("C1").value);

  // Element headers are on row 11 (D onward); data starts at row 13.
  const FIRST = 4; // D
  const elements = [];
  for (let c = FIRST; c <= ws.columnCount; c += 1) {
    const label = cellValue(ws.getCell(11, c).value);
    if (label !== null && String(label).trim() !== "") {
      elements.push({ label: String(label).trim(), col: numberToCol(c) });
    }
  }

  const batches = [];
  for (let r = 13; r <= ws.rowCount; r += 1) {
    const file = cellValue(ws.getCell(`A${r}`).value);
    if (file === null || String(file).trim() === "") continue;
    const values = {};
    for (const e of elements) values[e.label] = toNumber(cellValue(ws.getCell(`${e.col}${r}`).value));
    batches.push({
      file: String(file),
      date: cellValue(ws.getCell(`B${r}`).value),
      comment: cellValue(ws.getCell(`C${r}`).value),
      values,
    });
  }

  return { acceptedValue, criterion, variable, year, elements, batches };
}

const asTime = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : null);

/**
 * Parse control-chart RAW DATA pasted from Excel (tab- or multi-space-separated),
 * into the same shape as parseControlChartRawData(). Layout:
 *   row: "ICPOES (Unadjusted Data)" <tab> analyte labels…
 *   row: "Excel File" <tab> "Date" <tab> "Comment" <tab> "Conc. (mg/L)" …
 *   rows: file <tab> date <tab> comment <tab> value …   (value at col 3+i for analyte i)
 *
 * @param {string} text
 * @param {object} [opts] - { acceptedValue=0.1, criterion=20, variable="DIGEST LFB" }
 */
export function parsePastedControlData(text, opts = {}) {
  const split = (line) => line.split(/\t+|\s{2,}/).map((c) => c.trim());
  const lines = String(text).replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");

  // analyte-header row = first row that names many " nm" analytes / the Unadjusted header.
  let h = lines.findIndex((l) => /unadjusted/i.test(l) || (l.match(/\bnm\b/g) || []).length >= 3);
  if (h === -1) throw new Error("Could not find the analyte header row (expected 'ICPOES (Unadjusted Data)' + ' nm' labels).");
  // units row immediately follows; data begins after it.
  const unitsRow = h + 1;
  const elements = split(lines[h]).slice(1).filter(Boolean).map((label) => ({ label }));
  if (!elements.length) throw new Error("No analyte columns found in the pasted header.");

  const batches = [];
  for (let i = unitsRow + 1; i < lines.length; i += 1) {
    const cells = split(lines[i]);
    const file = cells[0];
    if (!file || /^#N\/?A/i.test(file)) continue;
    const dateStr = cells[1];
    const date = dateStr ? new Date(dateStr) : null;
    const values = {};
    elements.forEach((e, idx) => {
      values[e.label] = toNumber(cells[3 + idx]);
    });
    batches.push({ file, date: date && !Number.isNaN(date.getTime()) ? date : dateStr, comment: cells[2] ?? null, values });
  }
  if (!batches.length) throw new Error("No data rows found after the header.");

  return {
    acceptedValue: opts.acceptedValue ?? 0.1,
    criterion: opts.criterion ?? 20,
    variable: opts.variable ?? "DIGEST LFB",
    year: null,
    elements,
    batches,
  };
}

/**
 * The curated charted elements — those with a per-element "Control Chart"/"Control
 * Line" sheet — as { name, label }, where name is the sheet's element (e.g.
 * "Aluminum") and label is the chosen wavelength (cell B4, e.g. "Al 396.152 nm").
 */
export function getChartedElements(wb) {
  const out = [];
  for (const ws of wb.worksheets) {
    if (!/Control (Chart|Line)$/i.test(ws.name)) continue;
    const label = cellValue(ws.getCell("B4").value);
    out.push({ name: ws.name.replace(/\s+Control (Chart|Line)$/i, ""), label: label ? String(label).trim() : null });
  }
  return out;
}

/**
 * Build one element's control-chart series from parsed RAW DATA. Optionally
 * restrict to a date window [from,to] (the period defines the data and the
 * control limits, which are recomputed over it) and append newly-ingested points.
 *
 * @param {object} rawData - parseControlChartRawData() result
 * @param {string} elementLabel - the wavelength label (e.g. "Al 396.152 nm")
 * @param {object} [opts]
 * @param {Date|string|null} [opts.from] @param {Date|string|null} [opts.to]
 * @param {Array<{file,date,value}>} [opts.extraPoints]
 * @returns {{ element, stats, limits, acceptedValue, from, to, points }}
 */
export function buildSeries(rawData, elementLabel, opts = {}) {
  const { from = null, to = null, extraPoints = [] } = opts;
  const fromT = asTime(from);
  const toT = asTime(to);
  const inWindow = (d) => {
    const t = asTime(d);
    if (t === null) return true;
    if (fromT !== null && t < fromT) return false;
    if (toT !== null && t > toT) return false;
    return true;
  };

  const base = rawData.batches
    .map((b) => ({ file: b.file, date: b.date, value: b.values[elementLabel] }))
    .filter((p) => p.value !== null && p.value !== undefined && inWindow(p.date));
  const added = extraPoints.filter((p) => inWindow(p.date)).map((p) => ({ ...p, isNew: true }));
  const all = [...base, ...added].sort((a, b) => (asTime(a.date) ?? 0) - (asTime(b.date) ?? 0));

  const stats = controlStats(all.map((p) => p.value));
  const limits = stats.mean === null ? null : controlLimits(stats.mean, stats.std);
  const { acceptedValue, criterion } = rawData;
  const points = all.map((p) => {
    const rpd = rpdFromAccepted(p.value, acceptedValue);
    return {
      file: p.file,
      date: p.date,
      value: p.value,
      status: pointStatus(p.value, limits),
      rpd,
      performance: performance(rpd, criterion),
      isNew: Boolean(p.isNew),
    };
  });
  return { element: elementLabel, stats, limits, acceptedValue, criterion, from, to, points };
}
