// Run diagnostics for a raw ICP Expert worksheet: the screening pass an analyst
// currently does by eye, scrolling the results grid looking for failed CCVs and
// working out which samples they invalidate.
//
// The domain rules encoded here (and the vocabulary used throughout):
//
//   Calibration block — a run may recalibrate several times. Each block is one
//     Blank + Standards group and everything measured until the next group. A
//     curve, and every CCV judged against it, belongs to exactly one block;
//     pooling blocks is meaningless because sensitivity drifts between them.
//
//   Bracketing — a CCV does not certify the reading next to it, it certifies the
//     span between two of them. A sample is covered only when the CCV **before**
//     it and the CCV **after** it both pass. A failing CCV in the middle
//     therefore invalidates the data on BOTH sides, not just what follows: at
//     that moment the instrument was out of spec and there is no way to tell
//     when it drifted. A sample with no closing CCV is not bracketed either.
//
//   Tiers — CCVs are run at several levels (e.g. 500 ppb / 200 ppb / a low-level
//     check at 50 ppb). They are bracketed independently, because failing the low
//     check only invalidates results down at that level; the high end is still
//     certified by the tier that passed. The passing tiers define the span of
//     concentrations the run can actually stand behind.
//
//   Working range — the curve cannot report below its lowest retained standard.
//     Dropping low standards to rescue a fit therefore RAISES the reporting
//     floor, which is a real cost. Dropping high standards costs much less: the
//     top is certified by the CCVs, not by the top standard.
//
//   Below the floor — a result under the reporting limit survives a failed
//     bracket. If a CCV reads 15% high but the sample is below the limit anyway,
//     the bias cannot change what gets reported ("<RL" either way). This is a
//     rule, not a law, so it is toggleable (see DEFAULT_DIAGNOSTIC_RULES).
//
//   Dilution rescue — an over-range sample is not automatically a re-run. The
//     same sample is usually also on the tray at 10× or 100×; if one of those
//     lands inside the working range AND is bracketed, that reading is the
//     answer and nothing needs re-running.
//
// SCOPE — this module owns the periodic checks only: the CCVs and low-level
// checks the method defines, which certify a span of the tray. Batch QC (the
// digest LFB, the ICV, the interference check, the matrix spike, the method
// blanks) is NOT judged here. Those need the sample background subtracted, their
// own paired blank, and the matrix rules and SOP citations that live in the
// RESULTS workbook — all of which qc-engine.mjs already does. Scoring them a
// second time from a concentration parsed out of a label would give a confidently
// wrong number, so anything that is not a periodic check is left alone.
//
// Everything here is pure and browser-safe: it operates on the output of
// extractEsws() plus the two method tables from esws-explore.mjs. Nothing reads
// files or touches exceljs/xlsx.

import { baseSampleId, dilutionFactor } from "./raw-parsers/normalize.mjs";

/**
 * SolType values as ICP Expert writes them into the solution definitions.
 * SAMPLE is the catch-all: client samples, rinses, mid-tray blanks and controls
 * all carry it, so those are separated by label (see isQcCheckRow / isSampleRow).
 */
export const SOLUTION_TYPE = Object.freeze({ SAMPLE: 1, BLANK: 2, STANDARD: 3, QC: 6 });

/**
 * Curve weightings offered for the what-if refit.
 *
 * ICP Expert's own arithmetic is not reproduced exactly by any of these — it is
 * closed source, applies inter-element corrections, and its fit type varies per
 * line. Measured against this lab's own runs, "1/x" reproduces the instrument's
 * back-calculated CCV concentrations to a median 0.4% (p90 2.7%), which is why
 * it is the default; unweighted is markedly worse at the low end (median 0.7%,
 * p90 6.5%) because the top standard dominates the fit.
 *
 * A refit is therefore a WELL-FOUNDED ESTIMATE of what dropping a standard would
 * do, not a replay of the instrument. Callers should present it as such, and the
 * standards' own back-calculation residuals (returned per point) show the analyst
 * how closely the model tracks their curve before they trust its verdict.
 */
