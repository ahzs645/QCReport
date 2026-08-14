// Hand-written type surface for the QCReport engine barrel (engine/index.mjs).
// The engine is plain ESM JS; these declarations let TypeScript consumers (the
// NALS Word report generator) import it with types. Shapes that consumers rely on
// are typed precisely; lower-level helpers are typed loosely on purpose.

/** A loaded exceljs Workbook (opaque to consumers — pass it back into the engine). */
export type Workbook = unknown;

/** A reportable cell value: a number, or a textual flag/label. */
export type ReportableValue = number | string;

/** One parameter row of the computed report matrix, aligned to the samples array. */
export interface ReportMatrixRow {
  /** Parameter / analyte name as it appears on the report (e.g. "Aluminum"). */
  parameter: string;
  /** Units string from the workbook spec (e.g. "mg/L"). */
  units: string;
  /** Guideline string from the workbook spec. */
  guideline: string;
  /** Report section (e.g. "Metals"). */
  section: string;
  /** One value per sample, in the same order as the samples passed to compute. */
  values: ReportableValue[];
}

/** A sample in the engine roster. */
export interface EngineSample {
  id: string;
  name: string;
  index?: number;
  identity?: unknown;
  [key: string]: unknown;
}

/** Result of runQcCheck — pass/fail checks plus a summary. */
export interface QcResult {
  checks: unknown[];
  summary: unknown;
  [key: string]: unknown;
}

/** The object returned by analyzeBatch. */
export interface BatchAnalysis {
  sources: Record<string, string | null>;
  version: string;
  samples: EngineSample[];
  reportMatrix: ReportMatrixRow[];
  qc: QcResult;
  qcCriteria: unknown;
  qcRoleHints: Array<{ id: string; role: string; name: string }>;
  prep: { hasHotBlock: boolean; hasLabels: boolean; entries: unknown[]; warnings: unknown[] };
  reportableAnalytes: string[];
  resultsHeaderRefs: Record<string, string>;
  // Internals retained for the Excel-regen download helpers.
  _conc: unknown;
  _unadj: unknown;
  _ingestCells: unknown[];
  _qcModel: unknown;
  _spec: WorkbookSpec;
}

/** Serializable workbook spec produced by buildSpec(). */
export interface WorkbookSpec {
  version: string;
  instrumentSheets: Record<string, any>;
  reportSheets: Record<string, any>;
  [key: string]: unknown;
}

export interface AnalyzeBatchArgs {
  drops?: Array<{ name: string; wb: Workbook }>;
  rawEsws?: { name: string; extract: unknown } | null;
  loadDefaultResultsWb: () => Promise<Workbook> | Workbook;
  loadDefaultQcWb: () => Promise<Workbook> | Workbook;
}

export interface RawFile {
  name: string;
  buffer: ArrayBuffer | Uint8Array;
}

export interface AnalyzeFilesArgs {
  files: RawFile[];
  loadDefaultResultsWb: () => Promise<Workbook> | Workbook;
  loadDefaultQcWb: () => Promise<Workbook> | Workbook;
}

export function analyzeBatch(args: AnalyzeBatchArgs): Promise<BatchAnalysis>;
export function analyzeFiles(args: AnalyzeFilesArgs): Promise<BatchAnalysis>;
export function loadDrops(files: RawFile[]): Promise<{ drops: Array<{ name: string; wb: Workbook }>; rawEsws: { name: string; extract: unknown } | null }>;
export function classifyWorkbook(wb: Workbook): string;
export function applyIdentity(
  samples: EngineSample[],
  index: Map<string, unknown>,
  opts: { fromResults: boolean },
): { samples: EngineSample[]; warnings: unknown[] };

// Workbook loading + spec.
export function loadWorkbook(data: ArrayBuffer | Uint8Array): Promise<Workbook>;
export function buildSpec(wb: Workbook): WorkbookSpec;
export function getClientSamples(wb: Workbook, spec: WorkbookSpec): EngineSample[];
export function getSamples(wb: Workbook, spec: WorkbookSpec): EngineSample[];
export function findHeaderFields(wb: Workbook, sheetName: string): Record<string, string>;
export function clearSampleData(wb: Workbook, spec: WorkbookSpec): void;

