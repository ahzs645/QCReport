// Parser for the raw Agilent ICP Expert worksheet export (.esws) — the native
// instrument file the analyst would otherwise have to "Export to Excel" to get
// the "Conc" / "Raw Data" sheet handled by icpoes-conc.mjs. Reading the .esws
// directly removes that manual export step.
//
// Container: a ZIP (Open Packaging Convention) whose parts are .NET
// BinaryFormatter ([MS-NRBF]) serialized object graphs — NOT text/XML. See
// nrbf.mjs for the reader and docs/esws-format.md for the format map.
//
// We use three groups of parts:
//   Method/NewElementWavelengths            → the analyte columns:
//        NewElementWavelengthDataType { Id, ElementSymbol, Wavelength.value,
//        ConcentrationUnit, CalibrationRange.Maximum }
//   Method/*SolutionDefinitions             → the run sequence, keyed by GUID:
//        SolutionDefinitionDataType { Key, Name, Dilution, Rack, Tube }
//   ResultsNew/WithoutRecalc/Solutions/*    → one part per measured solution:
//        NewSolutionData { SolutionDefinitionKey, Measurements[] }
//        NewMeasurementDataType { ElementWavelengthId, ConcentrationCalculator.average }
//
// Joins: Solution.SolutionDefinitionKey → definition.Name (the Solution Label),
// Measurement.ElementWavelengthId → analyte.Id.
//
// Verified against the sibling .xlsx export (free ground truth — every .esws is
// saved next to its .xlsx): ConcentrationCalculator.average == the "Raw Data"
// (adjusted) value to full precision (5150/5150 cells); unadjusted == adjusted /
// Dilution; the over-range "o" flag == (unadjusted > CalibrationRange.Maximum)
// (61/61 cells). The output matches icpoes-conc.mjs so this can later feed the
// same ingest path as an alternative ICPOES source.

import JSZip from "jszip";
import { numberToCol } from "../sheet-utils.mjs";
import { parseNrbf } from "./nrbf.mjs";
import { dilutionFactor, isDilution, normalizeAnalyteLabel } from "./normalize.mjs";

export const analyteKey = normalizeAnalyteLabel;

const SOLUTION_DIR = "ResultsNew/WithoutRecalc/Solutions/";
const ELEMENT_WAVELENGTHS = "Method/NewElementWavelengths";
// All solution-definition parts share the SolutionDefinitionDataType shape.
const DEFINITION_PARTS = [
  "Method/SampleSolutionDefinitions",
  "Method/StandardSolutionDefinitions",
  "Method/QCSolutionDefinitions",
  "Method/IECStandardSolutionDefinitions",
];

const endsWith = (obj, suffix) => obj && obj.__class && obj.__class.endsWith(suffix);
const member = (obj, name) => (obj && obj.members ? obj.members[name] : undefined);
/** Wavelength labels carry 3 decimals in the export ("Ag 328.068 nm"). */
const fmtWavelength = (n) => Number(n).toFixed(3);

/** Read a ZIP part as a parsed NRBF object graph, or null if the part is absent. */
async function readPart(zip, name) {
  const file = zip.file(name);
  if (!file) return null;
  return parseNrbf(await file.async("uint8array"));
}

/** True if a loaded JSZip looks like an ICP Expert .esws worksheet. */
export function isEswsZip(zip) {
  return Boolean(zip.file(ELEMENT_WAVELENGTHS) && zip.file("Summary"));
}

/** Cheap signature check on raw bytes: a ZIP ("PK\x03\x04") — caller confirms parts. */
export function looksLikeZip(u8) {
  return u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;
}

/**
 * Parse a raw ICP Expert .esws export.
 * @param {ArrayBuffer|Uint8Array} data
 * @param {object} [opts]
 * @param {"adjusted"|"unadjusted"} [opts.kind="adjusted"] which concentration to emit
 * @returns {Promise<{ sheet, analytes, rows }>} same contract as icpoes-conc.mjs
 */
export async function parseIcpoesEsws(data, opts = {}) {
  const zip = await JSZip.loadAsync(data);
  if (!isEswsZip(zip)) throw new Error("Not an ICP Expert .esws worksheet (missing Method/NewElementWavelengths)");
  return parseIcpoesEswsZip(zip, opts);
}

/**
 * Parse an already-loaded JSZip (lets a caller reuse the unzip / detect first).
 * @param {JSZip} zip
 * @param {object} [opts] - { kind }
 * @returns {Promise<{ sheet, analytes, rows }>}
 */
export async function parseIcpoesEswsZip(zip, opts = {}) {
  return buildContract(await extractEsws(zip), opts.kind || "adjusted");
}

/**
 * Single-pass extraction of the measured run. The expensive NRBF parsing happens
 * once here; callers derive the adjusted/unadjusted views (buildContract) cheaply
 * and exploration views read the richer fields directly.
 *
 * @param {JSZip} zip
 * @returns {Promise<{ analytes, runs }>} where each run carries, per analyte key,
 *   { adjusted, unadjusted, intensity, rsd, over } plus solution metadata.
 */
