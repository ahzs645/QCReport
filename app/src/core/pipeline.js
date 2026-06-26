// Browser pipeline — the bridge between dropped files and the shared engine in
// ../../../scripts/lib (all pure, browser-portable). No server: files are read as
// ArrayBuffers. Workbooks are PARSED with exceljs but WRITTEN by surgical JSZip
// injection into the pristine template XML (exceljs cannot round-trip the dynamic
// arrays / metadata.xml without corrupting the file).

import JSZip from "jszip";
import { findHeaderFields, loadWorkbook } from "../../../scripts/lib/results-workbook.mjs";
import { extractEsws, isEswsZip } from "../../../scripts/lib/raw-parsers/icpoes-esws.mjs";
import { ingestQcBatch, parseQcBatch } from "../../../scripts/lib/qc-batch.mjs";
import { ingestIcpoes } from "../../../scripts/lib/ingest.mjs";
import { applyEdits, groupCellsBySheet, loadXlsxZip } from "../../../scripts/lib/xlsx-zip.mjs";
import { analyzeBatch } from "../../../scripts/lib/analyze.mjs";

const BASE = import.meta.env.BASE_URL;
const RESULTS_TPL = `${BASE}templates/nals-results-template.xlsx`;
const QC_TPL = `${BASE}templates/nals-qc-template.xlsx`;

const fileBuffer = (file) => file.arrayBuffer();
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.arrayBuffer();
}

/**
 * Analyze a set of dropped files. The raw ICPOES export is required; a RESULTS
 * workbook (friendly sample names) and/or a QC workbook (exact role mapping) are
 * optional. Returns everything the UI needs to render and to generate downloads.
 *
 * This is the browser shell: it turns dropped File objects into loaded workbooks /
 * a parsed .esws extract, then delegates all computation to the shared, pure
 * `analyzeBatch` engine (scripts/lib/analyze.mjs), injecting fetch-based loaders for
 * the bundled blank templates.
 */
export async function analyze(files) {
  const drops = [];
  let rawEsws = null;
  for (const f of files) {
    const buf = await fileBuffer(f);
    // ICP Expert .esws is a ZIP of .NET-serialized parts, not a workbook —
    // parse it directly (removes the manual "Export to Excel" step).
    if (/\.esws$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(buf);
      if (isEswsZip(zip)) { rawEsws = { name: f.name, extract: await extractEsws(zip) }; continue; }
    }
    const wb = await loadWorkbook(buf);
    drops.push({ name: f.name, wb });
  }
  return analyzeBatch({
    drops,
    rawEsws,
    loadDefaultResultsWb: async () => loadWorkbook(await fetchBuffer(RESULTS_TPL)),
    loadDefaultQcWb: async () => loadWorkbook(await fetchBuffer(QC_TPL)),
  });
}

/** Inject cells into a pristine template (JSZip, no formula rewrite) and download. */
async function injectAndDownload(templateUrl, cells, filename) {
  const zip = await loadXlsxZip(await fetchBuffer(templateUrl));
  await applyEdits(zip, { setCells: groupCellsBySheet(cells), fullCalcOnLoad: true });
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Header field values -> cells for a target sheet, using located refs. */
function headerCells(sheet, refs, header = {}) {
  return Object.entries(header)
    .filter(([key, value]) => refs[key] && value != null && String(value).trim() !== "")
    .map(([key, value]) => ({ sheet, ref: refs[key], value: String(value) }));
}

/**
 * Generate the populated RESULTS workbook and download it.
 * @param {object} overrides - { sampleNames: {id: name}, header: {key: value} }
 */
export async function downloadResults(analysis, overrides = {}, filename = "RESULTS-from-raw.xlsx") {
  const { sampleNames = {}, header = {} } = overrides;
  const oes = analysis._spec.instrumentSheets["ICPOES RESULTS"];
  // Re-ingest with any edited friendly sample names (fills ICPOES column A).
  const samples = analysis.samples.map((s) => ({ ...s, name: sampleNames[s.id] ?? s.name }));
  const { cells } = ingestIcpoes(analysis._conc, { samples, analytes: oes.analytes, inputBandStart: oes.inputRows.start });
  const cellsOut = [...cells, ...headerCells("ICPOES RESULTS", analysis.resultsHeaderRefs || {}, header)];
  await injectAndDownload(RESULTS_TPL, cellsOut, filename);
}

/** Generate the populated QC (QA/QC) workbook and download it. */
export async function downloadQc(analysis, overrides = {}, filename = "QC-from-raw.xlsx") {
  const { header = {} } = overrides;
  const qcWb = await loadWorkbook(await fetchBuffer(QC_TPL));
  const qcModel = parseQcBatch(qcWb);
  const { cells } = ingestQcBatch(qcModel, analysis._unadj);
  const cellsOut = [...cells, ...headerCells("BATCH", findHeaderFields(qcWb, "BATCH"), header)];
  await injectAndDownload(QC_TPL, cellsOut, filename);
}
