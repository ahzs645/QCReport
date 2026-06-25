import { describe, expect, it } from "vitest";
import {
  blankPassFail,
  classify,
  correctedRecovery,
  matrixBlankVerdict,
  recovery,
  roleKey,
  rpd,
  spikeBelowMatrix,
} from "../scripts/lib/qc-engine.mjs";

describe("blankPassFail", () => {
  it("PASS when the blank reads below the reporting limit", () => {
    expect(blankPassFail("<0.007", "<0.007")).toBe("PASS");
  });
  it("FAIL when the blank reads a real number (contamination)", () => {
    expect(blankPassFail(0.05, "<0.007")).toBe("FAIL");
  });
});

describe("recovery / correctedRecovery", () => {
  it("recovery = measured / true * 100", () => {
    expect(recovery(0.5, 0.5)).toBeCloseTo(100, 6);
    expect(recovery(0.45, 0.5)).toBeCloseTo(90, 6);
  });
  it("correctedRecovery subtracts the reference blank", () => {
    expect(correctedRecovery(0.106, 0.0, 0.1)).toBeCloseTo(106, 3);
    expect(correctedRecovery(0.11, 0.01, 0.1)).toBeCloseTo(100, 6);
  });
  it("null measured -> null", () => {
    expect(recovery(null, 0.5)).toBeNull();
  });
});

describe("rpd", () => {
  it("both below RL -> Both <RL note", () => {
    expect(rpd(0, 0)).toEqual({ value: null, note: "Both <RL" });
  });
  it("relative percent difference of a pair", () => {
    expect(rpd(10, 12).value).toBeCloseTo((2 / 11) * 100, 6);
  });
});

describe("classify", () => {
  it("PASS within range, FAIL outside", () => {
    expect(classify(100, [90, 110])).toBe("PASS");
    expect(classify(120, [90, 110])).toBe("FAIL");
    expect(classify(null, [90, 110])).toBe("n/a");
  });
});

describe("matrixBlankVerdict (failed-LRB acceptability, BATCH 106–107)", () => {
  it("acceptable when below 10% of the sample matrix (verbatim workbook label)", () => {
    const v = matrixBlankVerdict(0.05, 1.0, 0.01); // 0.05/1.0 = 5% < 10%
    expect(v.acceptable).toBe(true);
    expect(v.matrixVerdict).toBe("<10% Matrix");
  });
  it("acceptable when below 2.2× the reporting limit", () => {
    const v = matrixBlankVerdict(0.015, 0.05, 0.01); // 30% matrix (fails) but < 2.2×0.01 = 0.022
    expect(v.acceptable).toBe(true);
    expect(v.matrixVerdict).toBe(">10% Matrix");
    expect(v.rlVerdict).toBe("<2.2X RL");
  });
  it("not acceptable when over both thresholds", () => {
    const v = matrixBlankVerdict(0.5, 1.0, 0.01); // 50% matrix and > 0.022
    expect(v.acceptable).toBe(false);
    expect(v.matrixVerdict).toBe(">10% Matrix");
    expect(v.rlVerdict).toBe(">2.2X RL");
  });
});

describe("spikeBelowMatrix (LFM spike <30% of sample, BATCH 102)", () => {
  it("flags when the spike is a small fraction of the background", () => {
    expect(spikeBelowMatrix(0.1, 1.0)).toBe(true); // 0.1/1.0 = 10% < 30%
  });
  it("does not flag when the spike is a meaningful fraction", () => {
    expect(spikeBelowMatrix(0.1, 0.2)).toBe(false); // 50% ≥ 30%
  });
  it("does not flag when there is no measurable background", () => {
    expect(spikeBelowMatrix(0.1, 0)).toBe(false);
    expect(spikeBelowMatrix(0.1, null)).toBe(false);
  });
});

describe("roleKey", () => {
  it("maps BATCH role labels to canonical keys (DUPLICATE before SAMPLE)", () => {
    expect(roleKey("IPC Blank after Calibration (NALS Blank)")).toBe("ipcBlank");
    expect(roleKey("IPC CCV5 after Batch")).toBe("ccvBatch");
    expect(roleKey("Digest Method Blank (LRB)")).toBe("lrb");
    expect(roleKey("SAMPLE DUPLICATE, RPD Calculated")).toBe("duplicate");
    expect(roleKey("SAMPLE, RPD Calculated")).toBe("sample");
    expect(roleKey("Instrument ICV")).toBe("icv");
  });
});