/**
 * The blank's weight under a 1/x-family weighting, where 1/x is undefined at zero.
 *
 * It anchors rather than drops: ICP Expert blank-corrects the intensities before
 * fitting, which is equivalent to pinning the curve at the blank, and the blank is
 * the one point that fixes the intercept. Measured against this lab's runs,
 * dropping it instead lands further from the instrument (median 0.55% / p90 4.0%
 * vs 0.42% / 2.7%).
 */
const BLANK_ANCHOR_WEIGHT = 1e6;

export const WEIGHTINGS = Object.freeze({
  "1/x": (p) => (p.conc > 0 ? 1 / p.conc : BLANK_ANCHOR_WEIGHT),
  "1/x^2": (p) => (p.conc > 0 ? 1 / (p.conc * p.conc) : BLANK_ANCHOR_WEIGHT),
  none: () => 1,
});

export const DEFAULT_WEIGHTING = "1/x";

/** Toggleable interpretation rules — the analyst can switch any of them off. */
export const DEFAULT_DIAGNOSTIC_RULES = Object.freeze({
  /** A sample must sit between two passing CCVs of a tier to be covered by it. */
  bracketCcv: true,
  /** A sample with no CCV after it is not bracketed (the run ended un-closed). */
  requireClosingCcv: true,
  /** A result below the reporting floor stays reportable despite a failed bracket. */
  belowFloorExempt: true,
  /** Prefer the least-diluted run that is in range (dilution costs precision). */
  preferLeastDiluted: true,
  /** An over-range reading may be answered by a dilution of the same sample. */
  dilutionRescue: true,
  /** A reading below the lowest PASSING check tier is flagged as un-certified. */
  tierFloorFromChecks: true,
});

export const RULE_INFO = Object.freeze({
  bracketCcv: "A sample is covered only when the CCV before it and the CCV after it both pass.",
  requireClosingCcv: "A sample with no CCV after it is left un-bracketed rather than assumed good.",
  belowFloorExempt: "A result below the reporting floor stays reportable even if its bracket failed — the bias cannot change a “<RL” result.",
  preferLeastDiluted: "When several dilutions of a sample are in range, report the least-diluted one.",
  dilutionRescue: "An over-range reading is answered by a dilution of the same sample when one is in range and bracketed.",
  tierFloorFromChecks: "A reading below the lowest check level that passed is flagged — that level is not certified in this block.",
});

const RINSE = /^\s*rinse\s*$/i;
const NO_RUN = /^\s*no\s*run\s*$/i;
/** Labels that mark a solution as a QC/control rather than a client sample. */
const QC_LABEL = /\b(ccv|icv|ccb|icb|ipc|qc|spike|lfb|lcs|check|recovery|blank|standard)\b/i;
/**
 * Labels that name a periodic drift check — the only kind that brackets. Used
 * solely as a fallback when the worksheet carries no QC definitions of its own.
 */
const PERIODIC_LABEL = /\b(ccv|ccb|continuing|low[\s-]*level[\s-]*check)\b/i;

const isCalibrationRow = (run) => run.solType === SOLUTION_TYPE.BLANK || run.solType === SOLUTION_TYPE.STANDARD;
const hasData = (run) => run.measurements && Object.keys(run.measurements).length > 0;

/** True for a solution that acts as a periodic QC check (CCV / low-level check). */
export function isQcCheckRow(run) {
  if (run.solType === SOLUTION_TYPE.QC) return true;
  // Blanks and controls run mid-tray carry the SAMPLE type; the label is the only
  // thing that separates them. Calibration rows are excluded by the caller.
  if (isCalibrationRow(run)) return false;
  return QC_LABEL.test(run.label) && !RINSE.test(run.label);
}

