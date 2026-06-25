// Ingest core — turn parsed raw instrument data into sample-dataset input cells,
// matching analytes (by a per-instrument key) and samples (flexible matcher) to
// the calculation workbook's layout. Pure given parsed data + spec model.
//
// Parser contract — each raw parser returns:
//   { analytes: [{ rawLabel, key, col }], rows: [{ label, isDilution, values: {key: value} }] }
// where `key` is produced by that instrument's analyteKey() (also applied to the
// RESULTS row-16 labels here so the two sides match).

import { numberToCol, toNumber } from "./sheet-utils.mjs";
import { baseSampleId, isOverRangeValue } from "./raw-parsers/normalize.mjs";
import { matchSample } from "./sample-match.mjs";

const SAMPLE_NAME_COL = numberToCol(1); // A
const SAMPLE_ID_COL = numberToCol(2); // B

/**
 * Generic per-instrument ingestion.
 *
 * @param {object} parsed - { analytes, rows } from a raw parser
 * @param {object} opts
 * @param {Array<{name,id,index,row}>} opts.samples - client roster
 * @param {Array<{inputCol,label}>} opts.analytes - spec.instrumentSheets[sheet].analytes
 * @param {number} opts.inputBandStart - first input row (e.g. 18)
 * @param {(label:string)=>string} opts.analyteKey - maps a RESULTS analyte label to a parser key
 * @param {string} opts.sheetName
 * @param {boolean} [opts.resolveDilutions=false]
 * @returns {{cells, warnings, matchedSamples, unmatchedSamples, overRangeResolved, overRangeFlagged}}
 */
export function ingestInstrument(parsed, opts) {
  const { samples, analytes, inputBandStart, analyteKey, sheetName, resolveDilutions = false } = opts;
  const cells = [];
  const warnings = [];

  // RESULTS analyte key -> input column.
  const keyToCol = new Map();
  for (const a of analytes) {
    const key = analyteKey(a.label);
    if (key && !keyToCol.has(key)) keyToCol.set(key, a.inputCol);
  }

  // Index undiluted raw rows by matched client sample id; collect dilution reruns.
  const rowBySampleId = new Map();
  const dilutionsBySampleId = new Map();
  for (const row of parsed.rows) {
    // Dilution reruns carry a "… Dil. 10X" suffix that breaks id matching — match
    // on the base id so they attach to the right sample.
    const matched = matchSample(row.isDilution ? baseSampleId(row.label) : row.label, samples);
    if (!matched) continue;
    const id = matched.sample.id;
    if (row.isDilution) {
      const list = dilutionsBySampleId.get(id) || [];
      list.push({ factor: row.dilutionFactor ?? 1, values: row.values });
      dilutionsBySampleId.set(id, list);
    } else if (!rowBySampleId.has(id)) {
      rowBySampleId.set(id, row);
    }
  }
  for (const list of dilutionsBySampleId.values()) list.sort((a, b) => a.factor - b.factor);

  let overRangeResolved = 0;
  let overRangeFlagged = 0;
  const resolveValue = (id, key, value) => {
    if (!isOverRangeValue(value)) return value;
    if (resolveDilutions) {
      // The diluted rerun's Conc value is already dilution-corrected by the
      // instrument, so use it directly (do NOT multiply by the factor again).
      for (const dil of dilutionsBySampleId.get(id) || []) {
        const dv = dil.values[key];
        const num = dv === undefined || isOverRangeValue(dv) ? null : toNumber(dv);
        if (num !== null) {
          overRangeResolved += 1;
          return num;
        }
      }
    }
    overRangeFlagged += 1;
    warnings.push({ kind: "over_range_needs_review", sheet: sheetName, sample: id, analyte: key, value });
    return value;
  };

  const analytesMissingInRaw = new Set();
  let matchedSamples = 0;
  const unmatchedSamples = [];

  for (const sample of samples) {
    const row = sample.row ?? inputBandStart + sample.index;
    cells.push({ sheet: sheetName, ref: `${SAMPLE_NAME_COL}${row}`, value: sample.name });
    cells.push({ sheet: sheetName, ref: `${SAMPLE_ID_COL}${row}`, value: sample.id });

    const raw = rowBySampleId.get(sample.id);
    if (!raw) {
      unmatchedSamples.push({ name: sample.name, id: sample.id });
      warnings.push({ kind: "sample_not_found_in_raw", sheet: sheetName, sample: sample.name, id: sample.id });
      continue;
    }
    matchedSamples += 1;

    for (const [key, inputCol] of keyToCol) {
      const value = raw.values[key];
      if (value === undefined) {
        analytesMissingInRaw.add(key);
        continue;
      }
      cells.push({ sheet: sheetName, ref: `${inputCol}${row}`, value: resolveValue(sample.id, key, value) });
    }
  }

  for (const key of analytesMissingInRaw) {
    warnings.push({ kind: "analyte_missing_in_raw", sheet: sheetName, analyte: key });
  }

  return { cells, warnings, matchedSamples, unmatchedSamples, overRangeResolved, overRangeFlagged };
}

// ---- Per-instrument wrappers (each fixes the analyteKey for its layout) -------

import { analyteKey as icpoesKey } from "./raw-parsers/icpoes-conc.mjs";
import { analyteKey as icKey } from "./raw-parsers/ic-cdet.mjs";

export function ingestIcpoes(parsed, opts) {
  return ingestInstrument(parsed, { ...opts, analyteKey: icpoesKey, sheetName: opts.sheetName ?? "ICPOES RESULTS" });
}

export function ingestIc(parsed, opts) {
  return ingestInstrument(parsed, { ...opts, analyteKey: icKey, sheetName: opts.sheetName ?? "IC RESULTS" });
}
