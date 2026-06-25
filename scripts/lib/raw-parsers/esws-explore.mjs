// Exploration extractors for the richer ICP Expert .esws data, beyond the
// concentration table that icpoes-esws.mjs produces. All browser-portable; each
// reads only the parts it needs from an already-loaded JSZip.
//
//   extractCalibration — per-analyte calibration curve (intensity vs conc) from
//                        the standard solutions + Method/DefinedConAndMulticalRestrict_1.
//   extractQc          — QC solutions (CCV / blank / spike) with pass/fail and
//                        per-analyte recovery, in run order (for drift).
//   extractSolutionDetail — per-analyte replicates for one solution (drill-down).
//   extractRunInfo     — worksheet metadata from Summary.
//   extractSpectra     — emission spectra (intensity vs wavelength) from
//                        Results/Spectrum/*, labelled by nearest analyte line.

import { parseNrbf } from "./nrbf.mjs";
import { readAnalytes, readDefinitions, readPart, solutionPartNames } from "./icpoes-esws.mjs";

const endsWith = (o, s) => o && o.__class && o.__class.endsWith(s);
const member = (o, n) => (o && o.members ? o.members[n] : undefined);
const root = (g) => g.get(g.root);

// ── Calibration ────────────────────────────────────────────────────────────

/** Ordinary least-squares line fit + R² for {x,y} points. */
function linFit(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const d = n * sxx - sx * sx;
  if (d === 0) return null;
  const slope = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  const my = sy / n;
  let ssRes = 0, ssTot = 0;
  for (const p of pts) { const f = slope * p.x + intercept; ssRes += (p.y - f) ** 2; ssTot += (p.y - my) ** 2; }
  return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

/**
 * Per-analyte calibration curves: concentration (from the defined standard
 * concentrations) vs measured intensity (from the standard solution runs).
 * @returns {Promise<Array<{ key, rawLabel, element, points:[{conc,intensity,standard}], fit }>>}
 */
export async function extractCalibration(zip) {
  const { analyteById } = await readAnalytes(zip);

  // Element order (Method/Standards) → index used by the defined-conc table.
  const stdGraph = await readPart(zip, "Method/Standards");
  const elByIdx = [];
  if (stdGraph) for (const el of root(stdGraph)) if (member(el, "ElementName") != null) elByIdx.push(member(el, "ElementName"));
  const elIndex = new Map(elByIdx.map((name, i) => [name, i]));

  // Standard solutions in order: GUID Key → { idx, name }.
  const ssGraph = await readPart(zip, "Method/StandardSolutionDefinitions");
  const stdByKey = new Map();
  const stdNames = [];
  if (ssGraph) root(ssGraph).forEach((o, i) => { stdByKey.set(member(o, "Key"), { idx: i, name: member(o, "Name") }); stdNames[i] = member(o, "Name"); });

  // Defined concentration per (standardIndex, elementIndex).
  const dcGraph = await readPart(zip, "Method/DefinedConAndMulticalRestrict_1");
  const defConc = new Map();
  if (dcGraph) for (const o of dcGraph.objects.values()) {
    if (!endsWith(o, "StandardSolutionXElementData2DefinedConc")) continue;
    defConc.set(`${member(o, "StandardIndex")}|${member(o, "ElementDataIndex")}`, member(o, "DefinedConc"));
  }

  // Measured intensity per (standardIndex, analyteId), from the standard runs.
  const byAnalyte = new Map(); // analyteId → [{conc, intensity, standard}]
  for (const name of solutionPartNames(zip)) {
    const sol = root(await readPart(zip, name));
    if (!endsWith(sol, "NewSolutionData")) continue;
    const std = stdByKey.get(member(sol, "SolutionDefinitionKey"));
    if (!std) continue; // not a calibration standard
    for (const m of member(sol, "Measurements") || []) {
      if (!m || !m.members) continue;
      const a = analyteById.get(member(m, "ElementWavelengthId"));
      if (!a) continue;
      const conc = defConc.get(`${std.idx}|${elIndex.get(a.element)}`);
      const intensity = member(member(m, "IntensityCalculator"), "average");
      if (conc == null || intensity == null) continue;
      if (!byAnalyte.has(a.id)) byAnalyte.set(a.id, []);
      byAnalyte.get(a.id).push({ conc, intensity, standard: std.name });
    }
  }

  const out = [];
  for (const [id, points] of byAnalyte) {
    const a = analyteById.get(id);
    points.sort((p, q) => p.conc - q.conc);
    out.push({ key: a.key, rawLabel: a.rawLabel, element: a.element, points, fit: linFit(points.map((p) => ({ x: p.conc, y: p.intensity }))) });
  }
  out.sort((a, b) => a.rawLabel.localeCompare(b.rawLabel, "en", { numeric: true }));
  return out;
}

// ── QC ────────────────────────────────────────────────────────────────────

// SolutionType enum values observed: 1 Rinse, 2 Standard/Blank, 6 CCV/QC.
const QC_NAME = /\b(ccv|icv|ccb|icb|ipc|qc|spike|lfb|lcs|check|recovery)\b/i;
/** Expected concentration encoded in a QC label, in mg/L ("CCV 500ppb" → 0.5). */
function expectedFromName(name) {
  const ppb = String(name).match(/(\d+(?:\.\d+)?)\s*ppb/i);
  if (ppb) return Number(ppb[1]) / 1000;
  const ppm = String(name).match(/(\d+(?:\.\d+)?)\s*(ppm|mg\/l)/i);
  if (ppm) return Number(ppm[1]);
  return null;
}

/**
 * QC solutions in run order with pass/fail and per-analyte measured value +
 * recovery (where an expected concentration can be inferred from the label).
 * @returns {Promise<{ analytes, rows }>}
 */
export async function extractQc(zip, { reportableKeys } = {}) {
  const { analytes, analyteById } = await readAnalytes(zip);
  const defByKey = await readDefinitions(zip);
  const keep = reportableKeys ? new Set(reportableKeys) : null;

  const rows = [];
  let seq = 0;
  for (const name of solutionPartNames(zip)) {
    const sol = root(await readPart(zip, name));
    if (!endsWith(sol, "NewSolutionData")) continue;
    seq += 1;
    const def = defByKey.get(member(sol, "SolutionDefinitionKey"));
    const label = def && def.name != null ? String(def.name).trim() : "";
    const solType = member(member(sol, "Solutiontype"), "value__");
    const isQc = QC_NAME.test(label) || solType === 6;
    if (!isQc || label === "") continue;
    const expected = expectedFromName(label);
    const values = {};
    for (const m of member(sol, "Measurements") || []) {
      if (!m || !m.members) continue;
      const a = analyteById.get(member(m, "ElementWavelengthId"));
      if (!a || (keep && !keep.has(a.key))) continue;
      const conc = member(member(m, "ConcentrationCalculator"), "average");
      if (conc == null) continue;
      values[a.key] = { conc, recovery: expected ? (conc / expected) * 100 : null };
    }
    rows.push({ seq, label, solType, qcPassed: member(sol, "IsQCPassed"), expected, values });
  }
  return { analytes: keep ? analytes.filter((a) => keep.has(a.key)) : analytes, rows };
}

// ── Per-solution drill-down (replicates) ────────────────────────────────────

/**
 * Replicate-level detail for a single solution part (on demand).
 * @param {string} partName  e.g. "ResultsNew/WithoutRecalc/Solutions/Solution12"
 */
export async function extractSolutionDetail(zip, partName) {
  const { analyteById } = await readAnalytes(zip);
  const defByKey = await readDefinitions(zip);
  const sol = root(await readPart(zip, partName));
  if (!endsWith(sol, "NewSolutionData")) return null;
  const def = defByKey.get(member(sol, "SolutionDefinitionKey"));
  const analytes = [];
  for (const m of member(sol, "Measurements") || []) {
    if (!m || !m.members) continue;
    const a = analyteById.get(member(m, "ElementWavelengthId"));
    if (!a) continue;
    const conc = member(m, "ConcentrationCalculator");
    const replicates = (member(m, "Replicates") || []).map((r) => ({
      conc: member(r, "Concentration"),
      intensity: member(r, "Intensity"),
      background: member(r, "BackgroundIntensity"),
      drift: member(r, "WavelengthDrift"),
      included: member(r, "IsIncluded"),
    }));
    analytes.push({
      key: a.key, rawLabel: a.rawLabel,
      conc: member(conc, "average"), rsd: member(conc, "rsd"), sd: member(conc, "sd"),
      intensity: member(member(m, "IntensityCalculator"), "average"),
      replicates,
    });
  }
  analytes.sort((a, b) => a.rawLabel.localeCompare(b.rawLabel, "en", { numeric: true }));
  // SolutionKey links to this solution's emission spectra at Results/Spectrum/<key>.
  const solutionKey = member(sol, "SolutionKey");
  return { label: def ? String(def.name) : "", solutionKey, hasSpectra: Boolean(solutionKey && zip.file(`Results/Spectrum/${solutionKey}`)), analytes };
}

// ── Run info ────────────────────────────────────────────────────────────────

export async function extractRunInfo(zip) {
  const sumGraph = await readPart(zip, "Summary");
  const s = sumGraph ? root(sumGraph) : null;
  const bf = (n) => member(s, `<${n}>k__BackingField`);
  const ver = (v) => (v && v.members ? `${member(v, "_Major")}.${member(v, "_Minor")}.${member(v, "_Build")}` : null);
  return {
    instrumentSerial: bf("LastRunOnInstrumentSerial"),
    softwareVersion: ver(bf("LastRunOnSoftwareVersion")),
    firmwareVersion: ver(bf("LastRunOnFirmwareVersion")),
    worksheetVersion: ver(bf("WorksheetVersion")),
    qcEnabled: bf("QCEnabled"),
    owner: bf("Owner"),
    notes: bf("Notes"),
    solutionCount: solutionPartNames(zip).length,
    spectrumCount: Object.keys(zip.files).filter((n) => /^Results\/Spectrum\//.test(n)).length,
  };
}

// ── Emission spectra ─────────────────────────────────────────────────────────

/**
 * Emission spectra for ONE solution. Results/Spectrum/<SolutionKey> holds many
 * SpectrumDataType — one intensity-vs-wavelength window per analyte line. Each is
 * labelled by the nearest analyte line. (Pass a solutionKey from extractSolutionDetail.)
 * @returns {Promise<Array<{ wavelengths, counts, center, peak, nearest, key }>>}
 */
export async function extractSpectra(zip, solutionKey) {
  if (!solutionKey) return [];
  const g = await readPart(zip, `Results/Spectrum/${solutionKey}`);
  if (!g) return [];
  const { analytes } = await readAnalytes(zip);
  const nearestLine = (wl) => {
    let best = null, bestD = Infinity;
    for (const a of analytes) { const d = Math.abs(a.wavelength - wl); if (d < bestD) { bestD = d; best = a; } }
    return bestD <= 0.3 ? best : null;
  };
  const byLine = new Map(); // one spectrum per analyte line (first wins)
  for (const o of g.objects.values()) {
    if (!endsWith(o, "SpectrumDataType")) continue;
    const wavelengths = member(o, "wavelengths");
    const counts = member(o, "pixelsInCountsPerSec");
    if (!Array.isArray(wavelengths) || !Array.isArray(counts) || !wavelengths.length) continue;
    const center = wavelengths[Math.floor(wavelengths.length / 2)];
    const near = nearestLine(center);
    const key = near ? near.key : `@${center.toFixed(3)}`;
    if (byLine.has(key)) continue;
    byLine.set(key, { wavelengths, counts, center, peak: Math.max(...counts), nearest: near ? near.rawLabel : null, key });
  }
  return [...byLine.values()].sort((a, b) => a.center - b.center);
}