/** True for a solution that is a client sample (or a sample dilution). */
export function isSampleRow(run) {
  if (isCalibrationRow(run) || isQcCheckRow(run)) return false;
  if (RINSE.test(run.label) || NO_RUN.test(run.label)) return false;
  return hasData(run);
}

/**
 * Split a run into calibration blocks. A block opens at the first calibration
 * solution following a non-calibration one and runs until the next block opens.
 *
 * @param {Array} runs extractEsws().runs
 * @returns {Array<{ index, start, end, standardRows: number[] }>} `start`/`end` are
 *   indices into `runs`; `end` is exclusive.
 */
export function calibrationBlocks(runs) {
  const blocks = [];
  let open = false;
  runs.forEach((run, i) => {
    if (isCalibrationRow(run)) {
      if (!open) {
        blocks.push({ index: blocks.length, start: i, end: runs.length, standardRows: [] });
        open = true;
      }
      blocks[blocks.length - 1].standardRows.push(i);
    } else if (open) {
      open = false;
    }
  });
  // Each block ends where the next one begins.
  for (let i = 0; i < blocks.length - 1; i += 1) blocks[i].end = blocks[i + 1].start;
  return blocks;
}

/** Weighted least-squares of intensity on concentration. */
function fitCurve(points, weighting) {
  const w = WEIGHTINGS[weighting] || WEIGHTINGS[DEFAULT_WEIGHTING];
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (const p of points) {
    const weight = w(p);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    sw += weight; sx += weight * p.conc; sy += weight * p.intensity;
    sxx += weight * p.conc * p.conc; sxy += weight * p.conc * p.intensity;
    n += 1;
  }
  if (n < 2) return null;
  const denom = sw * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (sw * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / sw;
  // Weighted R², so it reflects the fit actually being used.
  const meanY = sy / sw;
  let ssRes = 0, ssTot = 0;
  for (const p of points) {
    const weight = w(p);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    ssRes += weight * (p.intensity - (slope * p.conc + intercept)) ** 2;
    ssTot += weight * (p.intensity - meanY) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n };
}

/** Invert a curve: the concentration a measured intensity implies. */
function concFromIntensity(fit, intensity) {
  if (!fit || !fit.slope) return null;
  return (intensity - fit.intercept) / fit.slope;
}

/**
 * The calibration standards measured in one block for one analyte.
 * @returns {Array<{ row, label, conc, intensity }>} ascending by concentration.
 */
export function blockStandards(runs, block, analyte, defined) {
  const points = [];
  for (const row of block.standardRows) {
    const run = runs[row];
    const measurement = run.measurements[analyte.key];
    if (!measurement || measurement.uncal || measurement.intensity == null) continue;
    const conc =
      run.solType === SOLUTION_TYPE.BLANK ? 0 : defined?.concFor?.(run.label, analyte.element);
    if (conc == null) continue;
    points.push({ row, label: run.label, conc, intensity: measurement.intensity });
  }
  return points.sort((a, b) => a.conc - b.conc);
}

/**
 * Acceptance window for one QC solution × analyte.
 *
 * A check only BRACKETS when the method itself defines it (Method/QCSolutionDefinitions):
 * those are the periodic drift checks the operator configured, at a known level, with
 * per-element limits. Everything else that looks like QC by its label — the digest LFB,
 * the ICV, the interference check, the mid-tray blanks — is batch QC. Those are judged
 * once per batch against the RESULTS workbook criteria (see qc-engine.mjs), not used to
 * certify a span of the tray, and several of them are run at a dilution, so comparing
 * them to a concentration parsed out of their label is wrong on both counts.
 */
function acceptanceFor(label, analyteKey, qcDefs, fallback) {
  const def = qcDefs?.get?.(label);
  const tv = def?.byAnalyte?.get?.(analyteKey);
  if (tv && tv.active && tv.definedConc != null) {
    return {
      expected: tv.definedConc,
      lower: tv.lowerLimit ?? fallback.lower,
      upper: tv.upperLimit ?? fallback.upper,
      source: "method",
    };
  }
  // Fallback for a worksheet that carries no QC definitions: accept only labels
  // that name a periodic check outright. A spike or an LFB is NOT usable here —
  // its recovery needs the sample background subtracted and its own blank paired
  // to it, which is what the batch QC engine does against the RESULTS criteria.
  if (!PERIODIC_LABEL.test(label)) return null;
  const expected = expectedFromLabel(label);
  if (expected == null) return null;
  return { expected, lower: fallback.lower, upper: fallback.upper, source: "label" };
}

/** Expected concentration encoded in a QC label, in mg/L ("CCV 500ppb" → 0.5). */
export function expectedFromLabel(label) {
  const text = String(label ?? "");
  const ppb = text.match(/(\d+(?:\.\d+)?)\s*ppb/i);
  if (ppb) return Number(ppb[1]) / 1000;
  const ppm = text.match(/(\d+(?:\.\d+)?)\s*(ppm|mg\/l)/i);
  if (ppm) return Number(ppm[1]);
  return null;
}

/**
 * Evaluate every QC check in a block for one analyte.
 * @returns {Array<{ row, label, tier, expected, measured, recovery, lower, upper, status, source }>}
 */
export function blockQcChecks(runs, block, analyte, { qcDefs, defaultWindow }) {
  const checks = [];
  for (let i = block.start; i < block.end; i += 1) {
    const run = runs[i];
    if (!isQcCheckRow(run)) continue;
    const measurement = run.measurements[analyte.key];
    if (!measurement || measurement.uncal || measurement.unadjusted == null) continue;
    const acceptance = acceptanceFor(run.label, analyte.key, qcDefs, defaultWindow);
    if (!acceptance) continue;
    // Periodic checks are run neat, so the raw reading is what the defined
    // concentration is compared against.
    const measured = measurement.unadjusted;
    const recovery = acceptance.expected ? (measured / acceptance.expected) * 100 : null;
    const status =
      recovery == null ? "na" : recovery >= acceptance.lower && recovery <= acceptance.upper ? "pass" : "fail";
    checks.push({
      row: i,
      label: run.label,
      // The tier is the level a check runs at — checks at the same level bracket each other.
      tier: acceptance.expected,
      expected: acceptance.expected,
      measured,
      intensity: measurement.intensity ?? null,
      recovery,
      lower: acceptance.lower,
      upper: acceptance.upper,
      status,
      source: acceptance.source,
    });
  }
  return checks;
}

/**
 * The tiers that can bracket, i.e. those a block runs more than once. A level
 * that appears only once (typically the 200 ppb and the low-level check, run
 * together at the end of a block) says how accurate the curve is AT that level;
 * it cannot say anything about drift over time, because there is no second
 * reading to span to. Treating it as a bracket would mark every sample before it
 * un-covered, which is not what it means.
 *
 * If nothing repeats, all checks are pooled into one series so a short run still
 * gets some time coverage rather than none.
 */
function bracketingTiers(checks) {
  const byTier = new Map();
  for (const check of checks) {
    if (!byTier.has(check.tier)) byTier.set(check.tier, []);
    byTier.get(check.tier).push(check);
  }
  const repeating = new Map([...byTier].filter(([, list]) => list.length > 1));
  if (repeating.size) return repeating;
  return checks.length ? new Map([["pooled", [...checks].sort((a, b) => a.row - b.row)]]) : new Map();
}

/**
 * The concentration span this block's checks certify.
 *
 * `low` is only raised ABOVE a level that actually failed. A run that checks at
 * one level says nothing about levels below it — the bottom of the curve is the
 * calibration floor, and it takes a failed low-level check to move it. (Reading
 * "lowest level that passed" literally would flag every sample under the CCV,
 * which is most of them.)
 */
function certifiedLevels(checks) {
  const passed = checks.filter((c) => c.status === "pass").map((c) => c.tier);
  if (!passed.length) return null;
  const failed = checks.filter((c) => c.status === "fail").map((c) => c.tier);
  const worstFail = failed.length ? Math.max(...failed) : null;
  const above = worstFail == null ? [] : passed.filter((tier) => tier > worstFail);
  return { low: above.length ? Math.min(...above) : null, high: Math.max(...passed) };
}

/**
 * Per-tier bracket status for a row, given the QC checks of its block.
 * @returns {Map<number|string, { before, after, covered, reason }>} keyed by tier.
 */
function bracketAt(row, checks, rules) {
  const out = new Map();
  for (const [tier, list] of bracketingTiers(checks)) {
    const before = [...list].reverse().find((c) => c.row < row) || null;
    const after = list.find((c) => c.row > row) || null;
    let covered;
    let reason = null;
    if (!rules.bracketCcv) {
      covered = true;
      reason = "bracketing rule off";
    } else if (!before) {
      covered = false;
      reason = "no check before this sample";
    } else if (!after) {
      covered = rules.requireClosingCcv ? false : before.status === "pass";
      reason = rules.requireClosingCcv ? "no check after this sample" : "open bracket (closing check not required)";
    } else {
      covered = before.status === "pass" && after.status === "pass";
      if (!covered) {
        const which = [before.status !== "pass" ? "before" : null, after.status !== "pass" ? "after" : null]
          .filter(Boolean)
          .join(" and ");
        reason = `check ${which} failed`;
      }
    }
    out.set(tier, { before, after, covered, reason });
  }
  return out;
}

/** True when at least one bracketing tier covers the row in time. */
function isTimeCovered(brackets) {
  return [...brackets.values()].some((b) => b.covered);
}

/**
 * Full diagnosis of one analyte across the whole run.
 *
 * @param {{ analytes, runs }} extract           extractEsws() output
 * @param {string} analyteKey                    normalised analyte key
 * @param {object} options
 * @param {Map} [options.qcDefs]                 extractQcDefinitions() output
 * @param {{ concFor: Function }} [options.defined] extractDefinedConcentrations() output
 * @param {{ lower: number, upper: number }} [options.defaultWindow] fallback % recovery window
 * @param {object} [options.rules]               overrides of DEFAULT_DIAGNOSTIC_RULES
 * @param {string} [options.weighting]           key of WEIGHTINGS
 * @param {Set<number>} [options.excludedStandardRows] standards the analyst dropped
 * @param {number} [options.reportingLimit]      reporting limit in solution units
 */
export function diagnoseAnalyte(extract, analyteKey, options = {}) {
  const {
    qcDefs,
    defined,
    defaultWindow = { lower: 90, upper: 110 },
    weighting = DEFAULT_WEIGHTING,
    excludedStandardRows,
    reportingLimit = null,
  } = options;
  const rules = { ...DEFAULT_DIAGNOSTIC_RULES, ...(options.rules || {}) };
  const analyte = extract.analytes.find((a) => a.key === analyteKey);
  if (!analyte) throw new Error(`Unknown analyte "${analyteKey}"`);
  const excluded = excludedStandardRows instanceof Set ? excludedStandardRows : new Set(excludedStandardRows || []);

  const blocks = calibrationBlocks(extract.runs).map((block) => {
    const all = blockStandards(extract.runs, block, analyte, defined);
    const points = all.map((p) => ({ ...p, included: !excluded.has(p.row) }));
    const included = points.filter((p) => p.included);
    const fit = fitCurve(included, weighting);
    // Back-calculate each standard through the fit so the analyst can see how well
    // the model tracks their curve — including the points they dropped.
    for (const point of points) {
      const back = concFromIntensity(fit, point.intensity);
      point.backCalc = back;
      point.residualPct = back != null && point.conc > 0 ? ((back - point.conc) / point.conc) * 100 : null;
    }
    const positives = included.filter((p) => p.conc > 0).map((p) => p.conc);
    const checks = blockQcChecks(extract.runs, block, analyte, { qcDefs, defaultWindow });
    return {
      ...block,
      standards: points,
      fit,
      floor: positives.length ? Math.min(...positives) : null,
      ceiling: positives.length ? Math.max(...positives) : null,
      qc: checks,
    };
  });

  const blockAt = (row) => blocks.find((b) => row >= b.start && row < b.end) || null;

  // ── Sample runs, grouped by base sample (a sample plus its dilutions) ──
  const groups = new Map();
  extract.runs.forEach((run, row) => {
    if (!isSampleRow(run)) return;
    const measurement = run.measurements[analyte.key];
    if (!measurement || measurement.uncal) return;
    const block = blockAt(row);
    const base = baseSampleId(run.label);
    const brackets = block ? bracketAt(row, block.qc, rules) : new Map();
    const timeCovered = block ? isTimeCovered(brackets) : false;
    const levels = block ? certifiedLevels(block.qc) : null;
    const factor = run.dilutionFactor || dilutionFactor(run.label) || 1;
    const floor = reportingLimit ?? block?.floor ?? null;
    const ceiling = block?.ceiling ?? analyte.calMax ?? null;
    const unadjusted = measurement.unadjusted;
    const overRange = Boolean(measurement.over) || (ceiling != null && unadjusted > ceiling);
    const belowFloor = floor != null && unadjusted < floor;

    const entry = {
      row,
      label: run.label,
      dilutionFactor: factor,
      unadjusted,
      adjusted: measurement.adjusted,
      intensity: measurement.intensity ?? null,
      rsd: measurement.rsd ?? null,
      blockIndex: block ? block.index : null,
      brackets: [...brackets.entries()].map(([tier, b]) => ({
        tier,
        covered: b.covered,
        reason: b.reason,
        before: b.before ? { row: b.before.row, label: b.before.label, status: b.before.status, recovery: b.before.recovery } : null,
        after: b.after ? { row: b.after.row, label: b.after.label, status: b.after.status, recovery: b.after.recovery } : null,
      })),
      timeCovered,
      certified: levels,
      overRange,
      belowFloor,
      floor,
      ceiling,
    };

    // Two independent questions: was the instrument in spec while this ran
    // (time), and is this reading at a level the run certifies (level)?
    const reasons = [];
    let status;
    if (overRange) {
      status = "over-range";
      reasons.push(`Reading is above the top standard (${fmt(ceiling)}) — needs a dilution.`);
    } else if (belowFloor && rules.belowFloorExempt) {
      status = "below-floor";
      reasons.push(`Below the reporting floor (${fmt(floor)}), so QC bias cannot change what is reported.`);
    } else if (!timeCovered) {
      status = "qc-fail";
      const why = entry.brackets.map((b) => b.reason).filter(Boolean)[0];
      reasons.push(why ? `Not bracketed by passing checks — ${why}.` : "Not bracketed by passing checks.");
    } else if (rules.tierFloorFromChecks && levels?.low != null && unadjusted < levels.low) {
      status = "below-certified";
      reasons.push(`Reads below the lowest check level that passed (${fmt(levels.low)}) — that level is not certified in this block.`);
    } else {
      status = "ok";
    }
    entry.status = status;
    entry.reasons = reasons;

    if (!groups.has(base)) groups.set(base, { base, runs: [] });
    groups.get(base).runs.push(entry);
  });

  // ── Pick the reading to report per sample ──
  const samples = [...groups.values()].map((group) => {
    // Readings good enough to report, best first. A reading that only reads low
    // because an un-certified level is still a number worth carrying forward —
    // it is reported with a caveat, not re-run — so it ranks last but counts.
    const RANK = { ok: 0, "below-floor": 1, "below-certified": 2 };
    const usable = group.runs.filter((r) => r.status in RANK);
    const ordered = [...usable].sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        (rules.preferLeastDiluted ? a.dilutionFactor - b.dilutionFactor : 0) ||
        a.row - b.row,
    );
    const chosen = ordered[0] || null;
    const reasons = [];
    let verdict;
    if (chosen) {
      verdict =
        chosen.status === "ok" ? "report"
        : chosen.status === "below-floor" ? "report-below-limit"
        : "report-uncertified";
      if (chosen.dilutionFactor > 1 && rules.dilutionRescue) {
        reasons.push(`Answered by the ${chosen.dilutionFactor}× dilution.`);
      }
      if (chosen.status === "below-certified") reasons.push(...chosen.reasons);
    } else if (group.runs.some((r) => r.status === "over-range")) {
      verdict = "rerun-dilute";
      reasons.push("Every reading is over-range — re-run at a higher dilution.");
    } else if (group.runs.some((r) => r.status === "qc-fail")) {
      verdict = "rerun-qc";
      reasons.push("Bracketing checks failed and no dilution of this sample is covered.");
    } else {
      verdict = "rerun";
      reasons.push("No usable reading in this run.");
    }
    return { ...group, chosen, verdict, reasons };
  }).sort((a, b) => a.base.localeCompare(b.base, "en", { numeric: true }));

  const qcAll = blocks.flatMap((b) => b.qc);
  return {
    analyte: {
      key: analyte.key,
      rawLabel: analyte.rawLabel,
      element: analyte.element,
      wavelength: analyte.wavelength,
      calMax: analyte.calMax ?? null,
    },
    weighting,
    rules,
    blocks,
    samples,
    summary: {
      qcPass: qcAll.filter((c) => c.status === "pass").length,
      qcFail: qcAll.filter((c) => c.status === "fail").length,
      report: samples.filter((s) => s.verdict === "report").length,
      reportBelowLimit: samples.filter((s) => s.verdict === "report-below-limit").length,
      reportUncertified: samples.filter((s) => s.verdict === "report-uncertified").length,
      rerun: samples.filter((s) => s.verdict.startsWith("rerun")).length,
      samples: samples.length,
    },
  };
}

