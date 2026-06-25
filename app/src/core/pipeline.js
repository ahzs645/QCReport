// Browser pipeline — the bridge between dropped files and the shared engine in
// ../../../scripts/lib (all pure, browser-portable). No server: files are read as
// ArrayBuffers. Workbooks are PARSED with exceljs but WRITTEN by surgical JSZip
// injection into the pristine template XML (exceljs cannot round-trip the dynamic
// arrays / metadata.xml without corrupting the file).

import { buildSpec, getClientSamples, loadWorkbook } from "../../../scripts/lib/results-workbook.mjs";
import { parseIcpoesConcWorkbook } from "../../../scripts/lib/raw-parsers/icpoes-conc.mjs";
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
  for (const f of files) {
    const wb = await loadWorkbook(await fileBuffer(f));
    loaded.push({ file: f, wb, kind: classify(wb) });
  }
  const raw = loaded.find((x) => x.kind === "raw");
  if (!raw) throw new Error("Drop the raw ICPOES export (a workbook with a Concentration sheet).");
  const resultsDrop = loaded.find((x) => x.kind === "results");
  const qcDrop = loaded.find((x) => x.kind === "qc");

  // Spec from a dropped RESULTS workbook, else from the bundled blank template.
  const specWb = resultsDrop ? resultsDrop.wb : await loadWorkbook(await fetchBuffer(RESULTS_TPL));
  const spec = buildSpec(specWb);
  const oes = spec.instrumentSheets["ICPOES RESULTS"];

  // Parse the raw run (adjusted Concentration + Unadjusted for QC).
  const conc = parseIcpoesConcWorkbook(raw.wb);
  let unadj = conc;
  try {
    unadj = parseIcpoesConcWorkbook(raw.wb, { kind: "unadjusted" });
  } catch {
    /* some exports have only one sheet */
  }

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
      raw: raw.file.name,
      results: resultsDrop?.file.name || null,
      qc: qcDrop?.file.name || null,
      qcRoleSource: qcDrop ? "dropped QC workbook" : "bundled template (deterministic roles)",
    },
    version: spec.version,
    samples,
    reportMatrix,
    qc,
    reportableAnalytes: [...reportableAnalyteKeys(spec)],
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

/** Generate the populated RESULTS workbook (live formulas) and download it. */
export async function downloadResults(analysis, filename = "RESULTS-from-raw.xlsx") {
  await injectAndDownload(RESULTS_TPL, analysis._ingestCells, filename);
}

/** Generate the populated QC (QA/QC) workbook (live formulas) and download it. */
export async function downloadQc(analysis, filename = "QC-from-raw.xlsx") {
  // Parse the (pristine) QC template to map QC roles, ingest from the raw Unadjusted
  // data, then surgically inject the green cells.
  const qcWb = await loadWorkbook(await fetchBuffer(QC_TPL));
  const qcModel = parseQcBatch(qcWb);
  const { cells } = ingestQcBatch(qcModel, analysis._unadj);
  await injectAndDownload(QC_TPL, cells, filename);
}
