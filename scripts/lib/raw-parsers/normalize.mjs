// Shared normalisation helpers for matching raw instrument exports to the
// calculation workbook's columns and samples. Kept separate so every parser
// normalises identically.

// Unit suffixes the instruments append to analyte headers.
const UNIT_SUFFIX = /\s*(mg\/L|µg\/L|ug\/L|ppm|ppb|%)\s*$/i;

/**
 * Normalise an analyte header for matching, e.g.
 *   "Al 396.152 nm mg/L"  -> "al 396.152 nm"
 *   "Ba-A 455.403 nm"     -> "ba-a 455.403 nm"
 */
export function normalizeAnalyteLabel(label) {
  return String(label ?? "")
    .replace(UNIT_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Normalise a sample identifier for matching, e.g.
 *   "2026NALS02598 A06"  -> "2026nals02598 a06"
 * Dilution markers are NOT stripped here (callers decide); whitespace collapses.
 */
export function normalizeSampleId(id) {
  return String(id ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True if a solution label is a dilution re-run (e.g. "… Dil. 10X"). */
export function isDilution(label) {
  return /\bdil\.?\b/i.test(String(label ?? ""));
}

/** Extract the dilution factor from a label, or 1 if undiluted. "Dil. 100X" -> 100. */
export function dilutionFactor(label) {
  const m = String(label ?? "").match(/dil\.?\s*(\d+)\s*x/i);
  return m ? Number(m[1]) : 1;
}

/** The base sample id with any "Dil. NX" suffix removed. */
export function baseSampleId(label) {
  return String(label ?? "").replace(/\s*dil\.?\s*\d+\s*x\s*$/i, "").trim();
}

/** True if a raw value carries the over-range flag ("… o" or "####"). */
export function isOverRangeValue(value) {
  return typeof value === "string" && (/(?:^|\s)o(?:\s|$)/.test(value) || value.includes("####"));
}
