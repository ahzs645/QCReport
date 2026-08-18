// Pure batch-analysis orchestration — the engine core lifted out of the browser
// app (app/src/core/pipeline.js) so it can be called from any host: the Pages app,
// Node tests/scripts, or another app (e.g. the NALS Word-report generator) that
// imports the published engine barrel.
//
// This module does NO I/O. Callers pass already-loaded workbooks (exceljs and
// JSZip are themselves browser+Node portable) and inject loaders for the default
// templates, so the same logic runs unchanged regardless of where the bytes came
// from (fetch in the browser, fs in Node).

import JSZip from "jszip";
import { buildSpec, findHeaderFields, getClientSamples, loadWorkbook } from "./results-workbook.mjs";
import { isIcpoesConcWorkbook, parseIcpoesConcWorkbook } from "./raw-parsers/icpoes-conc.mjs";
import { buildContract, extractEsws, isEswsZip } from "./raw-parsers/icpoes-esws.mjs";
import { extractDefinedConcentrations, extractQcDefinitions } from "./raw-parsers/esws-explore.mjs";
import { isHotBlockWorkbook, isLabelsWorkbook, parseHotBlock, parseLabels, buildIdentityIndex } from "./raw-parsers/sample-prep.mjs";
import { normalizeSampleId } from "./raw-parsers/normalize.mjs";
import { ingestQcBatch, parseQcBatch } from "./qc-batch.mjs";
import { ingestIcpoes } from "./ingest.mjs";
import { DEFAULT_QC_CRITERIA, parseQcCriteria, runQcCheck } from "./qc-engine.mjs";
import { computeReportMatrix, detectClientSamples, reportableAnalyteKeys } from "./report-compute.mjs";