export async function extractEsws(zip) {
  // 1) Analyte columns, keyed by ElementWavelength Id.
  const ewGraph = await readPart(zip, ELEMENT_WAVELENGTHS);
  if (!ewGraph) throw new Error("Missing Method/NewElementWavelengths in .esws");
  const analyteById = new Map();
  const analytes = [];
  for (const obj of ewGraph.objects.values()) {
    if (!endsWith(obj, "NewElementWavelengthDataType")) continue;
    const wavelength = member(member(obj, "Wavelength"), "value");
    if (wavelength == null) continue;
    const symbol = member(obj, "ElementSymbol");
    // ICP Expert disambiguates plasma views with a Label suffix ("Ba-A", "Sr-R",
    // "Cu-A"); the .xlsx column headers use this Label, not the bare element symbol.
    const label = member(obj, "Label") ?? symbol;
    const rawLabel = `${label} ${fmtWavelength(wavelength)} nm`;
    const calMax = member(member(obj, "CalibrationRange"), "Maximum");
    const entry = { id: member(obj, "Id"), element: String(symbol), wavelength, rawLabel, key: normalizeAnalyteLabel(rawLabel), calMax };
    analyteById.set(entry.id, entry);
    analytes.push(entry);
  }
  // Stable, deterministic column order: element symbol then wavelength.
  analytes.sort((a, b) => a.rawLabel.localeCompare(b.rawLabel, "en", { numeric: true }));
  analytes.forEach((a, i) => { a.col = numberToCol(4 + i); });

  // 2) Solution definitions, keyed by GUID Key → { name, dilution, weight, volume, solType }.
  const defByKey = new Map();
  for (const part of DEFINITION_PARTS) {
    const graph = await readPart(zip, part);
    if (!graph) continue;
    for (const obj of graph.objects.values()) {
      if (!endsWith(obj, "SolutionDefinitionDataType")) continue;
      const key = member(obj, "Key");
      if (key == null) continue;
      defByKey.set(key, {
        name: member(obj, "Name"),
        dilution: member(obj, "Dilution") || 1,
        weight: member(obj, "Weight"),
        volume: member(obj, "Volume"),
        solType: member(member(obj, "SolType"), "value__"),
      });
    }
  }

  // 3) One run per measured solution. ICP Expert numbers parts Solution0..N in
  //    sequence order; sort numerically so runs mirror the run order.
  const solutionNames = Object.keys(zip.files)
    .filter((n) => n.startsWith(SOLUTION_DIR) && !zip.files[n].dir && /Solution\d+$/.test(n))
    .sort((a, b) => solutionIndex(a) - solutionIndex(b));

  const runs = [];
  let rowNum = 1;
  for (const name of solutionNames) {
    const graph = await readPart(zip, name);
    const sol = graph.get(graph.root);
    if (!endsWith(sol, "NewSolutionData")) continue;
    const def = defByKey.get(member(sol, "SolutionDefinitionKey"));
    const label = def && def.name != null ? String(def.name) : "";
    if (label.trim() === "") continue;
    const dilution = def ? def.dilution || 1 : 1;
    // The reported (adjusted) concentration = unadjusted reading × Dilution ×
    // (Volume/Weight) for digestions. Weight=Volume=1 for direct water samples.
    const wv = def && def.weight > 0 && def.volume > 0 ? def.volume / def.weight : 1;
    const adjustFactor = dilution * wv;

    const measurements = {};
    for (const m of member(sol, "Measurements") || []) {
      if (!m || !m.members) continue;
      const analyte = analyteById.get(member(m, "ElementWavelengthId"));
      if (!analyte) continue;
      const conc = member(m, "ConcentrationCalculator");
      const adjusted = member(conc, "average");
      if (adjusted == null) {
        // Measured but no concentration → uncalibrated line (internal standards
        // like Sc/Y/Bi/Li). ICP Expert / the .xlsx show "Uncal"; the RESULTS
        // sheet treats that specially. Unmeasured analytes get no cell (NO DATA).
        if (member(m, "HasBeenMeasured")) measurements[analyte.key] = { uncal: true };
        continue;
      }
      const unadjusted = adjusted / adjustFactor;
      measurements[analyte.key] = {
        adjusted,
        unadjusted,
        intensity: member(member(m, "IntensityCalculator"), "average"),
        rsd: member(conc, "rsd"),
        // Over-range: the unadjusted reading exceeded the top calibration standard.
        over: analyte.calMax != null && unadjusted > analyte.calMax,
      };
    }

    rowNum += 1;
    runs.push({
      row: rowNum,
      label: label.trim(),
      isDilution: isDilution(label),
      dilutionFactor: dilutionFactor(label) || dilution,
      dilution,
      weight: def ? def.weight : null,
      volume: def ? def.volume : null,
      solType: def ? def.solType : null,
      measurements,
    });
  }

  return { analytes, runs };
}

/**
 * Build the icpoes-conc-compatible { sheet, analytes, rows } view from an extract.
 * Over-range cells are encoded like the .xlsx ("123.4 o") so isOverRangeValue() /
 * ingest treat them identically.
 */
export function buildContract(extract, kind = "adjusted") {
  const rows = extract.runs.map((r) => {
    const values = {};
    for (const [key, m] of Object.entries(r.measurements)) {
      if (m.uncal) { values[key] = "Uncal"; continue; }
      const value = kind === "unadjusted" ? m.unadjusted : m.adjusted;
      values[key] = m.over ? `${value} o` : value;
    }
    return { row: r.row, label: r.label, isDilution: r.isDilution, dilutionFactor: r.dilutionFactor, values };
  });
  return { sheet: kind === "unadjusted" ? "Unadjusted Conc" : "Raw Data", analytes: extract.analytes, rows };
}

function solutionIndex(name) {
  const m = name.match(/Solution(\d+)$/);
  return m ? Number(m[1]) : 0;
}
