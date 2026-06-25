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
import { cellValue, toNumber } from "./sheet-utils.mjs";
import { normalizeSampleId } from "./raw-parsers/normalize.mjs";

// Defaults mirror the QC workbook's CODES "PERCENT RECOVERIES" table (rows 32–50)
// verbatim, including the EPA 200.7 / Standard Method citations. parseQcCriteria()
// reads these straight from a loaded workbook's CODES sheet so the live values
// always win; these are the fallback when no workbook CODES is available.
export const DEFAULT_QC_CRITERIA = Object.freeze({
  trueValues: { spike: 0.1, ccv: 0.5, icv: 0.5 }, // CODES B48/B49/B50 (mg/L)
  ranges: { ccv: [90, 110], icv: [95, 105], lfb: [80, 120], lfm: [70, 130], interference: [70, 130], rpd: [0, 20] },
  // ± tolerance and the SOP citation behind each range (CODES col B / col E).
  rangeInfo: {
    ccv: { tolerance: 10, citation: "EPA 200.7, §9.3.4" },
    icv: { tolerance: 5, citation: "Standard Method 1020 B" },
    lfb: { tolerance: 20, citation: "EPA 200.7, §9.3.2" },
    lfm: { tolerance: 30, citation: "EPA 200.7, §9.3.5" },
    interference: { tolerance: 30, citation: "EPA 200.7, §9.3.5 (uses LFM values)" },
    rpd: { tolerance: 20, citation: "Standard Method 1020 B; BCMOE Section C Metals C-9" },
  },
  // A failed digest blank (LRB) is still acceptable if it's below either threshold;
  // an LFM spike < this fraction of the sample background gives an uninterpretable recovery.
  matrixBlank: { matrixPct: 10, rlMultiple: 2.2, rule: "<RL or up to 10% of sample matrix or 2.2X RL", citation: "EPA 200.7, §9.3.1" }, // CODES C36 / D36
  lfmSpikeMinMatrix: 0.3, // spike must be ≥30% of sample background to interpret recovery (BATCH row 102)
  // Per-element true-value overrides. Mercury is reported in µg/L, so its true
  // values are 100× the mg/L standards (CODES col C: spike 10, CCV/ICV 50 µg/L).
  elementOverrides: [
    { match: "^Hg ", trueKey: "spike", value: 10 },
    { match: "^Hg ", trueKey: "ccv", value: 50 },
    { match: "^Hg ", trueKey: "icv", value: 50 },
  ],
  citations: { ipcBlank: "EPA 200.7, §9.3.4" }, // IPC/NALS blank rule (CODES row 33)
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
  lrb: { kind: "blank", matrixComparison: true }, // failed LRB: also check vs 10% matrix / 2.2×RL
  ccvCalib: { kind: "recovery", trueKey: "ccv", range: "ccv" },
  ccvBatch: { kind: "recovery", trueKey: "ccv", range: "ccv" },
  icv: { kind: "recovery", trueKey: "icv", range: "icv" },
  digestLfb: { kind: "correctedRecovery", trueKey: "spike", blankKey: "lrb", range: "lfb" },
  instLfb: { kind: "correctedRecovery", trueKey: "spike", blankKey: "ipcBlank", range: "lfb" },
  interference: { kind: "correctedRecovery", trueKey: "spike", blankKey: "ipcBlank", range: "interference" },
  lfmSpike: { kind: "correctedRecovery", trueKey: "spike", blankKey: "lfmBackground", range: "lfm", spikeMatrixCheck: true },
  duplicate: { kind: "rpd", pairKey: "sample", range: "rpd" },
};

export function roleKey(roleLabel) {
  for (const [re, key] of ROLE_KEYS) if (re.test(roleLabel)) return key;
  return null;
}

// Which acceptance-range category each QC role uses (roles share categories).
const RANGE_CATEGORY = {
  ccvCalib: "ccv", ccvBatch: "ccv", icv: "icv",
  digestLfb: "lfb", instLfb: "lfb", lfmSpike: "lfm",
  interference: "interference", duplicate: "rpd",
};

/** Deep-clone a criteria object so parsing never mutates the frozen default. */
function cloneCriteria(c) {
  return {
    trueValues: { ...c.trueValues },
    ranges: Object.fromEntries(Object.entries(c.ranges).map(([k, v]) => [k, [...v]])),
    rangeInfo: Object.fromEntries(Object.entries(c.rangeInfo || {}).map(([k, v]) => [k, { ...v }])),
    matrixBlank: { ...c.matrixBlank },
    lfmSpikeMinMatrix: c.lfmSpikeMinMatrix,
    elementOverrides: (c.elementOverrides || []).map((o) => ({ ...o })),
    citations: { ...(c.citations || {}) },
  };
}

/** Set a QC true value + its Hg (µg/L) element override from a CODES amount row. */
function setAmount(out, trueKey, metals, hg) {
  if (metals !== null) out.trueValues[trueKey] = metals;
  if (hg !== null) {
    out.elementOverrides = out.elementOverrides.filter((o) => !(o.trueKey === trueKey && o.match === "^Hg "));
    out.elementOverrides.push({ match: "^Hg ", trueKey, value: hg });
  }
}

/**
 * Read the QC acceptance criteria straight from a loaded workbook's CODES sheet
 * ("PERCENT RECOVERIES" table + spike-amount table), so the live workbook values
 * — ranges, ± tolerances, SOP citations, true values, the LRB matrix/RL rule —
 * always win over the encoded defaults. Returns a full criteria object, or null
 * if the workbook has no recognisable CODES table (caller falls back to default).
 */
export function parseQcCriteria(wb) {
  const ws = wb?.getWorksheet?.("CODES");
  if (!ws) return null;
  const num = (v) => toNumber(cellValue(v));
  const text = (v) => String(cellValue(v) ?? "").trim();

  let head = null;
  for (let r = 1; r <= 80; r += 1) {
    if (/PERCENT RECOVERIES/i.test(text(ws.getCell(r, 1).value))) { head = r; break; }
  }
  if (head === null) return null;

  const out = cloneCriteria(DEFAULT_QC_CRITERIA);
  // Recovery ranges: A=role, B=± tolerance (or text), C=low%, D=high%, E=citation.
  for (let r = head + 1; r <= head + 16; r += 1) {
    const label = text(ws.getCell(r, 1).value);
    const key = label ? roleKey(label) : null;
    if (!key) continue;
    const tol = num(ws.getCell(r, 2).value);
    const lo = num(ws.getCell(r, 3).value);
    const hi = num(ws.getCell(r, 4).value);
    const citation = text(ws.getCell(r, 5).value).replace(/^<--\s*/, "");
    if (key === "lrb") {
      if (lo !== null) out.matrixBlank.matrixPct = lo;
      if (hi !== null) out.matrixBlank.rlMultiple = hi;
      const rule = text(ws.getCell(r, 2).value);
      if (rule) out.matrixBlank.rule = rule;
      if (citation) out.matrixBlank.citation = citation;
      continue;
    }
    if (key === "ipcBlank") { if (citation) out.citations.ipcBlank = citation; continue; }
    const cat = RANGE_CATEGORY[key];
    if (!cat) continue;
    if (cat === "rpd") {
      if (tol !== null) out.ranges.rpd = [0, tol];
      out.rangeInfo.rpd = { tolerance: tol, citation };
    } else if (lo !== null && hi !== null) {
      out.ranges[cat] = [lo, hi];
      out.rangeInfo[cat] = { tolerance: tol, citation };
    }
  }
  // Spike / CCV / ICV amounts: A=label, B=all metals (mg/L), C=Hg (µg/L).
  for (let r = head; r <= head + 30; r += 1) {
    const label = text(ws.getCell(r, 1).value);
    if (!label) continue;
    const metals = num(ws.getCell(r, 2).value);
    const hg = num(ws.getCell(r, 3).value);
    if (/SPIKE AMOUNT/i.test(label)) setAmount(out, "spike", metals, hg);
    else if (/CCV5?\s*Amount/i.test(label)) setAmount(out, "ccv", metals, hg);
    else if (/ICV\s*Amount/i.test(label)) setAmount(out, "icv", metals, hg);
  }
  return out;
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

/**
 * Acceptability verdict for a FAILED digest blank — BATCH rows 106 ("Comparison to
 * Sample Matrix") and 107 ("Comparison to 2.2X RL"). A blank above the RL is still
 * acceptable if it's < matrixPct% of the sample matrix OR < rlMultiple × the RL.
 * Returns the two workbook verdicts verbatim plus a combined acceptability flag.
 */
export function matrixBlankVerdict(blankValue, sampleValue, rl, mb = DEFAULT_QC_CRITERIA.matrixBlank) {
  const matrixOk = typeof sampleValue === "number" && sampleValue > 0 && (blankValue / sampleValue) * 100 < mb.matrixPct;
  const rlOk = typeof rl === "number" && rl > 0 && blankValue < mb.rlMultiple * rl;
  const matrixVerdict = typeof sampleValue === "number" && sampleValue > 0 ? (matrixOk ? `<${mb.matrixPct}% Matrix` : `>${mb.matrixPct}% Matrix`) : null;
  const rlVerdict = typeof rl === "number" && rl > 0 ? (rlOk ? `<${mb.rlMultiple}X RL` : `>${mb.rlMultiple}X RL`) : null;
  const acceptable = matrixOk || rlOk;
  const note = [matrixVerdict, rlVerdict].filter(Boolean).join(" · ") + (acceptable ? " — acceptable" : "");
  return { acceptable, matrixVerdict, rlVerdict, note };
}

/**
 * LFM spike recovery is uninterpretable when the spike added is < minFraction of
 * the sample's own background (the matrix dominates) — BATCH row 102's
 * "Spike < 30% of Sample Matrix" branch. True iff it should be flagged.
 */
export function spikeBelowMatrix(spikeTrue, sampleBackground, minFraction = DEFAULT_QC_CRITERIA.lfmSpikeMinMatrix) {
  return typeof sampleBackground === "number" && sampleBackground > 0 && spikeTrue / sampleBackground < minFraction;
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
      let note = null;
      if (def.kind === "blank") {
        status = blankPassFail(m.reportable, a.belowLabel);
        // A failed digest blank can still be acceptable if it's <10% of the sample
        // matrix OR < 2.2×RL (the CODES "<RL or up to 10% of matrix or 2.2X RL" rule).
        if (def.matrixComparison && status === "FAIL") {
          const sample = measuredByKey.get("sample")?.[a.key]?.calcValue;
          note = matrixBlankVerdict(m.calcValue, sample, a.detectionLimit, criteria.matrixBlank).note;
        }
      } else if (def.kind === "recovery") {
        metric = recovery(m.calcValue, trueValueFor(a.label, def.trueKey, criteria));
        unit = "%recovery";
        status = classify(metric, criteria.ranges[def.range]);
      } else if (def.kind === "correctedRecovery") {
        const blank = measuredByKey.get(def.blankKey)?.[a.key]?.calcValue ?? 0;
        const trueValue = trueValueFor(a.label, def.trueKey, criteria);
        // LFM spike recovery is uninterpretable when the spike is < 30% of the
        // sample background (the matrix dominates) — flag instead of reporting %.
        if (def.spikeMatrixCheck && spikeBelowMatrix(trueValue, blank, criteria.lfmSpikeMinMatrix)) {
          unit = "Spike < 30% of Sample Matrix";
          note = "spike < 30% of sample background — recovery not meaningful";
        } else {
          metric = correctedRecovery(m.calcValue, blank, trueValue);
          unit = "%recovery";
          status = classify(metric, criteria.ranges[def.range]);
        }
      } else if (def.kind === "rpd") {
        const other = measuredByKey.get(def.pairKey)?.[a.key];
        const r = rpd(other?.calcValue, m.calcValue);
        metric = r.value;
        unit = r.note || "%RPD";
        status = r.value === null ? "PASS" : classify(r.value, criteria.ranges[def.range]);
      }
      results.push({ analyte: a.label, reportable: m.reportable, metric, unit, status, note });
      if (status === "PASS") pass += 1;
      else if (status === "FAIL") fail += 1;
    }
    checks.push({ key, role: meta.role, rawLabel: meta.rawLabel, kind: def.kind, results });
  }

  return { checks, summary: { pass, fail, total: pass + fail } };
}
