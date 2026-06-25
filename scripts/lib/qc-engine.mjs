// Quality-check engine — the QC equations re-implemented in code (not relying on
// the QC workbook's embedded formulas), so the browser app can compute and show
// the quality check from the raw instrument data alone.
//
// Mirrors BATCH rows 96–107:
//   blank role        -> PASS iff the blank reads below the reporting limit
//   recovery role     -> measured / trueValue × 100
//   corrected recovery-> (measured − referenceBlank) / trueValue × 100
//   duplicate         -> RPD = ABS(r1−r2)/((r1+r2)/2) × 100  (both <RL -> PASS)
// True values: spike 0.1, CCV 0.5, ICV 0.5 (CODES!B48/B49/B50). Acceptance ranges
// are SOP-driven and editable here; raw recovery/RPD numbers are always surfaced.
//
// Pure — primitives + parsed data in, structured results out. Tested in
// test/qc-engine.test.mjs and cross-checked against the real QC workbook.

import { reportableValue } from "./formula-engine.mjs";
import { toNumber } from "./sheet-utils.mjs";
import { normalizeSampleId } from "./raw-parsers/normalize.mjs";

export const DEFAULT_QC_CRITERIA = Object.freeze({
  trueValues: { spike: 0.1, ccv: 0.5, icv: 0.5 },
  ranges: { ccv: [90, 110], icv: [90, 110], lfb: [85, 115], lfm: [80, 120], interference: [85, 115], rpd: [0, 20] },
  // Per-element true-value overrides. Mercury is reported in µg/L, so its spike
  // true-value is 100× the mg/L standards — matching the workbook's LFB recovery.
  elementOverrides: [{ match: "^Hg ", trueKey: "spike", value: 10 }],
});

/** Resolve the true value for an analyte + QC type, applying element overrides. */
function trueValueFor(analyteLabel, trueKey, criteria) {
  for (const ov of criteria.elementOverrides || []) {
    if (ov.trueKey === trueKey && new RegExp(ov.match).test(analyteLabel)) return ov.value;
  }
  return criteria.trueValues[trueKey];
}

// Map a BATCH column-A role label to a canonical key. Order matters
// (DUPLICATE before SAMPLE; Method Blank before LFB).
const ROLE_KEYS = [
  [/IPC Blank/i, "ipcBlank"],
  [/CCV5? after Calibration/i, "ccvCalib"],
  [/CCV5? after Batch/i, "ccvBatch"],
  [/Digest Method Blank/i, "lrb"],
  [/Digest LFB/i, "digestLfb"],
  [/SAMPLE DUPLICATE/i, "duplicate"],
  [/SAMPLE,? RPD/i, "sample"],
  [/LFM Background/i, "lfmBackground"],
  [/LFM Spike/i, "lfmSpike"],
  [/Instrument LFB/i, "instLfb"],
  [/Instrument Interference/i, "interference"],
  [/Instrument ICV/i, "icv"],
];

// What each check kind computes (rendered in the app; co-located with the math).
export const QC_KINDS = Object.freeze({
  blank: { label: "Blank", formula: "PASS if the blank's reportable equals its “<DL” label (reads below the reporting limit)" },
  recovery: { label: "Recovery", formula: "measured ÷ trueValue × 100" },
  correctedRecovery: { label: "Blank-corrected recovery", formula: "(measured − reference blank) ÷ trueValue × 100" },
  rpd: { label: "RPD (duplicate)", formula: "|R₁ − R₂| ÷ ((R₁ + R₂) / 2) × 100   (both <RL → PASS)" },
});

// Human labels for the canonical QC role keys (the one allowed "matching map").
export const QC_ROLE_LABELS = Object.freeze({
  ipcBlank: "IPC Blank (after calibration)",
  ccvCalib: "CCV after calibration",
  ccvBatch: "CCV after batch",
  lrb: "Digest Method Blank (LRB)",
  digestLfb: "Digest LFB",
  instLfb: "Instrument LFB",
  interference: "Instrument Interference Check",
  icv: "Instrument ICV",
  duplicate: "Sample / Duplicate (RPD)",
  lfmSpike: "LFM Spike",
  sample: "Sample (RPD reference)",
  lfmBackground: "LFM Background (reference)",
});

// Per-key check definition. Keys without an entry (sample, lfmBackground) are
// reference rows used by other checks, not checks themselves.
export const QC_CHECKS = {
  ipcBlank: { kind: "blank" },
  lrb: { kind: "blank" },
  ccvCalib: { kind: "recovery", trueKey: "ccv", range: "ccv" },
  ccvBatch: { kind: "recovery", trueKey: "ccv", range: "ccv" },
  icv: { kind: "recovery", trueKey: "icv", range: "icv" },
  digestLfb: { kind: "correctedRecovery", trueKey: "spike", blankKey: "lrb", range: "lfb" },
  instLfb: { kind: "correctedRecovery", trueKey: "spike", blankKey: "ipcBlank", range: "lfb" },
  interference: { kind: "correctedRecovery", trueKey: "spike", blankKey: "ipcBlank", range: "interference" },
  lfmSpike: { kind: "correctedRecovery", trueKey: "spike", blankKey: "lfmBackground", range: "lfm" },
  duplicate: { kind: "rpd", pairKey: "sample", range: "rpd" },
};