// Raw instrument parsers.
export interface ParsedContract {
  analytes: Array<{ rawLabel: string; key: string; [k: string]: unknown }>;
  rows: Array<{ label: string; values: Record<string, unknown>; [k: string]: unknown }>;
  [key: string]: unknown;
}
export function parseIcpoesConcWorkbook(wb: Workbook, opts?: { kind?: "adjusted" | "unadjusted" }): ParsedContract;
export function isIcpoesConcWorkbook(wb: Workbook): boolean;
export function extractEsws(zip: unknown): Promise<unknown>;
export function buildContract(extract: unknown, kind: "adjusted" | "unadjusted"): ParsedContract;
export function isEswsZip(zip: unknown): boolean;
export function parseIcWorkbook(wb: Workbook): ParsedContract;
export function isIcWorkbook(wb: Workbook): boolean;
export function parseHotBlock(wb: Workbook): unknown;
export function parseLabels(wb: Workbook): unknown;
export function buildIdentityIndex(args: { hotblock?: unknown; labels?: unknown }): Map<string, unknown>;
export function isHotBlockWorkbook(wb: Workbook): boolean;
export function isLabelsWorkbook(wb: Workbook): boolean;

// Forward computation.
export function computeReportMatrix(
  spec: WorkbookSpec,
  samples: Array<{ name: string; id: string }>,
  conc: ParsedContract,
  reportSheetName?: string,
): ReportMatrixRow[];
export function detectClientSamples(conc: ParsedContract): EngineSample[];
export function reportableAnalyteKeys(spec: WorkbookSpec): Set<string>;
export function adjustedVsUnadjusted(adjusted: ParsedContract, unadjusted: ParsedContract, samples: EngineSample[]): unknown[];
export function reportableValue(input: unknown, opts: { detectionLimit?: unknown; belowLabel?: string; flags?: unknown }): ReportableValue;
export function hardnessAsCaCO3(ca: number, mg: number): number | null;
export function roundSignificant(value: number, sig?: number): number;
export function roundDecimals(value: number, decimals?: number): number;
export function valuesMatch(computed: unknown, cached: unknown, tolerance?: number): boolean;

// Quality-check engine. The criteria shape is defined once in ./presets.d.ts
// (the light "qcreport/presets" subpath) and re-exported here.
export type {
  AcceptanceRange,
  ElementOverride,
  QcCriteria,
  RangeInfo,
  RangeKey,
  TrueValueKey,
} from "./presets.js";
export { DEFAULT_QC_CRITERIA } from "./presets.js";
export function parseQcCriteria(wb: Workbook): import("./presets.js").QcCriteria | null;
export function runQcCheck(qcModel: unknown, rawUnadjusted: ParsedContract, criteria: unknown): QcResult;

// ---- QC view model (the data contract for the qcreport/ui components) --------
/** PASS / FAIL / NA (the engine may emit other free-text statuses). */
export type QcStatus = "PASS" | "FAIL" | "NA" | string;
/** One analyte's result under a single QC check. */
export interface QcCheckResultView {
  analyte: string;
  /** Normalized analyte label — used by the "reportable only" filter. */
  norm: string;
  reportable: number | string | boolean;
  metric: number | null;
  unit?: string;
  status: QcStatus;
  note?: string;
}
/** A QC check (a role × kind), e.g. Digest LFB recovery, or Duplicate RPD. */
export interface QcCheckView {
  key: string;
  role: string;
  /** "blank" | "rpd" | "recovery" (the engine may add others). */
  kind: string;
  results: QcCheckResultView[];
}
export interface QcChecks {
  checks: QcCheckView[];
}
/** One row of the adjusted-vs-unadjusted dilution comparison. */
export interface AdjUnadjRow {
  id: string;
  sample: string;
  analyte: string;
  adjusted: number | string | null;
  unadjusted: number | string | null;
  diff: number | null;
  ratio: number | null;
}
/** A prep/rack cross-reference entry (HotBlock digestion / Labels workbook). */
export interface PrepEntryView {
  key: string;
  id: string;
  sampleName?: string;
  prepRole?: string;
  position?: string | number;
  rack?: { column: number; row: number } | null;
  amount?: string | number | null;
  acid?: string;
  comments?: string;
}
export interface SampleLite {
  id: string;
  name: string;
}
/** Everything the QC views render, flattened to plain data. buildQcViewModel output. */
export interface QcViewModel {
  sources: Record<string, string | null>;
  version: string;
  samples: SampleLite[];
  checks: QcCheckView[];
  reportableAnalytes: string[];
  matrix: ReportMatrixRow[];
  adjUnadj: AdjUnadjRow[];
  prepEntries: PrepEntryView[];
  qcRoleHints: Array<{ id: string; role: string; name: string }>;
  /** Human-readable prep warnings (already formatted). */
  prepWarnings: string[];
  /** Pass/fail totals across all checks. */
  summary: { pass: number; fail: number };
}
export function buildQcViewModel(analysis: BatchAnalysis): QcViewModel;

