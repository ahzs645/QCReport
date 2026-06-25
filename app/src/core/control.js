// Browser adapters for the control-chart utility. Load a ControlChart workbook
// (its RAW DATA history) and, optionally, raw ICPOES runs whose Digest LFB rows
// add new points. All computation is the shared engine in scripts/lib.

import { loadWorkbook } from "../../../scripts/lib/results-workbook.mjs";
import { parseIcpoesConcWorkbook } from "../../../scripts/lib/raw-parsers/icpoes-conc.mjs";
import { normalizeAnalyteLabel } from "../../../scripts/lib/raw-parsers/normalize.mjs";
import {
  buildSeries,
  getChartedElements,
  parseControlChartRawData,
  parsePastedControlData,
} from "../../../scripts/lib/control-chart.mjs";

const LFB_LABEL = /lab fortified blank|digest lfb|\blfb\b/i;

/** Load a dropped ControlChart workbook into { rawData, chartedElements }. */
export async function loadControlChartFile(file) {
  const wb = await loadWorkbook(await file.arrayBuffer());
  if (!wb.getWorksheet("RAW DATA")) {
    throw new Error(`${file.name} is not a control-chart workbook (no RAW DATA sheet).`);
  }
  return { rawData: parseControlChartRawData(wb), chartedElements: getChartedElements(wb) };
}

/**
 * Extract Digest LFB points from a dropped raw ICPOES run, keyed by analyte label,
 * so they can be appended to the control-chart series as new points.
 * @returns {{ file, date, byLabel: Map<normLabel, value> }}
 */
export async function extractLfbFromRun(file, date = null) {
  const wb = await loadWorkbook(await file.arrayBuffer());
  let conc;
  try {
    conc = parseIcpoesConcWorkbook(wb, { kind: "unadjusted" });
  } catch {
    conc = parseIcpoesConcWorkbook(wb);
  }
  // Find the LFB row by its solution label.
  const lfbRow = conc.rows.find((r) => LFB_LABEL.test(r.label));
  const byLabel = new Map(lfbRow ? Object.entries(lfbRow.values) : []);
  return { file: file.name, date, byLabel, found: Boolean(lfbRow) };
}

/** Parse pasted control-chart RAW DATA into { rawData, chartedElements }. */
export function parsePasted(text) {
  const rawData = parsePastedControlData(text);
  const chartedElements = rawData.elements.map((e) => ({ name: e.label, label: e.label }));
  return { rawData, chartedElements };
}

/** Build the series for one charted element, applying date window + run points. */
export function seriesFor(rawData, elementLabel, { from, to, runPoints = [] } = {}) {
  const extraPoints = runPoints
    .map((rp) => ({ file: rp.file, date: rp.date, value: rp.byLabel.get(normalizeAnalyteLabel(elementLabel)) }))
    .filter((p) => p.value !== undefined && p.value !== null);
  return buildSeries(rawData, elementLabel, { from, to, extraPoints });
}
