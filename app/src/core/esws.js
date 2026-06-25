// Browser wrapper for the .esws (Agilent ICP Expert) parser. Reads the dropped
// file as an ArrayBuffer and hands it to the shared, browser-portable parser in
// ../../../scripts/lib. No server — the binary is unzipped and the .NET-NRBF
// parts are decoded entirely in the browser.

import { parseIcpoesEsws } from "../../../scripts/lib/raw-parsers/icpoes-esws.mjs";

/**
 * Parse a dropped .esws File into a flat display table.
 * @param {File} file
 * @param {"adjusted"|"unadjusted"} kind
 * @returns {Promise<{ fileName, kind, sheet, analytes, rows, count }>}
 */
export async function parseEsws(file, kind = "adjusted") {
  const buf = await file.arrayBuffer();
  const { sheet, analytes, rows } = await parseIcpoesEsws(buf, { kind });
  // Column order matches the parser's stable analyte sort.
  const columns = analytes.map((a) => ({ key: a.key, label: a.rawLabel }));
  return { fileName: file.name, kind, sheet, columns, rows, count: rows.length, analyteCount: columns.length };
}

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Render a parsed table to CSV text matching the .xlsx layout (Solution Label + analytes). */
export function toCsv(table) {
  const header = ["Solution Label", ...table.columns.map((c) => c.label)];
  const lines = [header.map(csvCell).join(",")];
  for (const row of table.rows) {
    const cells = [row.label, ...table.columns.map((c) => row.values[c.key])];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n");
}

/** Trigger a client-side download of `text` as `filename`. */
export function downloadText(text, filename, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
