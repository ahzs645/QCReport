import { describe, it, expect } from "vitest";
import { ingestInstrument } from "../scripts/lib/ingest.mjs";

/**
 * Spec analytes as buildSpec derives them: an input column, a label and the undiluted
 * reportable limit from workbook row 63. Mercury's limit is 7 ug/L, calcium's 0.004 mg/L —
 * the real values, because the gap between them is the point.
 */
const ANALYTES = [
  { inputCol: "P", label: "Ca 317.933 nm", detectionLimit: 0.004 },
  { inputCol: "AO", label: "Hg 184.887 nm", detectionLimit: 7 },
];

const SAMPLES = [{ name: "Well", id: "2025NALS02582 A06", index: 0, row: 18 }];

/** A parsed raw run: the straight read plus whatever dilution reruns the tray carried. */
function parsed(straight, dilutions = []) {
  return {
    analytes: ANALYTES.map((a) => ({ rawLabel: a.label, key: a.label.toLowerCase(), col: a.inputCol })),
    rows: [
      { label: "2025NALS02582 A06", isDilution: false, values: straight },
      ...dilutions.map(({ factor, values }) => ({
        label: `2025NALS02582 A06 - Dil. ${factor}X`,
        isDilution: true,
        dilutionFactor: factor,
        values,
      })),
    ],
  };
}

function run(input, options = {}) {
  return ingestInstrument(input, {
    samples: SAMPLES,
    analytes: ANALYTES,
    inputBandStart: 18,
    analyteKey: (label) => label.toLowerCase(),
    sheetName: "ICPOES RESULTS",
    ...options,
  });
}

/** The value written into one analyte's input cell. */
function cellFor(result, col) {
  return result.cells.find((cell) => cell.ref === `${col}18`)?.value;
}

describe("over-range values in the RESULTS ingest", () => {
  it("answers an over-range straight run with its dilution", () => {
    const result = run(
      parsed({ "ca 317.933 nm": "120.5 o", "hg 184.887 nm": "1.6" }, [{ factor: 10, values: { "ca 317.933 nm": "118.2", "hg 184.887 nm": "20.8" } }]),
    );
    // The dilution's Conc is already dilution-corrected, so it is used as-is.
    expect(cellFor(result, "P")).toBe(118.2);
    expect(result.overRangeResolved).toBe(1);
    expect(result.overRangeFlagged).toBe(0);
    expect(result.overRangeResolutions).toEqual([
      { sheet: "ICPOES RESULTS", sample: "2025NALS02582 A06", analyte: "ca 317.933 nm", factor: 10, value: 118.2 },
    ]);
  });

  it("refuses a dilution reading that falls under the limit at that dilution", () => {
    // Mercury really behaves like this: the straight run reads 1.6 ug/L against a 7 ug/L
    // limit, so at 100x the instrument is scaling up noise and reports 229. Taking the
    // first non-over-range dilution would have written that into the report.
    const result = run(
      parsed({ "ca 317.933 nm": "0.5", "hg 184.887 nm": "9999 o" }, [{ factor: 100, values: { "hg 184.887 nm": "229.1" } }]),
    );
    expect(cellFor(result, "AO")).toBe("9999 o");
    expect(result.overRangeResolved).toBe(0);
    expect(result.overRangeFlagged).toBe(1);
    expect(result.warnings.map((w) => w.kind)).toContain("over_range_needs_review");
  });

  it("accepts a dilution reading that clears the scaled limit", () => {
    // 800 ug/L at 100x is above 7 x 100, so the analyte is genuinely measurable there.
    const result = run(parsed({ "hg 184.887 nm": "9999 o" }, [{ factor: 100, values: { "hg 184.887 nm": "800" } }]));
    expect(cellFor(result, "AO")).toBe(800);
    expect(result.overRangeResolved).toBe(1);
  });

  it("prefers the least-diluted rerun that clears its limit", () => {
    const result = run(
      parsed({ "ca 317.933 nm": "500 o" }, [
        { factor: 100, values: { "ca 317.933 nm": "505" } },
        { factor: 10, values: { "ca 317.933 nm": "498" } },
      ]),
    );
    expect(cellFor(result, "P")).toBe(498);
    expect(result.overRangeResolutions[0].factor).toBe(10);
  });

  it("flags an over-range value with no dilution to fall back on", () => {
    const result = run(parsed({ "ca 317.933 nm": "500 o" }));
    expect(cellFor(result, "P")).toBe("500 o");
    expect(result.overRangeFlagged).toBe(1);
  });

  it("leaves in-range values untouched", () => {
    const result = run(parsed({ "ca 317.933 nm": "33.5", "hg 184.887 nm": "1.6" }));
    expect(cellFor(result, "P")).toBe("33.5");
    expect(result.overRangeResolved).toBe(0);
    expect(result.overRangeFlagged).toBe(0);
  });

  it("can be told not to substitute at all", () => {
    const result = run(
      parsed({ "ca 317.933 nm": "120.5 o" }, [{ factor: 10, values: { "ca 317.933 nm": "118.2" } }]),
      { resolveDilutions: false },
    );
    expect(cellFor(result, "P")).toBe("120.5 o");
    expect(result.overRangeFlagged).toBe(1);
  });

  it("substitutes by default, without being asked", () => {
    // The browser path never passed the option, so every over-range value reached the
    // workbook as "over-range" even when the tray held the answer.
    const result = run(parsed({ "ca 317.933 nm": "120.5 o" }, [{ factor: 10, values: { "ca 317.933 nm": "118.2" } }]));
    expect(result.overRangeResolved).toBe(1);
  });
});
