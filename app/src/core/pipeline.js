// Browser pipeline — the bridge between dropped files and the shared engine in
// ../../../scripts/lib (all pure, browser-portable). No server: files are read as
// ArrayBuffers. Workbooks are PARSED with exceljs but WRITTEN by surgical JSZip
// injection into the pristine template XML (exceljs cannot round-trip the dynamic
// arrays / metadata.xml without corrupting the file).

import JSZip from "jszip";
import { buildSpec, findHeaderFields, getClientSamples, loadWorkbook } from "../../../scripts/lib/results-workbook.mjs";
import { parseIcpoesConcWorkbook } from "../../../scripts/lib/raw-parsers/icpoes-conc.mjs";
import { buildContract, extractEsws, isEswsZip } from "../../../scripts/lib/raw-parsers/icpoes-esws.mjs";
import { ingestQcBatch, parseQcBatch } from "../../../scripts/lib/qc-batch.mjs";
import { ingestIcpoes } from "../../../scripts/lib/ingest.mjs";
import { runQcCheck } from "../../../scripts/lib/qc-engine.mjs";
import { applyEdits, groupCellsBySheet, loadXlsxZip } from "../../../scripts/lib/xlsx-zip.mjs";
import { computeReportMatrix, detectClientSamples, reportableAnalyteKeys } from "../../../scripts/lib/report-compute.mjs";

const BASE = import.meta.env.BASE_URL;
const RESULTS_TPL = `${BASE}templates/nals-results-template.xlsx`;
const QC_TPL = `${BASE}templates/nals-qc-template.xlsx`;

const fileBuffer = (file) => file.arrayBuffer();
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.arrayBuffer();
}

/** Classify a loaded workbook by its sheets. */
function classify(wb) {
  if (wb.getWorksheet("BATCH")) return "qc";
  if (wb.worksheets.some((s) => /^REPORT DATA/i.test(s.name))) return "results";
  if (wb.worksheets.some((s) => /^(conc|concentration)$/i.test(s.name))) return "raw";
  return "unknown";
}

/**
 * Analyze a set of dropped files. The raw ICPOES export is required; a RESULTS
 * workbook (friendly sample names) and/or a QC workbook (exact role mapping) are
 * optional. Returns everything the UI needs to render and to generate downloads.
 */
export async function analyze(files) {
  const loaded = [];
  let rawEsws = null;
  for (const f of files) {
    const buf = await fileBuffer(f);
    // ICP Expert .esws is a ZIP of .NET-serialized parts, not a workbook —
    // parse it directly (removes the manual "Export to Excel" step).
    if (/\.esws$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(buf);
      if (isEswsZip(zip)) { rawEsws = { file: f, extract: await extractEsws(zip) }; continue; }
    }
    const wb = await loadWorkbook(buf);
    loaded.push({ file: f, wb, kind: classify(wb) });
  }
  const rawWb = loaded.find((x) => x.kind === "raw");
  if (!rawEsws && !rawWb) {
    throw new Error("Drop the raw ICPOES export — an ICP Expert .esws worksheet or a Concentration .xlsx.");
  }
  const resultsDrop = loaded.find((x) => x.kind === "results");
  const qcDrop = loaded.find((x) => x.kind === "qc");

  // Spec from a dropped RESULTS workbook, else from the bundled blank template.
  const specWb = resultsDrop ? resultsDrop.wb : await loadWorkbook(await fetchBuffer(RESULTS_TPL));
  const spec = buildSpec(specWb);
  const oes = spec.instrumentSheets["ICPOES RESULTS"];

  // Parse the raw run (adjusted Concentration + Unadjusted for QC). The .esws is
  // extracted once; the .xlsx Conc workbook is parsed per kind.
  let conc;
  let unadj;
  if (rawEsws) {
    conc = buildContract(rawEsws.extract, "adjusted");
    unadj = buildContract(rawEsws.extract, "unadjusted");
  } else {
    conc = parseIcpoesConcWorkbook(rawWb.wb);
    unadj = conc;
    try {
      unadj = parseIcpoesConcWorkbook(rawWb.wb, { kind: "unadjusted" });
    } catch {
      /* some exports have only one sheet */
    }
  }
  const rawName = rawEsws ? rawEsws.file.name : rawWb.file.name;

  // Samples: friendly names from a dropped RESULTS, else detected from the raw.
  const samples = resultsDrop ? getClientSamples(resultsDrop.wb, spec) : detectClientSamples(conc);

  // QC model: dropped QC workbook (full, exact roles) else bundled blank template.
  const qcModel = qcDrop ? parseQcBatch(qcDrop.wb) : parseQcBatch(await loadWorkbook(await fetchBuffer(QC_TPL)));
  const qc = runQcCheck(qcModel, unadj);

  // RESULTS preview (computed in code).
  const reportMatrix = computeReportMatrix(spec, samples, conc);

  // ICPOES dataset (for the RESULTS download).
  const ingest = ingestIcpoes(conc, { samples, analytes: oes.analytes, inputBandStart: oes.inputRows.start });

  return {
    sources: {
      raw: rawName,
      results: resultsDrop?.file.name || null,
      qc: qcDrop?.file.name || null,
      qcRoleSource: qcDrop ? "dropped QC workbook" : "bundled template (deterministic roles)",
    },
    version: spec.version,
    samples,
    reportMatrix,
    qc,
    reportableAnalytes: [...reportableAnalyteKeys(spec)],
    resultsHeaderRefs: findHeaderFields(specWb, "ICPOES RESULTS"),
    // retained for downloads
    _conc: conc,
    _unadj: unadj,
    _ingestCells: ingest.cells,
    _qcModel: qcModel,
    _spec: spec,
  };
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
