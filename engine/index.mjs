// Public engine barrel — the stable, browser-safe surface of the QCReport
// water-analysis engine, for consumers that import this package (the NALS Word
// report generator, scripts, tests). Everything re-exported here is PURE: it
// operates on already-loaded workbooks / parsed objects and performs no fs, no
// fetch, and no DOM access. (The Node-only file helpers — openWorkbook,
// dataset.mjs, store.mjs, cli.mjs — are deliberately NOT exported.)
//
// Typical flow for a host app:
//   import { loadWorkbook, buildSpec, analyzeBatch } from "qcreport";
//   const spec = buildSpec(await loadWorkbook(resultsTemplateBytes));   // or reuse a cached spec
//   const analysis = await analyzeBatch({ drops, rawEsws, loadDefaultResultsWb, loadDefaultQcWb });
//   analysis.reportMatrix -> [{ parameter, units, guideline, section, values: [...] }]

// High-level orchestration.
export { analyzeBatch, analyzeFiles, loadDrops, classifyWorkbook, applyIdentity } from "../scripts/lib/analyze.mjs";

// Workbook loading + spec (browser-safe parts only — openWorkbook is excluded).
export { loadWorkbook, buildSpec, getClientSamples, getSamples, findHeaderFields, clearSampleData } from "../scripts/lib/results-workbook.mjs";

// Raw instrument parsers.
export { parseIcpoesConcWorkbook, isIcpoesConcWorkbook } from "../scripts/lib/raw-parsers/icpoes-conc.mjs";
export { extractEsws, buildContract, isEswsZip } from "../scripts/lib/raw-parsers/icpoes-esws.mjs";
export { parseIcWorkbook, isIcWorkbook } from "../scripts/lib/raw-parsers/ic-cdet.mjs";
export { parseHotBlock, parseLabels, buildIdentityIndex, isHotBlockWorkbook, isLabelsWorkbook } from "../scripts/lib/raw-parsers/sample-prep.mjs";

// Forward computation of reportable values.
export { computeReportMatrix, detectClientSamples, reportableAnalyteKeys, adjustedVsUnadjusted } from "../scripts/lib/report-compute.mjs";
export { reportableValue, hardnessAsCaCO3, roundSignificant, roundDecimals, valuesMatch } from "../scripts/lib/formula-engine.mjs";

// Quality-check engine.
export { runQcCheck, parseQcCriteria, DEFAULT_QC_CRITERIA } from "../scripts/lib/qc-engine.mjs";

// Ingest (parsed raw -> workbook cells) for the Excel-regen path.
export { ingestInstrument, ingestIcpoes, ingestIc } from "../scripts/lib/ingest.mjs";
export { parseQcBatch, ingestQcBatch } from "../scripts/lib/qc-batch.mjs";

// Surgical Excel injection (round-trips dynamic arrays / metadata).
export { loadXlsxZip, sheetPathMap, applyEdits, groupCellsBySheet } from "../scripts/lib/xlsx-zip.mjs";

// Sample matching + normalization helpers (the analyte/sample id crosswalk).
export { matchSample, nalsNumber } from "../scripts/lib/sample-match.mjs";
export { normalizeAnalyteLabel, normalizeSampleId, isDilution, dilutionFactor, baseSampleId, isOverRangeValue } from "../scripts/lib/raw-parsers/normalize.mjs";

// Control charts.
export { controlStats, controlLimits, pointStatus, rpdFromAccepted, performance, parseControlChartRawData } from "../scripts/lib/control-chart.mjs";