// Ingest + Excel injection.
export interface IngestResult {
  cells: Array<{ sheet: string; ref: string; value: unknown }>;
  warnings: unknown[];
  [key: string]: unknown;
}
export function ingestInstrument(parsed: ParsedContract, opts: Record<string, unknown>): IngestResult;
export function ingestIcpoes(parsed: ParsedContract, opts: Record<string, unknown>): IngestResult;
export function ingestIc(parsed: ParsedContract, opts: Record<string, unknown>): IngestResult;
export function parseQcBatch(wb: Workbook): unknown;
export function ingestQcBatch(qcModel: unknown, rawUnadjusted: ParsedContract): IngestResult;
export function loadXlsxZip(data: ArrayBuffer | Uint8Array): Promise<unknown>;
export function sheetPathMap(zip: unknown): Promise<Record<string, string>>;
export function applyEdits(zip: unknown, edits: { setCells?: unknown; clearBands?: unknown; fullCalcOnLoad?: boolean }): Promise<unknown>;
export function groupCellsBySheet(cells: Array<{ sheet: string; ref: string; value: unknown }>): Record<string, unknown>;

// Sample matching + normalization.
export function matchSample(rawLabel: string, roster: EngineSample[]): { sample: EngineSample; confidence: number; reason: string } | null;
export function nalsNumber(label: string): string | null;
export function normalizeAnalyteLabel(label: string): string;
export function normalizeSampleId(id: string): string;
export function isDilution(label: string): boolean;
export function dilutionFactor(label: string): number;
export function baseSampleId(label: string): string;
export function isOverRangeValue(value: unknown): boolean;

// Control charts.
export function controlStats(values: number[]): { mean: number; std: number; n: number };
export interface ControlLimits {
  center: number;
  sigma1: { upper: number; lower: number };
  sigma2: { upper: number; lower: number };
  sigma3: { upper: number; lower: number };
  [key: string]: unknown;
}
export function controlLimits(mean: number, std: number): ControlLimits;
export function pointStatus(value: number, limits: ControlLimits | null): string;
export function rpdFromAccepted(value: number, acceptedValue: number): number;
export function performance(rpd: number, criterion: number): string;

/** Parsed RAW DATA history from a ControlChart workbook. */
export interface ControlRawData {
  acceptedValue: number;
  criterion: number;
  variable: string;
  year: number | null;
  elements: Array<{ label: string }>;
  batches: Array<{ file: string; date: Date | string | null; comment: string | null; values: Record<string, number | null> }>;
}
export function parseControlChartRawData(wb: Workbook): ControlRawData;
export function parsePastedControlData(text: string, opts?: { acceptedValue?: number; criterion?: number; variable?: string }): ControlRawData;

/** Charted elements: a per-element Control Chart/Line sheet's element + chosen wavelength. */
export function getChartedElements(wb: Workbook): Array<{ name: string; label: string | null }>;

/** One point of a built control-chart series. */
export interface ControlPoint {
  file: string;
  date: Date | string | null;
  value: number;
  status: string;
  rpd: number;
  performance: string;
  isNew: boolean;
}
export interface ControlSeries {
  element: string;
  stats: { mean: number; std: number; n: number };
  limits: ControlLimits | null;
  acceptedValue: number;
  criterion: number;
  from: Date | string | null;
  to: Date | string | null;
  points: ControlPoint[];
}
export function buildSeries(
  rawData: ControlRawData,
  elementLabel: string,
  opts?: { from?: Date | string | null; to?: Date | string | null; extraPoints?: Array<{ file: string; date: Date | string | null; value: number }> },
): ControlSeries;
export { CONTROL_CHART_INFO } from "./presets.js";

// ---- Run diagnostics (CCV bracketing + calibration working range) ----------

/** A solution's role, as ICP Expert stores it. SAMPLE is the catch-all. */
export const SOLUTION_TYPE: Readonly<{ SAMPLE: 1; BLANK: 2; STANDARD: 3; QC: 6 }>;

