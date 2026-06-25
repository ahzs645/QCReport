// Output helpers: write JSON and CSV artifacts under out/.
// Kept tiny and dependency-free so every script writes consistent files.

import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return filePath;
}

/** Escape one CSV field per RFC 4180. */
function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Write an array of row objects to CSV.
 * @param {string} filePath
 * @param {object[]} rows
 * @param {string[]} [columns] - explicit column order; defaults to keys of first row
 */
export function writeCsv(filePath, rows, columns) {
  ensureDir(path.dirname(filePath));
  // Union keys across all rows so heterogeneous records (e.g. mixed warning
  // shapes) don't silently drop columns absent from the first row.
  const cols = columns || [...rows.reduce((set, r) => {
    for (const k of Object.keys(r)) set.add(k);
    return set;
  }, new Set())];
  const lines = [cols.map(csvField).join(",")];
  for (const row of rows) lines.push(cols.map((c) => csvField(row[c])).join(","));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}
