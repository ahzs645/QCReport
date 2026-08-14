import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIAGNOSTIC_RULES,
  calibrationBlocks,
  diagnoseAnalyte,
  screenRun,
  whatIfSubsets,
  SOLUTION_TYPE,
} from "../scripts/lib/qc-diagnostics.mjs";
import { baseSampleId } from "../scripts/lib/raw-parsers/normalize.mjs";

// ── Fixture builders ────────────────────────────────────────────────────────
// A synthetic run with one analyte on a clean 1000 cps per mg/L response, so the
// intensity a row carries is just conc × 1000 and every number below is readable.

const ANALYTE = { key: "x 100.000 nm", rawLabel: "X 100.000 nm", element: "X", wavelength: 100, calMax: 1 };
const SLOPE = 1000;

/** A calibration standard row at a defined concentration. */
const std = (label, conc) => ({
  label,
  solType: conc === 0 ? SOLUTION_TYPE.BLANK : SOLUTION_TYPE.STANDARD,
  dilution: 1,
  dilutionFactor: 1,
  measurements: { [ANALYTE.key]: { adjusted: conc, unadjusted: conc, intensity: conc * SLOPE, over: false } },
});

/** A QC check reading `measured` where `expected` was prepared. */
const qc = (label, measured) => ({
  label,
  solType: SOLUTION_TYPE.QC,
  dilution: 1,
  dilutionFactor: 1,
  measurements: { [ANALYTE.key]: { adjusted: measured, unadjusted: measured, intensity: measured * SLOPE, over: false } },
});

/** A client sample row; `factor` is the dilution it was run at. */
const sample = (label, unadjusted, factor = 1) => ({
  label,
  solType: SOLUTION_TYPE.SAMPLE,
  dilution: factor,
  dilutionFactor: factor,
  measurements: {
    [ANALYTE.key]: {
      adjusted: unadjusted * factor,
      unadjusted,
      intensity: unadjusted * SLOPE,
      over: unadjusted > ANALYTE.calMax,
    },
  },
});

const CONCS = { "Std 1": 0.05, "Std 2": 0.2, "Std 3": 0.5, "Std 4": 1 };
const defined = { concFor: (label) => CONCS[label] ?? null };

/** Method-defined acceptance at three levels, as a real method carries them. */
const level = (conc, lower, upper) => ({
  byAnalyte: new Map([[ANALYTE.key, { definedConc: conc, lowerLimit: lower, upperLimit: upper, active: true }]]),
});
const qcDefs = new Map([
  ["CCV", level(0.5, 90, 110)],
  ["Mid Check", level(0.2, 80, 120)],
  ["Low Check", level(0.05, 70, 130)],
]);

const calibration = () => [std("Blank", 0), std("Std 1", 0.05), std("Std 2", 0.2), std("Std 3", 0.5), std("Std 4", 1)];
const extractOf = (runs) => ({ analytes: [ANALYTE], runs });
const opts = { qcDefs, defined };
const find = (result, base) => result.samples.find((s) => s.base === base);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("calibrationBlocks", () => {
  it("opens a block at each standards group and closes it at the next", () => {
    const runs = [
      ...calibration(), qc("CCV", 0.5), sample("A", 0.3),
      ...calibration(), qc("CCV", 0.5), sample("B", 0.3),
    ];
    const blocks = calibrationBlocks(runs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ start: 0, end: 7 });
    expect(blocks[1]).toMatchObject({ start: 7, end: runs.length });
    expect(blocks[0].standardRows).toEqual([0, 1, 2, 3, 4]);
  });

  it("treats a single uninterrupted group as one block", () => {
    expect(calibrationBlocks([...calibration(), sample("A", 0.3)])).toHaveLength(1);
  });
});