/** Curve weightings offered for the what-if refit. */
export const WEIGHTINGS: Readonly<Record<"1/x" | "1/x^2" | "none", (p: { conc: number; intensity: number }) => number>>;
export type WeightingKey = keyof typeof WEIGHTINGS;
export const DEFAULT_WEIGHTING: WeightingKey;

/** Toggleable interpretation rules. */
export interface DiagnosticRules {
  /** A sample must sit between two passing checks of a tier to be covered by it. */
  bracketCcv: boolean;
  /** A sample with no check after it is left un-bracketed. */
  requireClosingCcv: boolean;
  /** A result below the reporting floor stays reportable despite a failed bracket. */
  belowFloorExempt: boolean;
  /** Prefer the least-diluted reading that is in range. */
  preferLeastDiluted: boolean;
  /** An over-range reading may be answered by a dilution of the same sample. */
  dilutionRescue: boolean;
  /** A reading below the lowest check level that passed is flagged as un-certified. */
  tierFloorFromChecks: boolean;
}
export const DEFAULT_DIAGNOSTIC_RULES: Readonly<DiagnosticRules>;
/** One-line explanation per rule, for the UI that toggles them. */
export const RULE_INFO: Readonly<Record<keyof DiagnosticRules, string>>;

/** A block of the run governed by one calibration. */
export interface CalibrationBlock {
  index: number;
  /** Indices into the runs array; `end` is exclusive. */
  start: number;
  end: number;
  standardRows: number[];
}

/** One calibration standard as measured in a block. */
export interface StandardPoint {
  row: number;
  label: string;
  conc: number;
  intensity: number;
  /** False when the analyst has dropped this point from the curve. */
  included: boolean;
  /** The concentration this point's intensity implies under the current fit. */
  backCalc: number | null;
  /** backCalc vs the defined concentration, as a percentage. */
  residualPct: number | null;
}

export interface CurveFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

/** A periodic drift check (a CCV or low-level check) evaluated for one analyte. */
export interface QcCheckPoint {
  row: number;
  label: string;
  /** The level this check runs at — checks at the same level bracket each other. */
  tier: number;
  expected: number;
  measured: number;
  intensity: number | null;
  recovery: number | null;
  lower: number;
  upper: number;
  status: "pass" | "fail" | "na";
  /** Whether the acceptance window came from the method or from the label. */
  source: "method" | "label";
}

export interface DiagnosedBlock extends CalibrationBlock {
  standards: StandardPoint[];
  fit: CurveFit | null;
  /** Lowest / highest retained standard — the curve's working range. */
  floor: number | null;
  ceiling: number | null;
  qc: QcCheckPoint[];
}

/** How one reading of one sample fared. */
export type ReadingStatus = "ok" | "below-floor" | "below-certified" | "over-range" | "qc-fail";

export interface SampleReading {
  row: number;
  label: string;
  dilutionFactor: number;
  unadjusted: number;
  adjusted: number;
  intensity: number | null;
  rsd: number | null;
  blockIndex: number | null;
  brackets: Array<{
    tier: number | string;
    covered: boolean;
    reason: string | null;
    before: { row: number; label: string; status: string; recovery: number | null } | null;
    after: { row: number; label: string; status: string; recovery: number | null } | null;
  }>;
  /** True when a bracketing tier covers this reading in time. */
  timeCovered: boolean;
  /** The concentration span the block's checks certify. */
  certified: { low: number | null; high: number } | null;
  overRange: boolean;
  belowFloor: boolean;
  floor: number | null;
  ceiling: number | null;
  status: ReadingStatus;
  reasons: string[];
}

/** What to do with a sample: report one of its readings, or re-run it. */
export type SampleVerdict =
  | "report"
  | "report-below-limit"
  | "report-uncertified"
  | "rerun-dilute"
  | "rerun-qc"
  | "rerun";

export interface DiagnosedSample {
  /** The sample id with any dilution suffix removed — groups a sample with its dilutions. */
  base: string;
  runs: SampleReading[];
  chosen: SampleReading | null;
  verdict: SampleVerdict;
  reasons: string[];
}

export interface DiagnosisSummary {
  qcPass: number;
  qcFail: number;
  report: number;
  reportBelowLimit: number;
  reportUncertified: number;
  rerun: number;
  samples: number;
}

