// Hand-written type surface for the light preset subpath (engine/presets.mjs) —
// the encoded constants the calculations use. Imported as:
//
//   import * as presets from "qcreport/presets";
//   import type { QcCriteria } from "qcreport/presets";
//
// These shapes are also the contract for <PresetsReference> in "qcreport/ui",
// and are re-exported from the main "qcreport" entry (engine/index.d.ts) so
// there is exactly one definition of each.

// ---- QC acceptance criteria -------------------------------------------------

/** The acceptance-range categories (QC roles share categories, e.g. both CCVs use "ccv"). */
export type RangeKey = "ccv" | "icv" | "lfb" | "lfm" | "interference" | "rpd";

/** Which QC standard a check is measured against (CODES B48/B49/B50). */
export type TrueValueKey = "spike" | "ccv" | "icv";

/** What a QC check computes. */
export type QcKind = "blank" | "recovery" | "correctedRecovery" | "rpd";

/** A canonical QC role key (the keys of QC_ROLE_LABELS). */
export type QcRoleKey =
  | "ipcBlank"
  | "ccvCalib"
  | "ccvBatch"
  | "lrb"
  | "digestLfb"
  | "instLfb"
  | "interference"
  | "icv"
  | "duplicate"
  | "lfmSpike"
  | "sample"
  | "lfmBackground";

/** An acceptance range as [low, high], in % recovery (or % RPD). */
export type AcceptanceRange = [number, number];

/** The ± tolerance and SOP citation behind one acceptance range (CODES col B / col E). */
export interface RangeInfo {
  /** ± tolerance in %, or null when the workbook cell is blank/non-numeric. */
  tolerance: number | null;
  citation: string;
}

/** A per-element true-value override (Mercury is reported in µg/L, so 100× the mg/L standards). */
export interface ElementOverride {
  /** Regex SOURCE string, compiled with `new RegExp(match)` and tested against the analyte label. */
  match: string;
  trueKey: TrueValueKey;
  value: number;
}

/**
 * QC acceptance criteria — the CODES "PERCENT RECOVERIES" table. Either the
 * encoded DEFAULT_QC_CRITERIA or the live values parseQcCriteria() reads off a
 * loaded workbook. `rangeInfo`, `elementOverrides` and `citations` are optional:
 * a hand-built criteria object may omit them, so consumers must access them
 * defensively (`c.rangeInfo?.[k]?.tolerance`).
 */
export interface QcCriteria {
  /** True values of the QC standards, in mg/L (CODES B48/B49/B50). */
  trueValues: Record<TrueValueKey, number>;
  ranges: Record<RangeKey, AcceptanceRange>;
  rangeInfo?: Partial<Record<RangeKey, RangeInfo>>;
  /** A failed digest blank (LRB) is still acceptable below either threshold (CODES C36/D36). */
  matrixBlank: {
    /** Blank as a % of the sample matrix, e.g. 10. */
    matrixPct: number;
    /** Blank as a multiple of the reporting limit, e.g. 2.2. */
    rlMultiple: number;
    rule: string;
    citation: string;
  };
  /** Minimum spike ÷ sample-background fraction for an LFM recovery to be meaningful (e.g. 0.3). */
  lfmSpikeMinMatrix: number;
  elementOverrides?: ElementOverride[];
  /** Free-form SOP citations keyed by rule name (e.g. `ipcBlank`). */
  citations?: Record<string, string>;
}

/** The encoded fallback criteria — frozen; live workbook CODES values win. */
export const DEFAULT_QC_CRITERIA: QcCriteria;

// ---- QC checks --------------------------------------------------------------

/**
 * One QC check definition: what to compute for a role, against which standard,
 * range and reference blank.
 */
export interface QcCheckDef {
  kind: QcKind;
  /** Which true value the measurement is divided by (recovery kinds only). */
  trueKey?: TrueValueKey;
  /** Which acceptance range scores the metric. */
  range?: RangeKey;
  /** Role key of the reference blank subtracted first (correctedRecovery only). */
  blankKey?: QcRoleKey;
  /** Role key of the other half of the duplicate pair (rpd only). */
  pairKey?: QcRoleKey;
  /** A failed blank is re-checked against the matrix % / RL-multiple rule. */
  matrixComparison?: true;
  /** The spike must be ≥ lfmSpikeMinMatrix of the sample background to be interpretable. */
  spikeMatrixCheck?: true;
}

/**
 * Check definitions keyed by QC role. NOT total over QcRoleKey — `sample` and
 * `lfmBackground` are reference rows used by other checks, not checks themselves,
 * so they have labels but no entry here.
 */
export interface QcCheckMap extends Partial<Record<QcRoleKey, QcCheckDef>> {
  [role: string]: QcCheckDef | undefined;
}

/** The 10 defined checks (QC_ROLE_LABELS has 12 keys; 2 are label-only). Not frozen. */
export const QC_CHECKS: QcCheckMap;

/** What each check kind computes — label + the equation, for display. */
export const QC_KINDS: Record<QcKind, { label: string; formula: string }>;

/** Human labels for the canonical QC role keys (12 entries). */
export const QC_ROLE_LABELS: Record<string, string>;

// ---- Reportable value + flags ----------------------------------------------

/** One row of the per-cell reportable decision tree, in evaluation order. */
export interface ReportableRule {
  when: string;
  result: string;
  /** Where the rule applies, when it isn't every instrument sheet. */
  note?: string;
}

/** Declarative description of reportableValue()'s decision tree (5 rules). */
export const REPORTABLE_RULES: ReadonlyArray<ReportableRule>;

/** Instrument flag codes and their display labels (CODES A10..A13). */
export const DEFAULT_FLAGS: {
  uncal: string;
  uncalLabel: string;
  over: readonly string[];
  overLabel: string;
  noData: string;
};

/** mg CaCO₃/L per mg/L of Ca / Mg. */
export const HARDNESS_COEFFICIENTS: { ca: number; mg: number };

// ---- Control charts ---------------------------------------------------------

/** Declarative description of the Shewhart control-chart math. */
export const CONTROL_CHART_INFO: {
  centerLine: string;
  spread: string;
  limitFormula: string;
  rpdFormula: string;
  performanceRule: string;
  /** Overridden by the loaded ControlChart workbook. */
  defaults: { acceptedValue: number; criterion: number };
};

// ---- Matching + parsing -----------------------------------------------------

/** Why matchSample() claimed a sample, in the order the strategies are tried. */
export type SampleMatchReason = "exact_id" | "number_and_name" | "number_and_name_partial";

/** How raw instrument rows are matched to workbook columns/samples. */
export const MATCH_INFO: {
  analyte: string;
  dilution: string;
  sampleStrategies: Array<{ reason: SampleMatchReason; description: string }>;
};

/** The whole preset bundle — the shape of `import * as presets from "qcreport/presets"`. */
export interface PresetBundle {
  DEFAULT_QC_CRITERIA: QcCriteria;
  QC_CHECKS: typeof QC_CHECKS;
  QC_KINDS: typeof QC_KINDS;
  QC_ROLE_LABELS: typeof QC_ROLE_LABELS;
  REPORTABLE_RULES: typeof REPORTABLE_RULES;
  DEFAULT_FLAGS: typeof DEFAULT_FLAGS;
  HARDNESS_COEFFICIENTS: typeof HARDNESS_COEFFICIENTS;
  CONTROL_CHART_INFO: typeof CONTROL_CHART_INFO;
  MATCH_INFO: typeof MATCH_INFO;
}