describe("bracketing", () => {
  it("reports a sample sitting between two passing checks", () => {
    const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3), qc("CCV", 0.51)];
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts);
    expect(find(result, "A").verdict).toBe("report");
    expect(find(result, "A").chosen.status).toBe("ok");
  });

  it("invalidates BOTH sides of a failing check, not just what follows", () => {
    // Two good CCVs at the ends, one badly high in the middle: everything the
    // middle one touches is questionable because the drift time is unknown.
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("before", 0.3), qc("CCV", 0.75), sample("after", 0.3), qc("CCV", 0.5),
    ];
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts);
    expect(find(result, "before").verdict).toBe("rerun-qc");
    expect(find(result, "after").verdict).toBe("rerun-qc");
  });

  it("leaves a sample with no closing check un-bracketed", () => {
    const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3)];
    expect(find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "A").verdict).toBe("rerun-qc");
  });

  it("accepts an open bracket when requireClosingCcv is switched off", () => {
    const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3)];
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, { ...opts, rules: { requireClosingCcv: false } });
    expect(find(result, "A").verdict).toBe("report");
  });

  it("does not bracket on a level that only runs once", () => {
    // The low check appears a single time; it must not un-cover the sample
    // before it just by existing.
    const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3), qc("CCV", 0.5), qc("Low Check", 0.05)];
    expect(find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "A").verdict).toBe("report");
  });
});

describe("level certification", () => {
  it("lifts the floor to the next level that passed above a failure", () => {
    // Low check (0.05) fails, mid (0.2) and CCV (0.5) pass: the run stands
    // behind 0.2 and up, so 0.3 reports and 0.1 does not.
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("high", 0.3), sample("low", 0.1), qc("CCV", 0.5),
      qc("Mid Check", 0.2), qc("Low Check", 0.02),
    ];
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts);
    expect(find(result, "high").verdict).toBe("report");
    expect(find(result, "low").verdict).toBe("report-uncertified");
    expect(find(result, "low").chosen.status).toBe("below-certified");
  });

  it("treats the whole gap above a failed level as uncertified when nothing checks it", () => {
    // Only 0.05 (failed) and 0.5 (passed) were checked, so 0.3 sits in a gap
    // the run has no evidence for — conservative by design.
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("mid", 0.3), qc("CCV", 0.5), qc("Low Check", 0.02),
    ];
    expect(find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "mid").verdict).toBe("report-uncertified");
  });

  it("does not lift the floor when no check failed", () => {
    const runs = [...calibration(), qc("CCV", 0.5), sample("low", 0.08), qc("CCV", 0.5)];
    expect(find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "low").verdict).toBe("report");
  });

  it("certifies the low end once the low check passes", () => {
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("low", 0.1), qc("CCV", 0.5), qc("Low Check", 0.05),
    ];
    expect(find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "low").verdict).toBe("report");
  });

  it("can be switched off with tierFloorFromChecks", () => {
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("low", 0.1), qc("CCV", 0.5), qc("Low Check", 0.02),
    ];
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, { ...opts, rules: { tierFloorFromChecks: false } });
    expect(find(result, "low").verdict).toBe("report");
  });
});

describe("below the reporting floor", () => {
  const runs = [...calibration(), qc("CCV", 0.5), sample("tiny", 0.001), qc("CCV", 0.75), qc("CCV", 0.5)];

  it("survives a failed bracket — the bias cannot change a “<RL” result", () => {
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts);
    expect(find(result, "tiny").verdict).toBe("report-below-limit");
  });

  it("becomes a QC failure when the exemption is switched off", () => {
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, { ...opts, rules: { belowFloorExempt: false } });
    expect(find(result, "tiny").verdict).toBe("rerun-qc");
  });
});

describe("dilution rescue", () => {
  it("answers an over-range sample with its own dilution", () => {
    const runs = [
      ...calibration(),
      qc("CCV", 0.5),
      sample("A", 5),                    // over the top standard of 1
      sample("A - Dil. 10X", 0.5, 10),   // the same sample, in range
      qc("CCV", 0.5),
    ];
    const result = diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts);
    const A = find(result, "A");
    expect(A.verdict).toBe("report");
    expect(A.chosen.dilutionFactor).toBe(10);
    expect(A.reasons.join(" ")).toContain("10×");
  });

  it("prefers the least-diluted reading that is in range", () => {
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("A", 0.4), sample("A - Dil. 10X", 0.04, 10), qc("CCV", 0.5),
    ];
    const A = find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "A");
    expect(A.chosen.dilutionFactor).toBe(1);
  });

  it("calls for a re-run when every dilution is still over-range", () => {
    const runs = [
      ...calibration(),
      qc("CCV", 0.5), sample("A", 50), sample("A - Dil. 10X", 5, 10), qc("CCV", 0.5),
    ];
    expect(find(diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts), "A").verdict).toBe("rerun-dilute");
  });

  it("groups a dilution written with a separator onto its base sample", () => {
    // Regression: "A - Dil. 100X" used to reduce to "A -" and orphan itself.
    expect(baseSampleId("2026NALS02603 A05 - Dil. 100X")).toBe("2026NALS02603 A05");
    expect(baseSampleId("2025NALS02478 B03 Dil. 10X")).toBe("2025NALS02478 B03");
  });
});