export interface AnalyteDiagnosis {
  analyte: { key: string; rawLabel: string; element: string; wavelength: number; calMax: number | null };
  weighting: WeightingKey;
  rules: DiagnosticRules;
  blocks: DiagnosedBlock[];
  samples: DiagnosedSample[];
  summary: DiagnosisSummary;
}

export interface DiagnoseOptions {
  /** extractQcDefinitions() output — the method's own acceptance limits. */
  qcDefs?: Map<string, unknown>;
  /** extractDefinedConcentrations() output. */
  defined?: { concFor(standardName: string, element: string): number | null };
  /** Fallback % recovery window when the method defines none. */
  defaultWindow?: { lower: number; upper: number };
  rules?: Partial<DiagnosticRules>;
  weighting?: WeightingKey;
  /** Standards the analyst has dropped from the curve, by run index. */
  excludedStandardRows?: Set<number> | number[];
  /** Reporting limit in solution units; defaults to the curve's floor. */
  reportingLimit?: number | null;
}

/** The extractEsws() output these functions read. */
export interface EswsExtract {
  analytes: Array<{ key: string; rawLabel: string; element: string; wavelength: number; calMax?: number | null }>;
  runs: Array<Record<string, unknown>>;
}

export function isQcCheckRow(run: Record<string, unknown>): boolean;
export function isSampleRow(run: Record<string, unknown>): boolean;
export function calibrationBlocks(runs: EswsExtract["runs"]): CalibrationBlock[];
export function blockStandards(
  runs: EswsExtract["runs"],
  block: CalibrationBlock,
  analyte: { key: string; element: string },
  defined?: DiagnoseOptions["defined"],
): Array<{ row: number; label: string; conc: number; intensity: number }>;
export function blockQcChecks(
  runs: EswsExtract["runs"],
  block: CalibrationBlock,
  analyte: { key: string },
  opts: { qcDefs?: Map<string, unknown>; defaultWindow: { lower: number; upper: number } },
): QcCheckPoint[];
/** Expected concentration encoded in a QC label, in mg/L ("CCV 500ppb" → 0.5). */
export function expectedFromLabel(label: string): number | null;
export function diagnoseAnalyte(extract: EswsExtract, analyteKey: string, options?: DiagnoseOptions): AnalyteDiagnosis;

/** One row of the screening pass — the "what should I look at" table. */
export interface ScreenRow extends DiagnosisSummary {
  key: string;
  rawLabel: string;
  element: string;
  /** The recovery furthest from 100% across the run. */
  worstRecovery: number | null;
  /** No periodic check failed anywhere in the run. */
  qcClean: boolean;
  /** Every check passed and every sample landed — nothing to do here. */
  settled: boolean;
}
export function screenRun(extract: EswsExtract, options?: DiagnoseOptions & { analyteKeys?: Iterable<string> }): ScreenRow[];

/** A pre-trialled standard subset and what it would buy. */
export interface WhatIfOption extends DiagnosisSummary {
  dropLow: number;
  dropHigh: number;
  excludedRows: number[];
  floor: number | null;
  ceiling: number | null;
  r2: number | null;
  isCurrent: boolean;
  delta: { report: number; rerun: number; qcFail: number };
}
export function whatIfSubsets(
  extract: EswsExtract,
  analyteKey: string,
  options?: DiagnoseOptions & { maxDropLow?: number; maxDropHigh?: number },
): WhatIfOption[];

// .esws explorer (operate on an already-loaded JSZip instance).
export function extractCalibration(zip: unknown): Promise<unknown>;
export function extractDefinedConcentrations(
  zip: unknown,
): Promise<{ standardNames: string[]; concFor(standardName: string, element: string): number | null }>;
/** The method's own per-analyte QC acceptance limits, keyed by QC solution label. */
export function extractQcDefinitions(zip: unknown): Promise<
  Map<
    string,
    {
      label: string;
      qcType: number | null;
      failFlag: string | null;
      reportEquation: string | null;
      testEquation: string | null;
      byAnalyte: Map<string, { definedConc: number; lowerLimit: number; upperLimit: number; difference: number | null; active: boolean }>;
    }
  >
>;
export function extractQc(zip: unknown, opts?: { reportableKeys?: unknown }): Promise<unknown>;
export function extractSolutionDetail(zip: unknown, partName: string): Promise<unknown>;
export function extractRunInfo(zip: unknown): Promise<unknown>;
export function extractSpectra(zip: unknown, solutionKey: string): Promise<unknown>;
