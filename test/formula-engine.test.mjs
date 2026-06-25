import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  hardnessAsCaCO3,
  reportableValue,
  roundSignificant,
  valuesMatch,
} from "../scripts/lib/formula-engine.mjs";

const opts = (over = {}) => ({ detectionLimit: 0.007, belowLabel: "<0.007", ...over });

describe("reportableValue — the per-sample decision tree", () => {
  it("blank input -> NO DATA", () => {
    expect(reportableValue(null, opts())).toBe("NO DATA");
    expect(reportableValue(undefined, opts())).toBe("NO DATA");
    expect(reportableValue("", opts())).toBe("NO DATA");
  });

  it("value at/above the detection limit passes through unchanged", () => {
    expect(reportableValue(0.0146, opts())).toBe(0.0146);
    expect(reportableValue(0.007, opts())).toBe(0.007); // equal is not below
  });

  it("numeric value below the detection limit -> '<DL' label", () => {
    expect(reportableValue(0.001, opts())).toBe("<0.007");
    expect(reportableValue(-0.0007, opts())).toBe("<0.007"); // negatives are below
  });

  it("non-numeric text (e.g. instrument 'u' flag) -> '<DL' label", () => {
    expect(reportableValue("-0.0007 u", opts())).toBe("<0.007");
  });

  it("'Uncal' flag -> Uncal (only when the sheet checks it)", () => {
    expect(reportableValue("Uncal", opts())).toBe("Uncal");
    const noFlags = { ...DEFAULT_FLAGS, uncal: null };
    // ICPMS/ICPQQQ/IC sheets skip the Uncal check -> treated as non-numeric -> <DL
    expect(reportableValue("Uncal", opts({ flags: noFlags }))).toBe("<0.007");
  });

  it("'o' / '####' over-range flags -> over-range", () => {
    expect(reportableValue("0.5 o", opts())).toBe("over-range");
    expect(reportableValue("####", opts())).toBe("over-range");
  });

  it("text detection limit (e.g. 'n/a') forces the label (Excel: num < text = TRUE)", () => {
    expect(reportableValue(0.0131, opts({ detectionLimit: "n/a", belowLabel: "n/a" }))).toBe("n/a");
  });
});

describe("hardnessAsCaCO3", () => {
  it("matches the workbook coefficients (2.497*Ca + 4.118*Mg)", () => {
    expect(hardnessAsCaCO3(40.442, 12.8778)).toBeCloseTo(154.0144544, 4);
    expect(hardnessAsCaCO3(56.731, 8.6423)).toBeCloseTo(177.2462984, 4);
  });
  it("blanks coerce to 0 (Excel semantics)", () => {
    expect(hardnessAsCaCO3(null, null)).toBeNull();
    expect(hardnessAsCaCO3(10, null)).toBeCloseTo(24.97, 2);
  });
});

describe("roundSignificant", () => {
  it("rounds to 3 significant figures", () => {
    expect(roundSignificant(154.0144544)).toBe(154);
    expect(roundSignificant(22.744)).toBe(22.7);
    expect(roundSignificant(0.026912)).toBe(0.0269);
  });
});

describe("valuesMatch", () => {
  it("numeric within tolerance, strings exact", () => {
    expect(valuesMatch(0.1, 0.1 + 1e-9)).toBe(true);
    expect(valuesMatch("<0.007", "<0.007")).toBe(true);
    expect(valuesMatch("NO DATA", "NO DATA")).toBe(true);
    expect(valuesMatch(0.1, 0.2)).toBe(false);
  });
});