export function roleKey(roleLabel) {
  for (const [re, key] of ROLE_KEYS) if (re.test(roleLabel)) return key;
  return null;
}

// ---- equations -------------------------------------------------------------

/** Blank PASS iff its reportable equals the "<RL" label (reads below the RL). */
export function blankPassFail(reportable, belowLabel) {
  return String(reportable) === String(belowLabel) ? "PASS" : "FAIL";
}

export function recovery(measured, trueValue) {
  if (measured === null || !trueValue) return null;
  return (measured / trueValue) * 100;
}

export function correctedRecovery(measured, blank, trueValue) {
  if (measured === null || !trueValue) return null;
  return ((measured - (blank ?? 0)) / trueValue) * 100;
}

export function rpd(r1, r2) {
  const a = toNumber(r1);
  const b = toNumber(r2);
  if ((a === 0 || a === null) && (b === 0 || b === null)) return { value: null, note: "Both <RL" };
  if (a === null || b === null || a + b === 0) return { value: null, note: "n/a" };
  return { value: (Math.abs(b - a) / ((a + b) / 2)) * 100, note: null };
}

/** PASS if within [lo,hi], else FAIL. */
export function classify(value, range) {
  if (value === null || !range) return "n/a";
  return value >= range[0] && value <= range[1] ? "PASS" : "FAIL";
}

// ---- the check -------------------------------------------------------------

/**
 * Reportable value for one QC cell, and the numeric value used in recovery calcs
 * (below-RL is treated as 0, per BATCH rows 71–82).
 */
function reportableFor(measured, analyte) {
  const reportable = reportableValue(measured, {
    detectionLimit: analyte.detectionLimit,
    belowLabel: analyte.belowLabel,
  });
  const calcValue = String(reportable) === String(analyte.belowLabel) ? 0 : toNumber(reportable);
  return { reportable, calcValue };
}

/**
 * Run the quality check.
 * @param {object} qcModel - parseQcBatch() result (qcRows: {role,rawLabel}, analytes: {key,label,detectionLimit,belowLabel})
 * @param {object} rawUnadjusted - parseIcpoesConc(..., {sheet:"Unadjusted Concentration"})
 * @param {object} [criteria=DEFAULT_QC_CRITERIA]
 * @returns {{ checks, summary }} checks: per role-with-a-check; summary: counts
 */
export function runQcCheck(qcModel, rawUnadjusted, criteria = DEFAULT_QC_CRITERIA) {
  const rawByLabel = new Map();
  for (const row of rawUnadjusted.rows) {
    const k = normalizeSampleId(row.label);
    if (!rawByLabel.has(k)) rawByLabel.set(k, row);
  }

  // key -> per-analyte { reportable, calcValue } for every QC row we can map.
  const measuredByKey = new Map();
  const rowMeta = new Map();
  for (const qcRow of qcModel.qcRows) {
    const key = roleKey(qcRow.role);
    if (!key) continue;
    const raw = rawByLabel.get(normalizeSampleId(qcRow.rawLabel));
    if (!raw) continue;
    const perAnalyte = {};
    for (const a of qcModel.analytes) {
      perAnalyte[a.key] = reportableFor(raw.values[a.key] ?? null, a);
    }
    measuredByKey.set(key, perAnalyte);
    rowMeta.set(key, { role: qcRow.role, rawLabel: qcRow.rawLabel });
  }

  const checks = [];
  let pass = 0;
  let fail = 0;
  for (const [key, def] of Object.entries(QC_CHECKS)) {
    const measured = measuredByKey.get(key);
    if (!measured) continue;
    const meta = rowMeta.get(key);
    const results = [];
    for (const a of qcModel.analytes) {
      const m = measured[a.key];
      if (!m) continue;
      let metric = null;
      let unit = null;
      let status = "n/a";
      if (def.kind === "blank") {
        status = blankPassFail(m.reportable, a.belowLabel);
      } else if (def.kind === "recovery") {
        metric = recovery(m.calcValue, trueValueFor(a.label, def.trueKey, criteria));
        unit = "%recovery";
        status = classify(metric, criteria.ranges[def.range]);
      } else if (def.kind === "correctedRecovery") {
        const blank = measuredByKey.get(def.blankKey)?.[a.key]?.calcValue ?? 0;
        metric = correctedRecovery(m.calcValue, blank, trueValueFor(a.label, def.trueKey, criteria));
        unit = "%recovery";
        status = classify(metric, criteria.ranges[def.range]);
      } else if (def.kind === "rpd") {
        const other = measuredByKey.get(def.pairKey)?.[a.key];
        const r = rpd(other?.calcValue, m.calcValue);
        metric = r.value;
        unit = r.note || "%RPD";
        status = r.value === null ? "PASS" : classify(r.value, criteria.ranges[def.range]);
      }
      results.push({ analyte: a.label, reportable: m.reportable, metric, unit, status });
      if (status === "PASS") pass += 1;
      else if (status === "FAIL") fail += 1;
    }
    checks.push({ key, role: meta.role, rawLabel: meta.rawLabel, kind: def.kind, results });
  }

  return { checks, summary: { pass, fail, total: pass + fail } };
}
