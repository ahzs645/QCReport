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

// Quality-check engine.
export const DEFAULT_QC_CRITERIA: Readonly<Record<string, unknown>>;
export function parseQcCriteria(wb: Workbook): Record<string, unknown> | null;
export function runQcCheck(qcModel: unknown, rawUnadjusted: ParsedContract, criteria: unknown): QcResult;

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
export const CONTROL_CHART_INFO: Readonly<Record<string, unknown>>;

// .esws explorer (operate on an already-loaded JSZip instance).
export function extractCalibration(zip: unknown): Promise<unknown>;
export function extractQc(zip: unknown, opts?: { reportableKeys?: unknown }): Promise<unknown>;
export function extractSolutionDetail(zip: unknown, partName: string): Promise<unknown>;
export function extractRunInfo(zip: unknown): Promise<unknown>;
export function extractSpectra(zip: unknown, solutionKey: string): Promise<unknown>;