describe("curve fitting and what-if", () => {
  const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3), qc("CCV", 0.5)];

  it("recovers the response and back-calculates the standards", () => {
    const [block] = diagnoseAnalyte(extractOf(runs), ANALYTE.key, opts).blocks;
    expect(block.fit.slope).toBeCloseTo(SLOPE, 6);
    expect(block.fit.r2).toBeCloseTo(1, 10);
    expect(block.floor).toBe(0.05);
    expect(block.ceiling).toBe(1);
    for (const point of block.standards) {
      if (point.conc > 0) expect(point.residualPct).toBeCloseTo(0, 6);
    }
  });

  it("raises the reporting floor when low standards are dropped", () => {
    const excluded = new Set([1]); // Std 1 @ 0.05
    const [block] = diagnoseAnalyte(extractOf(runs), ANALYTE.key, { ...opts, excludedStandardRows: excluded }).blocks;
    expect(block.floor).toBe(0.2);
    expect(block.standards.find((p) => p.row === 1).included).toBe(false);
  });

  it("ranks the option that reports the most samples first, and marks the current one", () => {
    const options = whatIfSubsets(extractOf(runs), ANALYTE.key, opts);
    expect(options.length).toBeGreaterThan(1);
    const best = options[0];
    const totalReported = (o) => o.report + o.reportBelowLimit;
    for (const option of options.slice(1)) expect(totalReported(best)).toBeGreaterThanOrEqual(totalReported(option));
    const current = options.find((o) => o.isCurrent);
    expect(current).toMatchObject({ dropLow: 0, dropHigh: 0, delta: { report: 0 } });
  });

  it("only trims standards from the ends of the curve", () => {
    const options = whatIfSubsets(extractOf(runs), ANALYTE.key, opts);
    const positives = [1, 2, 3, 4]; // rows of Std 1..4, ascending in concentration
    for (const option of options) {
      const dropped = positives.filter((row) => option.excludedRows.includes(row));
      const kept = positives.filter((row) => !option.excludedRows.includes(row));
      // Whatever is kept must be a contiguous run of the ascending standards.
      expect(kept).toEqual(positives.slice(positives.indexOf(kept[0]), positives.indexOf(kept.at(-1)) + 1));
      expect(dropped.length + kept.length).toBe(positives.length);
    }
  });
});

describe("screenRun", () => {
  it("summarises every analyte and sorts the ones needing attention first", () => {
    const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3), qc("CCV", 0.9), qc("CCV", 0.5)];
    const [row] = screenRun(extractOf(runs), opts);
    expect(row).toMatchObject({ key: ANALYTE.key, rawLabel: ANALYTE.rawLabel, qcClean: false });
    expect(row.qcFail).toBe(1);
    expect(row.worstRecovery).toBeCloseTo(180, 6);
  });

  it("marks a run with no failures settled", () => {
    const runs = [...calibration(), qc("CCV", 0.5), sample("A", 0.3), qc("CCV", 0.5)];
    expect(screenRun(extractOf(runs), opts)[0]).toMatchObject({ qcClean: true, settled: true, rerun: 0 });
  });
});

describe("DEFAULT_DIAGNOSTIC_RULES", () => {
  it("is frozen so a caller cannot mutate the shared defaults", () => {
    expect(Object.isFrozen(DEFAULT_DIAGNOSTIC_RULES)).toBe(true);
  });
});
