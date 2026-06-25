// Browser core for the .esws explorer. Loads the file once into a JSZip and
// extracts the light run table up front; the heavier views (calibration, QC,
// per-solution replicates, spectra) are pulled lazily from the same zip. No
// server — everything is unzipped and decoded from .NET-NRBF in the browser.

import JSZip from "jszip";
import { buildContract, extractEsws } from "../../../scripts/lib/raw-parsers/icpoes-esws.mjs";
import {
  extractCalibration,
  extractQc,
  extractRunInfo,
  extractSolutionDetail,
  extractSpectra,
} from "../../../scripts/lib/raw-parsers/esws-explore.mjs";

/** Load a dropped .esws File into a session (zip + base extract + run info). */
export async function loadEsws(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const extract = await extractEsws(zip);
  const runInfo = await extractRunInfo(zip);
  return { fileName: file.name, zip, extract, runInfo };
}

/** Flat results table for the given kind (adjusted / unadjusted). */
export function resultsTable(session, kind = "adjusted") {
  const { analytes } = session.extract;
  const { rows } = buildContract(session.extract, kind);
  return { columns: analytes.map((a) => ({ key: a.key, label: a.rawLabel })), rows, runs: session.extract.runs };
}

export const calibration = (session) => extractCalibration(session.zip);
export const qc = (session, reportableKeys) => extractQc(session.zip, { reportableKeys });
export const solutionDetail = (session, partName) => extractSolutionDetail(session.zip, partName);
export const spectra = (session, solutionKey) => extractSpectra(session.zip, solutionKey);

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Render a results table to CSV (Solution Label + analyte columns). */
export function toCsv(table) {
  const header = ["Solution Label", ...table.columns.map((c) => c.label)];
  const lines = [header.map(csvCell).join(",")];
  for (const row of table.rows) {
    lines.push([row.label, ...table.columns.map((c) => row.values[c.key])].map(csvCell).join(","));
  }
  return lines.join("\n");
}

export function downloadText(text, filename, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