const fmt = (n) => (n == null ? "—" : Number(n).toPrecision(3).replace(/\.?0+$/, ""));

/**
 * Screening pass over every analyte: the "what should I even look at" table.
 * Deliberately cheap — no what-if, no per-sample reasons, just the counts that
 * decide whether an analyte needs attention.
 *
 * @returns {Array<{ key, rawLabel, qcPass, qcFail, worstRecovery, report, reportBelowLimit, rerun, samples, clean }>}
 */
export function screenRun(extract, options = {}) {
  const keys = options.analyteKeys ? new Set(options.analyteKeys) : null;
  const rows = [];
  for (const analyte of extract.analytes) {
    if (keys && !keys.has(analyte.key)) continue;
    let diagnosis;
    try {
      diagnosis = diagnoseAnalyte(extract, analyte.key, options);
    } catch {
      continue;
    }
    const checks = diagnosis.blocks.flatMap((b) => b.qc);
    if (!checks.length && !diagnosis.samples.length) continue;
    // The recovery furthest from 100% — what the eye is scanning for.
    let worstRecovery = null;
    for (const check of checks) {
      if (check.recovery == null) continue;
      if (worstRecovery == null || Math.abs(check.recovery - 100) > Math.abs(worstRecovery - 100)) {
        worstRecovery = check.recovery;
      }
    }
    rows.push({
      key: analyte.key,
      rawLabel: analyte.rawLabel,
      element: analyte.element,
      ...diagnosis.summary,
      worstRecovery,
      /** No periodic check failed anywhere in the run. */
      qcClean: diagnosis.summary.qcFail === 0,
      /** Nothing here needs the analyst: every check passed and every sample landed. */
      settled: diagnosis.summary.qcFail === 0 && diagnosis.summary.rerun === 0,
    });
  }
  return rows.sort((a, b) => b.qcFail - a.qcFail || b.rerun - a.rerun || a.rawLabel.localeCompare(b.rawLabel, "en", { numeric: true }));
}

