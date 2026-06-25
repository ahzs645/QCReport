// Low-level spreadsheet helpers shared across the pipeline.
//
// These wrap the awkward parts of working with exceljs cell values:
//  - cells can be strings, numbers, booleans, dates, rich-text objects,
//    or formula objects ({ formula, result, ref, shareType }).
//  - we frequently need plain text / plain numbers regardless of shape.
//  - we convert between A1 references and { row, col } indices.
//
// Pure functions only — no file I/O here.

const COL_RE = /^[A-Z]+/;
const ROW_RE = /\d+$/;

/** Convert a column letter ("A", "AX") to a 1-based index. */
export function colToNumber(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

/** Convert a 1-based column index to letters (1 -> "A", 50 -> "AX"). */
export function numberToCol(num) {
  let n = num;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Parse "C70" -> { col: 3, row: 70, colLetter: "C" }. Drops $ anchors. */
export function parseRef(ref) {
  const clean = ref.replace(/\$/g, "");
  const colLetter = (clean.match(COL_RE) || [""])[0];
  const row = Number((clean.match(ROW_RE) || ["0"])[0]);
  return { col: colToNumber(colLetter), row, colLetter };
}

/**
 * Parse a range like "E70:E114" or "PHYSICAL RESULTS!A18:A62".
 * @returns {{ sheet: string|null, start: object, end: object }}
 */
export function parseRange(range) {
  let sheet = null;
  let body = range;
  const bang = range.lastIndexOf("!");
  if (bang !== -1) {
    sheet = range.slice(0, bang).replace(/^'/, "").replace(/'$/, "");
    body = range.slice(bang + 1);
  }
  const [a, b] = body.split(":");
  return { sheet, start: parseRef(a), end: parseRef(b || a) };
}

/**
 * Flatten any exceljs cell value to a primitive (string | number | boolean | null).
 * For formula cells, returns the cached `result`. For rich text, joins the runs.
 */
export function cellValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return raw; // string | number | boolean
  if (raw instanceof Date) return raw;
  // Convenience: accept an exceljs Cell object and unwrap its .value.
  if ("value" in raw && "address" in raw) return cellValue(raw.value);
  if ("richText" in raw) return raw.richText.map((r) => r.text).join("");
  if ("formula" in raw || "sharedFormula" in raw) return cellValue(raw.result ?? null);
  if ("text" in raw && "hyperlink" in raw) return raw.text; // hyperlink cell value
  if ("error" in raw) return raw.error;
  return null;
}

/** Like cellValue but always returns a trimmed string ("" for null). */
export function cellText(raw) {
  const v = cellValue(raw);
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** True if the cell holds a formula (array or scalar). */
export function isFormulaCell(raw) {
  return (
    raw !== null &&
    typeof raw === "object" &&
    ("formula" in raw || "sharedFormula" in raw)
  );
}

/**
 * Translate the relative cell references in a formula by (rowDelta, colDelta).
 * Absolute parts ($COL / $ROW) are left unchanged. Used to expand Excel
 * shared formulas, which exceljs returns un-expanded.
 */
export function translateFormula(formula, rowDelta, colDelta) {
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (full, colAbs, col, rowAbs, row, offset, str) => {
      const prev = str[offset - 1];
      // Skip if this is part of a longer identifier (function name, sci-notation, etc.)
      if (prev && /[A-Za-z0-9_.]/.test(prev)) return full;
      const newCol = colAbs ? col : numberToCol(colToNumber(col) + colDelta);
      const newRow = rowAbs ? row : String(Number(row) + rowDelta);
      return `${colAbs}${newCol}${rowAbs}${newRow}`;
    },
  );
}

/**
 * Return the effective formula string for an exceljs cell, expanding shared
 * formulas via translation. Returns null for non-formula cells.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {import('exceljs').Cell} cell
 * @param {number} row - 1-based row of the cell
 * @param {number} col - 1-based column of the cell
 */
export function resolveFormula(ws, cell, row, col) {
  const v = cell.value;
  if (!v || typeof v !== "object") return null;
  if ("formula" in v) return v.formula;
  if ("sharedFormula" in v) {
    const master = ws.getCell(v.sharedFormula);
    const mf = master.value && typeof master.value === "object" ? master.value.formula : null;
    if (!mf) return null;
    const m = parseRef(v.sharedFormula);
    return translateFormula(mf, row - m.row, col - m.col);
  }
  return null;
}

/** Coerce to a finite number or null. Handles "12.3", " 0.5 ", numbers. */
export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return value.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}