/** Classify a loaded workbook by its sheets. */
export function classifyWorkbook(wb) {
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
export function applyIdentity(samples, index, { fromResults }) {
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
 * Turn raw file bytes into the `drops` / `rawEsws` inputs `analyzeBatch` expects.
 * An ICP Expert `.esws` is a ZIP of .NET-serialized parts (extracted directly); every
 * other file is loaded as a workbook. JSZip + exceljs are bundled deps of this package,
 * so consumers don't need them as direct dependencies.
 * @param {Array<{name:string, buffer:ArrayBuffer|Uint8Array}>} files
 */
export async function loadDrops(files) {
  const drops = [];
  let rawEsws = null;
  for (const f of files) {
    if (/\.esws$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(f.buffer);
      if (isEswsZip(zip)) {
        // The two method tables are read here, while the zip is open, because the
        // run diagnostics need them and nothing else keeps the zip alive. Both are
        // small parts, and only a .esws carries them — a Concentration .xlsx export
        // has no calibration standards or QC acceptance limits in it, which is why
        // the diagnostics are .esws-only.
        rawEsws = {
          name: f.name,
          extract: await extractEsws(zip),
          defined: await extractDefinedConcentrations(zip),
          qcDefs: await extractQcDefinitions(zip),
        };
        continue;
      }
    }
    drops.push({ name: f.name, wb: await loadWorkbook(f.buffer) });
  }
  return { drops, rawEsws };
}

/**
 * Convenience wrapper: load raw file bytes (loadDrops) and analyze them in one call.
 * The host supplies the raw file buffers plus loaders for the default blank templates.
 * @param {object} args
 * @param {Array<{name:string, buffer:ArrayBuffer|Uint8Array}>} args.files
 * @param {() => Promise<object>|object} args.loadDefaultResultsWb
 * @param {() => Promise<object>|object} args.loadDefaultQcWb
 */
export async function analyzeFiles({ files, loadDefaultResultsWb, loadDefaultQcWb }) {
  const { drops, rawEsws } = await loadDrops(files);
  return analyzeBatch({ drops, rawEsws, loadDefaultResultsWb, loadDefaultQcWb });
}

/**
 * Analyze a batch of already-loaded inputs. The raw ICPOES run is required (either
 * a parsed .esws extract or a Concentration workbook); a RESULTS workbook (friendly
 * sample names) and/or a QC workbook (exact role mapping) are optional. When a
 * RESULTS/QC workbook isn't supplied, the injected default-template loaders provide
 * the bundled blank template.
 *
 * @param {object}   args
 * @param {Array<{name:string, wb:object}>} [args.drops]   loaded non-esws workbooks
 * @param {{name:string, extract:object}|null} [args.rawEsws]  parsed ICP Expert .esws
 * @param {() => Promise<object>|object} args.loadDefaultResultsWb  loader for the blank RESULTS template
 * @param {() => Promise<object>|object} args.loadDefaultQcWb       loader for the blank QC template
 * @returns {Promise<object>} the analysis the UI/consumer needs (plus `_`-prefixed
 *          internals retained for the Excel-regen download helpers).
 */
export async function analyzeBatch({ drops = [], rawEsws = null, loadDefaultResultsWb, loadDefaultQcWb }) {
  const loaded = drops.map((d) => ({ name: d.name, wb: d.wb, kind: classifyWorkbook(d.wb) }));
  const rawWb = loaded.find((x) => x.kind === "raw");
  if (!rawEsws && !rawWb) {
    throw new Error("Provide the raw ICPOES export — an ICP Expert .esws worksheet or a Concentration .xlsx.");
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
  const specWb = resultsDrop ? resultsDrop.wb : await loadDefaultResultsWb();
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
  const rawName = rawEsws ? rawEsws.name : rawWb.name;

  // Samples: friendly names from a dropped RESULTS, else detected from the raw —
  // then enriched/cross-checked against the prep-sheet identity index.
  const baseSamples = resultsDrop ? getClientSamples(resultsDrop.wb, spec) : detectClientSamples(conc);
  const enriched = applyIdentity(baseSamples, identity, { fromResults: Boolean(resultsDrop) });
  const samples = enriched.samples;

  // QC model + acceptance criteria: dropped QC workbook (full, exact roles + its
  // own CODES limits) else the bundled blank template. The CODES "PERCENT
  // RECOVERIES" table drives the ranges/tolerances/citations so they're never
  // hardcoded — defaults apply only if CODES can't be read.
  const qcWb = qcDrop ? qcDrop.wb : await loadDefaultQcWb();
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
      results: resultsDrop?.name || null,
      qc: qcDrop?.name || null,
      qcRoleSource: qcDrop ? "dropped QC workbook" : "bundled template (deterministic roles)",
      qcCriteriaSource: parseQcCriteria(qcWb) ? `CODES sheet (${qcDrop ? "dropped QC workbook" : "bundled template"})` : "encoded defaults",
      hotblock: hotblockDrop?.name || null,
      labels: labelsDrop?.name || null,
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
    // What the ingest made of the raw run. Previously only its cells were kept, so an
    // over-range value that needed a human — or one a dilution had already answered —
    // had no way to reach the interface or the export warnings.
    ingest: {
      matchedSamples: ingest.matchedSamples,
      unmatchedSamples: ingest.unmatchedSamples,
      overRangeResolved: ingest.overRangeResolved,
      overRangeFlagged: ingest.overRangeFlagged,
      overRangeResolutions: ingest.overRangeResolutions,
      warnings: ingest.warnings,
    },
    reportableAnalytes: [...reportableAnalyteKeys(spec)],
    resultsHeaderRefs: findHeaderFields(specWb, "ICPOES RESULTS"),
    // Everything screenRun()/diagnoseAnalyte() need, or null when the raw run came
    // from a Concentration .xlsx (which carries no standards or acceptance limits).
    diagnostics: rawEsws
      ? { extract: rawEsws.extract, defined: rawEsws.defined ?? null, qcDefs: rawEsws.qcDefs ?? null }
      : null,
    // retained for downloads
    _conc: conc,
    _unadj: unadj,
    _ingestCells: ingest.cells,
    _qcModel: qcModel,
    _spec: spec,
  };
}
