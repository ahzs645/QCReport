// Flexible sample matching — different instruments label the same client sample
// differently:
//   ICPOES / ICPQQQ : "2026NALS02598 A06"        (NALS # + autosampler position)
//   IC              : "2026NALS02604 Kitchen"     (NALS # + descriptive name)
// The roster (from the RESULTS workbook) has id "2026NALS02604 A10" + name "Kitchen".
//
// matchSample() tries, in order: exact id, NALS#+name, NALS#-only-if-unique.
// Returns { sample, confidence, reason } or null. Pure.

import { normalizeSampleId } from "./raw-parsers/normalize.mjs";

// How raw instrument rows are matched to workbook columns/samples (rendered in app).
export const MATCH_INFO = Object.freeze({
  analyte: 'by element + wavelength label with units stripped (e.g. "Al 396.152 nm")',
  sampleStrategies: [
    { reason: "exact_id", description: "exact NALS id, e.g. “2026NALS02598 A06” (ICPOES/ICPQQQ labels)" },
    { reason: "number_and_name", description: "NALS number + exact descriptive name (IC-style labels)" },
    { reason: "number_and_name_partial", description: "NALS number + partial name match" },
  ],
  dilution: '“Dil. 10X” / “Dil. 100X” → dilution factor 10 / 100',
});

const NALS_NUMBER = /(\d{4}\s*nals\s*\d+)/i;

/** "2026NALS02604" from any label/id (whitespace-normalised, lowercased). */
export function nalsNumber(label) {
  const m = normalizeSampleId(label).match(NALS_NUMBER);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/** The descriptive remainder after the NALS number, e.g. "kitchen", "a06", "dw-lc". */
function remainder(label) {
  const norm = normalizeSampleId(label);
  const num = nalsNumber(norm);
  if (!num) return norm;
  return norm.replace(NALS_NUMBER, "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} rawLabel - a raw instrument solution label
 * @param {Array<{name,id}>} roster - client samples
 * @returns {{ sample, confidence: "high"|"medium", reason } | null}
 */
export function matchSample(rawLabel, roster) {
  const rawId = normalizeSampleId(rawLabel);

  // 1. exact id (ICPOES/ICPQQQ position labels match the roster id directly)
  const exact = roster.find((s) => normalizeSampleId(s.id) === rawId);
  if (exact) return { sample: exact, confidence: "high", reason: "exact_id" };

  // 2. NALS number + descriptive name (IC labels)
  const num = nalsNumber(rawLabel);
  const rem = remainder(rawLabel);
  // NOTE: no "number-only" fallback. Matching on the NALS number alone is unsafe
  // — a run contains many rows with the same number (different autosampler
  // positions, QC, dilutions), so it would claim a client slot with the wrong
  // row. A descriptive-name match is required for the number-based strategies.
  if (num && rem) {
    const sameNumber = roster.filter((s) => nalsNumber(s.id) === num || nalsNumber(s.name) === num);
    const byName = sameNumber.find((s) => normalizeSampleId(s.name) === rem);
    if (byName) return { sample: byName, confidence: "high", reason: "number_and_name" };
    const byContains = sameNumber.find(
      (s) => normalizeSampleId(s.name).includes(rem) || rem.includes(normalizeSampleId(s.name)),
    );
    if (byContains) return { sample: byContains, confidence: "medium", reason: "number_and_name_partial" };
  }

  return null;
}
