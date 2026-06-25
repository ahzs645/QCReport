// Sample-prep cross-reference parsers — the workbooks created BEFORE the
// instrument run that tie a sample's identity together. Every NALS sheet shares
// one join key: the NALS id + autosampler position ("2026NALS02598 A06"), which
// normalizeSampleId() canonicalises. These let the app recover friendly sample
// names, QC/prep roles, and the physical rack layout without a RESULTS workbook.
//
//   HotBlock digestion ("Block Digest Liquids"): Batch Name -> Sample Name (the
//     ORIGIN of the friendly names) + amount/comments, and prep roles encoded in
//     the name ("Method Blank", "… DUP", "… SPIKED", "ICV LVL 6").
//   Labels: rack Column/Row -> Batch Name (id + position) + acid + date.
//
// Pure: take an already-loaded exceljs workbook, return plain data.

import { cellValue } from "../sheet-utils.mjs";
import { normalizeSampleId } from "./normalize.mjs";

const MAX_SCAN_ROWS = 80; // header is always near the top of these small sheets

/** Locate a header row by a column-A (or any-column) label, returning its row#. */
function findHeaderRow(ws, label, { col = null } = {}) {
  const re = new RegExp(`^\\s*${label}\\s*$`, "i");
  for (let r = 1; r <= Math.min(ws.rowCount, MAX_SCAN_ROWS); r += 1) {
    if (col) {
      if (re.test(String(cellValue(ws.getCell(r, col).value) ?? ""))) return r;
    } else {
      const row = ws.getRow(r);
      let hit = 0;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (re.test(String(cellValue(cell.value) ?? ""))) hit = 1;
      });
      if (hit) return r;
    }
  }
  return null;
}

/**
 * Classify a HotBlock "Sample Name" into the QC/prep role it implies, or null for
 * an actual client sample. Mirrors the analyst's prep notes.
 */
export function prepRole(sampleName) {
  const s = String(sampleName ?? "");
  if (!s.trim()) return null;
  if (/method blank|^\s*blank\b/i.test(s)) return "blank";
  if (/\bdup(licate)?\b/i.test(s)) return "duplicate";
  if (/spik/i.test(s)) return "lfmSpike";
  if (/\bicv\b|lvl\s*6/i.test(s)) return "icv";
  return null;
}

/** True if the workbook looks like a HotBlock digestion sheet. */
export function isHotBlockWorkbook(wb) {
  return wb.worksheets.some(
    (ws) => /digest/i.test(ws.name) && findHeaderRow(ws, "Batch Name", { col: 1 }) !== null,
  );
}

/**
 * Parse a HotBlock digestion workbook.
 * @returns {{ sheet, batch, samples: Array<{key,id,position,sampleName,batchNumber,amount,comments,date,prepRole}> }}
 */
export function parseHotBlock(wb) {
  const ws =
    wb.worksheets.find((s) => /digest/i.test(s.name) && findHeaderRow(s, "Batch Name", { col: 1 })) ||
    wb.worksheets.find((s) => findHeaderRow(s, "Batch Name", { col: 1 }));
  if (!ws) throw new Error("HotBlock workbook has no 'Batch Name' table");
  const hdr = findHeaderRow(ws, "Batch Name", { col: 1 });

  // Map the header labels to columns so column order isn't assumed.
  const colOf = {};
  ws.getRow(hdr).eachCell({ includeEmpty: false }, (cell, c) => {
    const t = String(cellValue(cell.value) ?? "").trim().toLowerCase();
    if (t) colOf[t] = c;
  });
  const get = (r, name) => cellValue(ws.getCell(r, colOf[name]).value);

  const samples = [];
  for (let r = hdr + 1; r <= ws.rowCount; r += 1) {
    const batchName = get(r, "batch name");
    if (batchName === null || String(batchName).trim() === "") continue;
    const sampleName = colOf["sample name"] != null ? get(r, "sample name") : null;
    samples.push({
      key: normalizeSampleId(batchName),
      id: String(batchName).trim(),
      position: positionCode(batchName),
      sampleName: sampleName == null ? "" : String(sampleName).trim(),
      batchNumber: colOf["batch number"] != null ? get(r, "batch number") : null,
      amount: colOf["amount (g)"] != null ? get(r, "amount (g)") : null,
      comments: colOf.comments != null ? String(get(r, "comments") ?? "") : "",
      date: colOf.date != null ? get(r, "date") : null,
      prepRole: prepRole(sampleName),
    });
  }
  const batch = headerValue(ws, "Filename (Reference):") || headerValue(ws, "Client Name:") || ws.name;
  return { sheet: ws.name, batch, samples };
}

