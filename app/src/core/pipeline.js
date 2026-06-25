// Browser pipeline — the bridge between dropped files and the shared engine in
// ../../../scripts/lib (all pure, browser-portable). No server: files are read as
// ArrayBuffers. Workbooks are PARSED with exceljs but WRITTEN by surgical JSZip
// injection into the pristine template XML (exceljs cannot round-trip the dynamic
// arrays / metadata.xml without corrupting the file).

import JSZip from "jszip";
import { buildSpec, findHeaderFields, getClientSamples, loadWorkbook } from "../../../scripts/lib/results-workbook.mjs";
import { isIcpoesConcWorkbook, parseIcpoesConcWorkbook } from "../../../scripts/lib/raw-parsers/icpoes-conc.mjs";
import { buildContract, extractEsws, isEswsZip } from "../../../scripts/lib/raw-parsers/icpoes-esws.mjs";
import { buildIdentityIndex, isHotBlockWorkbook, isLabelsWorkbook, parseHotBlock, parseLabels } from "../../../scripts/lib/raw-parsers/sample-prep.mjs";
import { normalizeSampleId } from "../../../scripts/lib/raw-parsers/normalize.mjs";
import { ingestQcBatch, parseQcBatch } from "../../../scripts/lib/qc-batch.mjs";
import { ingestIcpoes } from "../../../scripts/lib/ingest.mjs";
import { DEFAULT_QC_CRITERIA, parseQcCriteria, runQcCheck } from "../../../scripts/lib/qc-engine.mjs";
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
  if (isHotBlockWorkbook(wb)) return "hotblock";
  if (isLabelsWorkbook(wb)) return "labels";
  if (isIcpoesConcWorkbook(wb)) return "raw";
  return "unknown";
}

/**
 * Overlay the prep-sheet identity index onto a roster. Friendly names come from
 * HotBlock when the roster doesn't already have one; prep/QC rows (Method Blank,
 * DUP, SPIKED, ICV) are dropped from a *detected* roster since they aren't client
 * samples. Each surviving sample carries its identity (name/rack/role) for the UI.
 * @param {boolean} fromResults - roster came from a RESULTS workbook (authoritative names)
 */
function applyIdentity(samples, index, { fromResults }) {
  const warnings = [];
  const out = [];
  for (const s of samples) {
    const id = index.get(normalizeSampleId(s.id));
    if (id?.prepRole && !fromResults) {
      // A detected "client" row that prep records as QC/prep — exclude it.
      warnings.push({ kind: "prep_row_excluded", id: s.id, role: id.prepRole, name: id.sampleName });
      continue;
    }
    let name = s.name;
    if (id?.sampleName) {
      if (fromResults && s.name && normalizeSampleId(s.name) !== normalizeSampleId(id.sampleName)) {
        warnings.push({ kind: "name_mismatch", id: s.id, results: s.name, prep: id.sampleName });
      } else if (!fromResults || !s.name || /\d{4}\s*nals/i.test(s.name)) {
        name = id.sampleName; // fill from prep when detected/blank/still-an-id
      }
    }
    out.push({ ...s, name, identity: id || null });
  }
  // Re-number sequentially so excluded prep rows don't leave gaps in the output
  // band (samples from a RESULTS workbook carry an explicit row and ignore index).
  return { samples: out.map((s, index) => ({ ...s, index })), warnings };
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
  const hotblockDrop = loaded.find((x) => x.kind === "hotblock");
  const labelsDrop = loaded.find((x) => x.kind === "labels");

  // Cross-reference sheets (optional): HotBlock digestion supplies friendly sample
  // names + QC/prep roles; Labels supplies the rack layout. Both join the run on
  // the NALS id + position. Absent → the roster falls back to its prior source.
  const hotblock = hotblockDrop ? parseHotBlock(hotblockDrop.wb) : null;
  const labels = labelsDrop ? parseLabels(labelsDrop.wb) : null;
  const identity = buildIdentityIndex({ hotblock, labels });

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

  // Samples: friendly names from a dropped RESULTS, else detected from the raw —
  // then enriched/cross-checked against the prep-sheet identity index.
  const baseSamples = resultsDrop ? getClientSamples(resultsDrop.wb, spec) : detectClientSamples(conc);
  const enriched = applyIdentity(baseSamples, identity, { fromResults: Boolean(resultsDrop) });
  const samples = enriched.samples;

  // QC model + acceptance criteria: dropped QC workbook (full, exact roles + its
  // own CODES limits) else the bundled blank template. The CODES "PERCENT
  // RECOVERIES" table drives the ranges/tolerances/citations so they're never
  // hardcoded — defaults apply only if CODES can't be read.
  const qcWb = qcDrop ? qcDrop.wb : await loadWorkbook(await fetchBuffer(QC_TPL));
  const qcModel = parseQcBatch(qcWb);
  const qcCriteria = parseQcCriteria(qcWb) || DEFAULT_QC_CRITERIA;
  const qc = runQcCheck(qcModel, unadj, qcCriteria);

  // QC/prep roles the HotBlock sheet records independently of the QC workbook
  // (Method Blank / DUP / SPIKED / ICV) — a cross-reference for the SAMPLE,
  // DUPLICATE and LFM role assignments.
  const qcRoleHints = (hotblock?.samples || [])
    .filter((s) => s.prepRole)
    .map((s) => ({ id: s.id, role: s.prepRole, name: s.sampleName }));

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
      qcCriteriaSource: parseQcCriteria(qcWb) ? `CODES sheet (${qcDrop ? "dropped QC workbook" : "bundled template"})` : "encoded defaults",
      hotblock: hotblockDrop?.file.name || null,
      labels: labelsDrop?.file.name || null,
      nameSource: resultsDrop ? "RESULTS workbook" : hotblock ? "HotBlock digestion" : "raw NALS IDs",
    },
    version: spec.version,
    samples,
    reportMatrix,
    qc,
    qcCriteria,
    qcRoleHints,
    prep: {
      hasHotBlock: Boolean(hotblock),
      hasLabels: Boolean(labels),
      entries: [...identity.values()],
      warnings: enriched.warnings,
    },
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
