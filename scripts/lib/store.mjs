// Modular on-disk storage: an index.json that references per-sheet / per-instrument
// part files, instead of one monolithic blob. Centralised here so every generator
// reads/writes the same shape. Readers reassemble the parts into the in-memory
// objects the rest of the code already uses, so internal logic is unchanged.
//
// Layouts:
//   spec/      index.json + instruments/<sheet>.json + reports/<sheet>.json
//   dataset/   index.json + cells/<sheet>.json + dropdowns.json
//
// Back-compat: readDataset()/readSpec() also accept a single flat .json file.

import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJson } from "./dataset.mjs";

/** Filesystem-safe slug for a sheet name, e.g. "ICPOES RESULTS" -> "icpoes-results". */
export function slug(name) {
  return String(name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// ---- Spec (from buildSpec) -------------------------------------------------

/** Write a spec as index + per-sheet parts under <dir>. Returns the index path. */
export function writeSpec(dir, spec) {
  ensureDir(dir);
  const parts = { instruments: {}, reports: {} };
  for (const [name, model] of Object.entries(spec.instrumentSheets || {})) {
    const rel = path.join("instruments", `${slug(name)}.json`);
    writeJson(path.join(dir, rel), model);
    parts.instruments[name] = rel;
  }
  for (const [name, report] of Object.entries(spec.reportSheets || {})) {
    const rel = path.join("reports", `${slug(name)}.json`);
    writeJson(path.join(dir, rel), report);
    parts.reports[name] = rel;
  }
  const indexPath = path.join(dir, "index.json");
  writeJson(indexPath, {
    version: spec.version,
    generatedFrom: spec.generatedFrom,
    sheets: spec.sheets,
    primaryReportSheet: spec.primaryReportSheet,
    parts,
  });
  return indexPath;
}

/** Read a spec written by writeSpec (dir or index.json), or a flat spec .json. */
export function readSpec(target) {
  const stat = fs.statSync(target);
  const indexPath = stat.isDirectory() ? path.join(target, "index.json") : target;
  const index = readJson(indexPath);
  if (!index.parts) return index; // flat monolithic spec
  const dir = path.dirname(indexPath);
  const instrumentSheets = {};
  for (const [name, rel] of Object.entries(index.parts.instruments || {})) {
    instrumentSheets[name] = readJson(path.join(dir, rel));
  }
  const reportSheets = {};
  for (const [name, rel] of Object.entries(index.parts.reports || {})) {
    reportSheets[name] = readJson(path.join(dir, rel));
  }
  return {
    version: index.version,
    generatedFrom: index.generatedFrom,
    sheets: index.sheets,
    primaryReportSheet: index.primaryReportSheet,
    instrumentSheets,
    reportSheets,
  };
}

// ---- Dataset (the cross-generator input-cell hand-off) ---------------------

/**
 * Write a dataset as index + per-sheet cell parts + dropdowns under <dir>.
 * Cells are grouped by their target sheet; each part stores {ref,value} (sheet
 * is implied by the part key), keeping parts small and diff-friendly.
 */
export function writeDataset(dir, dataset) {
  ensureDir(dir);
  const bySheet = new Map();
  for (const cell of dataset.cells || []) {
    if (!bySheet.has(cell.sheet)) bySheet.set(cell.sheet, []);
    bySheet.get(cell.sheet).push({ ref: cell.ref, value: cell.value });
  }
  const parts = {};
  for (const [sheet, cells] of bySheet) {
    const rel = path.join("cells", `${slug(sheet)}.json`);
    writeJson(path.join(dir, rel), cells);
    parts[sheet] = rel;
  }
  writeJson(path.join(dir, "dropdowns.json"), dataset.dropdowns || []);

  const indexPath = path.join(dir, "index.json");
  writeJson(indexPath, {
    version: dataset.version,
    source: dataset.source,
    samples: dataset.samples,
    cellParts: parts,
    cellCounts: Object.fromEntries([...bySheet].map(([s, c]) => [s, c.length])),
    dropdowns: "dropdowns.json",
  });
  return indexPath;
}

/** Read a dataset written by writeDataset (dir or index.json), or a flat dataset .json. */
export function readDataset(target) {
  const stat = fs.statSync(target);
  const isDir = stat.isDirectory();
  const indexPath = isDir ? path.join(target, "index.json") : target;
  const index = readJson(indexPath);
  if (Array.isArray(index.cells)) return index; // flat monolithic dataset
  const dir = path.dirname(indexPath);
  const cells = [];
  for (const [sheet, rel] of Object.entries(index.cellParts || {})) {
    for (const c of readJson(path.join(dir, rel))) cells.push({ sheet, ref: c.ref, value: c.value });
  }
  const dropdowns = index.dropdowns ? readJson(path.join(dir, index.dropdowns)) : [];
  return { version: index.version, source: index.source, samples: index.samples, cells, dropdowns };
}