/** Read a "Label: value" pair from column A/B above the table (HotBlock preamble). */
function headerValue(ws, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (let r = 1; r <= MAX_SCAN_ROWS; r += 1) {
    if (re.test(String(cellValue(ws.getCell(r, 1).value) ?? ""))) {
      const v = cellValue(ws.getCell(r, 2).value);
      return v == null ? null : String(v).trim();
    }
  }
  return null;
}

/** The autosampler position code ("A06") from a "2026NALS02598 A06" label. */
export function positionCode(label) {
  const m = String(label ?? "").match(/\b([A-Z]\d{1,2})\b\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

/** True if the workbook looks like a sample-labels rack layout. */
export function isLabelsWorkbook(wb) {
  return wb.worksheets.some((ws) => {
    const r = findHeaderRow(ws, "Batch Name", { col: 3 });
    return r !== null && /column/i.test(String(cellValue(ws.getCell(r, 1).value) ?? ""));
  });
}

/**
 * Parse a sample-labels workbook (rack layout).
 * @returns {{ sheet, rows: Array<{key,id,position,rackColumn,rackRow,acid,date}> }}
 */
export function parseLabels(wb) {
  const ws = wb.worksheets.find((s) => findHeaderRow(s, "Batch Name", { col: 3 }));
  if (!ws) throw new Error("Labels workbook has no rack 'Batch Name' column");
  const hdr = findHeaderRow(ws, "Batch Name", { col: 3 });
  const rows = [];
  for (let r = hdr + 1; r <= ws.rowCount; r += 1) {
    const batchName = cellValue(ws.getCell(r, 3).value);
    if (batchName === null || !/nals/i.test(String(batchName))) continue;
    rows.push({
      key: normalizeSampleId(batchName),
      id: String(batchName).replace(/\s+/g, " ").trim(),
      position: positionCode(batchName),
      rackColumn: cellValue(ws.getCell(r, 1).value),
      rackRow: cellValue(ws.getCell(r, 2).value),
      acid: cellValue(ws.getCell(r, 4).value),
      date: cellValue(ws.getCell(r, 5).value),
    });
  }
  return { sheet: ws.name, rows };
}

/**
 * Merge whatever prep sources are available into one identity index keyed by the
 * normalized id+position. Missing sources are simply absent — callers fall back.
 * @param {object} [sources] - { hotblock?: parseHotBlock(), labels?: parseLabels() }
 * @returns {Map<string,{id,position,sampleName,prepRole,rack,amount,comments}>}
 */
export function buildIdentityIndex({ hotblock = null, labels = null } = {}) {
  const index = new Map();
  const upsert = (key, patch) => index.set(key, { ...(index.get(key) || { key }), ...patch });
  for (const s of hotblock?.samples || []) {
    upsert(s.key, {
      id: s.id,
      position: s.position,
      sampleName: s.sampleName || undefined,
      prepRole: s.prepRole || undefined,
      amount: s.amount ?? undefined,
      comments: s.comments || undefined,
    });
  }
  for (const r of labels?.rows || []) {
    upsert(r.key, { id: r.id, position: r.position, rack: { column: r.rackColumn, row: r.rackRow }, acid: r.acid });
  }
  return index;
}