/**
 * Pre-trial the standard subsets an analyst would try by hand: drop standards
 * from the bottom of the curve, the top, or both, refit, and see what it buys.
 *
 * Only contiguous trims from the ends are tried, because that is the only move
 * with a physical justification — a curve is trusted over a span, and you shorten
 * the span from an end. Punching a hole in the middle to make a number behave is
 * not something the resulting data could be defended on.
 *
 * Options are ranked by how many samples become reportable, then by the least
 * damage to the reporting floor (a lower floor is strictly better), then by fit.
 *
 * @returns {Array<{ dropLow, dropHigh, excludedRows, floor, ceiling, qcPass, qcFail, report, reportBelowLimit, rerun, r2, isCurrent, delta }>}
 */
export function whatIfSubsets(extract, analyteKey, options = {}) {
  const { maxDropLow = 2, maxDropHigh = 3 } = options;
  const analyte = extract.analytes.find((a) => a.key === analyteKey);
  if (!analyte) throw new Error(`Unknown analyte "${analyteKey}"`);

  // The standards available per block, so a trim means the same thing in each.
  const blocks = calibrationBlocks(extract.runs).map((block) => ({
    block,
    points: blockStandards(extract.runs, block, analyte, options.defined),
  }));

  const baseline = diagnoseAnalyte(extract, analyteKey, { ...options, excludedStandardRows: new Set() });
  const results = [];

  for (let dropLow = 0; dropLow <= maxDropLow; dropLow += 1) {
    for (let dropHigh = 0; dropHigh <= maxDropHigh; dropHigh += 1) {
      const excluded = new Set();
      let viable = true;
      for (const { points } of blocks) {
        // The blank anchors the bottom of the curve and is not a "low standard".
        const positives = points.filter((p) => p.conc > 0);
        if (positives.length - dropLow - dropHigh < 2) {
          if (positives.length) viable = false;
          continue;
        }
        for (let i = 0; i < dropLow; i += 1) excluded.add(positives[i].row);
        for (let i = 0; i < dropHigh; i += 1) excluded.add(positives[positives.length - 1 - i].row);
      }
      if (!viable) continue;
      const diagnosis = diagnoseAnalyte(extract, analyteKey, { ...options, excludedStandardRows: excluded });
      const floors = diagnosis.blocks.map((b) => b.floor).filter((f) => f != null);
      const ceilings = diagnosis.blocks.map((b) => b.ceiling).filter((c) => c != null);
      const r2s = diagnosis.blocks.map((b) => b.fit?.r2).filter((r) => r != null);
      results.push({
        dropLow,
        dropHigh,
        excludedRows: [...excluded],
        floor: floors.length ? Math.max(...floors) : null,
        ceiling: ceilings.length ? Math.min(...ceilings) : null,
        r2: r2s.length ? Math.min(...r2s) : null,
        ...diagnosis.summary,
        isCurrent: dropLow === 0 && dropHigh === 0,
        delta: {
          report: diagnosis.summary.report - baseline.summary.report,
          rerun: diagnosis.summary.rerun - baseline.summary.rerun,
          qcFail: diagnosis.summary.qcFail - baseline.summary.qcFail,
        },
      });
    }
  }

  return results.sort(
    (a, b) =>
      b.report + b.reportBelowLimit - (a.report + a.reportBelowLimit) ||
      a.rerun - b.rerun ||
      (a.floor ?? Infinity) - (b.floor ?? Infinity) ||
      (b.r2 ?? 0) - (a.r2 ?? 0),
  );
}
