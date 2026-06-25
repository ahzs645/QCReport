// Pure re-implementation of the RESULTS workbook's calculation logic.
//
// This mirrors, in JavaScript, what the Excel formulas do — so we can compute
// reportable values from raw inputs WITHOUT Excel, and cross-check against the
// workbook's own cached results (valuesMatch).
//
// No I/O, no spreadsheet objects — primitives in, primitives out. Unit-tested
// in test/formula-engine.test.mjs.
//
// The canonical per-sample/per-analyte reportable formula (e.g. ICPOES C70) is:
//
//   =IF(ISBLANK(in),"NO DATA",
//     IF(ISNUMBER(FIND("Uncal",in)),"Uncal",
//     IF(OR(ISNUMBER(FIND("o",in)),ISNUMBER(FIND("####",in))),"over-range",
//     IF(OR(in<DL, ISNUMBER(in)=FALSE), belowLabel, in))))
//
// where DL = detection-limit threshold (row 63) and belowLabel = "<DL" string (row 64).

import { toNumber } from "./sheet-utils.mjs";

// Flag codes live on the CODES sheet (A10..A13); defaults match REV14.
export const DEFAULT_FLAGS = Object.freeze({
  uncal: "Uncal", // CODES!A12
  uncalLabel: "Uncal",
  over: ["o", "####"], // CODES!A10, A11
  overLabel: "over-range", // CODES!A13
  noData: "NO DATA",
});

// Excel FIND(): case-sensitive substring search.
function find(haystack, needle) {
  return String(haystack).includes(needle);
}

/**
 * Replicate Excel's `<` comparison semantics for `num < threshold`:
 *  - threshold numeric  -> normal numeric comparison
 *  - threshold is text  -> Excel sorts any number BEFORE text, so this is TRUE
 *    (this is how a "n/a" detection-limit cell forces the "<DL"/"n/a" label)
 *  - threshold blank    -> Excel coerces blank to 0
 */
function excelLessThan(num, threshold) {
  if (typeof threshold === "number") return num < threshold;
  if (typeof threshold === "string" && threshold.trim() !== "") return true;
  return num < 0;
}

/**
 * Compute one reportable value from a raw input cell.
 *
 * @param {string|number|null|undefined} input - raw pasted instrument value
 * @param {object} opts
 * @param {number|string|null} opts.detectionLimit - raw threshold cell (row 63);
 *        may be numeric, or text like "n/a" (see excelLessThan)
 * @param {string} opts.belowLabel - "<DL" display string (workbook row 64)
 * @param {object} [opts.flags] - override DEFAULT_FLAGS
 * @returns {string|number} reportable value: a number, or one of
 *          "NO DATA" | "Uncal" | "over-range" | belowLabel
 */
export function reportableValue(input, { detectionLimit, belowLabel, flags = DEFAULT_FLAGS } = {}) {
  // ISBLANK — truly empty only.
  if (input === null || input === undefined || input === "") return flags.noData;

  const text = String(input);
  // Some sheets (ICPMS/ICPQQQ/IC) omit the flag checks — only apply when enabled.
  if (flags.uncal && find(text, flags.uncal)) return flags.uncalLabel;
  if (flags.over?.length && flags.over.some((code) => find(text, code))) return flags.overLabel;

  const num = toNumber(input);
  // OR(in < DL, NOT ISNUMBER(in)) -> belowLabel
  if (num === null) return belowLabel;
  if (excelLessThan(num, detectionLimit)) return belowLabel;
  return num;
}

/**
 * Hardness as CaCO3 (mg/L) from calcium and magnesium (mg/L).
 * Verified against the workbook: 2.497*Ca + 4.118*Mg.
 * Returns null if neither input is numeric.
 */
export function hardnessAsCaCO3(calciumMgL, magnesiumMgL) {
  const ca = toNumber(calciumMgL);
  const mg = toNumber(magnesiumMgL);
  if (ca === null && mg === null) return null;
  return 2.497 * (ca ?? 0) + 4.118 * (mg ?? 0);
}

/**
 * Round a number to `sig` significant figures. Non-numbers pass through.
 * Used by the report formatter to approximate the analyst's manual rounding.
 */
export function roundSignificant(value, sig = 3) {
  const n = toNumber(value);
  if (n === null || n === 0) return n === 0 ? 0 : value;
  const digits = sig - Math.floor(Math.log10(Math.abs(n))) - 1;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/**
 * Round to a fixed number of decimal places. Non-numbers pass through.
 */
export function roundDecimals(value, decimals = 1) {
  const n = toNumber(value);
  if (n === null) return value;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * Compare a code-computed reportable value with the workbook's cached value.
 * Numeric values compared within a tolerance; strings compared exactly.
 */
export function valuesMatch(computed, cached, tolerance = 1e-6) {
  const cn = toNumber(computed);
  const wn = toNumber(cached);
  if (cn !== null && wn !== null) return Math.abs(cn - wn) <= tolerance;
  return String(computed).trim() === String(cached ?? "").trim();
}
