// Surgical .xlsx editing via JSZip — set/clear cell VALUES in the worksheet XML
// without re-serializing formulas, styles, dynamic-array metadata (xl/metadata.xml,
// cm="…"), calcChain, printer settings, etc.
//
// Why: exceljs cannot round-trip these NALS workbooks — it drops metadata.xml and
// rewrites array/shared formulas, which Excel flags as corrupt ("found a problem
// with content" / "Shared Formula master must exist"). By starting from the
// pristine Excel-authored XML and touching only value cells, the output stays
// byte-faithful everywhere except where we intend to change it.
//
// Works in Node and the browser (JSZip is isomorphic). Pure string transforms.

import JSZip from "jszip";

const colToNum = (letters) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
const refParts = (ref) => {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return m ? { col: colToNum(m[1]), row: Number(m[2]) } : { col: 0, row: 0 };
};
const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const styleAttr = (attrs) => (attrs.match(/\ss="\d+"/) || [""])[0];

/** Load an .xlsx (ArrayBuffer/Buffer/Uint8Array) into a JSZip instance. */
export function loadXlsxZip(data) {
  return JSZip.loadAsync(data);
}

/** Map sheet name -> worksheet xml path (e.g. "xl/worksheets/sheet7.xml"). */
export async function sheetPathMap(zip) {
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) {
    rels[m[1]] = m[2];
  }
  const map = {};
  for (const tag of wbXml.match(/<sheet\b[^>]*\/?>/g) || []) {
    const name = (tag.match(/name="([^"]+)"/) || [])[1];
    const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
    if (!name || !rid || !rels[rid]) continue;
    let target = rels[rid].replace(/^\/?xl\//, "").replace(/^\//, "");
    map[name] = `xl/${target}`;
  }
  return map;
}

function buildCell(ref, value, sAttr) {
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${sAttr}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** Set one cell's value in a worksheet XML string (inserting it if absent). */
function setCell(xml, ref, value) {
  const reSelf = new RegExp(`<c r="${ref}"((?:[^>"]|"[^"]*")*?)/>`);
  const reFull = new RegExp(`<c r="${ref}"((?:[^>"]|"[^"]*")*?)>[\\s\\S]*?</c>`);
  if (reSelf.test(xml)) return xml.replace(reSelf, (_m, a) => buildCell(ref, value, styleAttr(a)));
  if (reFull.test(xml)) return xml.replace(reFull, (_m, a) => buildCell(ref, value, styleAttr(a)));
  return insertCell(xml, ref, value);
}

/** Insert a cell into its row (in column order), creating the row if needed. */
function insertCell(xml, ref, value) {
  const { row, col } = refParts(ref);
  const cellXml = buildCell(ref, value, "");
  const rowRe = new RegExp(`(<row r="${row}"(?:[^>]*)>)([\\s\\S]*?)(</row>)`);
  if (rowRe.test(xml)) {
    return xml.replace(rowRe, (_m, open, inner, close) => {
      const cells = inner.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || [];
      let i = cells.findIndex((c) => refParts((c.match(/r="([A-Z]+\d+)"/) || [])[1] || "A1").col > col);
      if (i === -1) i = cells.length;
      cells.splice(i, 0, cellXml);
      return open + cells.join("") + close;
    });
  }
  // create the row before the first row with a greater number, else append.
  const newRow = `<row r="${row}">${cellXml}</row>`;
  const after = xml.match(/<row r="(\d+)"/g) || [];
  const greater = after.map((t) => Number(t.match(/\d+/)[0])).find((n) => n > row);
  if (greater !== undefined) return xml.replace(new RegExp(`<row r="${greater}"`), `${newRow}<row r="${greater}"`);
  return xml.replace("</sheetData>", `${newRow}</sheetData>`);
}

/** Blank non-formula value cells within a row/col band (keeps formulas + styles). */
function clearBand(xml, { rowStart, rowEnd, colStart = 1, colEnd = Infinity }) {
  return xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (full, rnum, rattrs, inner) => {
    const r = Number(rnum);
    if (r < rowStart || r > rowEnd) return full;
    const newInner = inner.replace(/<c r="([A-Z]+\d+)"((?:[^>"]|"[^"]*")*?)(\/>|>[\s\S]*?<\/c>)/g, (cm, cref, cattrs, body) => {
      const { col } = refParts(cref);
      if (col < colStart || col > colEnd) return cm; // outside the column band
      if (/<f[\s>]/.test(body)) return cm; // keep formula cells
      return `<c r="${cref}"${styleAttr(cattrs)}/>`;
    });
    return `<row r="${rnum}"${rattrs}>${newInner}</row>`;
  });
}

/** Set <calcPr fullCalcOnLoad="1"> so Excel recalculates on open. */
function setFullCalcOnLoad(xml) {
  if (/<calcPr\b[^>]*fullCalcOnLoad/.test(xml)) return xml;
  if (/<calcPr\b[^>]*\/>/.test(xml)) return xml.replace(/<calcPr\b([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  if (/<calcPr\b[^>]*>/.test(xml)) return xml.replace(/<calcPr\b([^>]*)>/, '<calcPr$1 fullCalcOnLoad="1">');
  return xml.replace("</workbook>", '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
}

/**
 * Apply cell edits to a loaded zip, in place. Returns the zip.
 * @param {JSZip} zip
 * @param {object} opts
 * @param {Record<string, Array<{ref,value}>>} [opts.setCells] - per sheet name
 * @param {Record<string, {rowStart,rowEnd,colStart?,colEnd?}>} [opts.clearBands] - per sheet name
 * @param {boolean} [opts.fullCalcOnLoad=true]
 */
export async function applyEdits(zip, { setCells = {}, clearBands = {}, fullCalcOnLoad = true } = {}) {
  const map = await sheetPathMap(zip);
  const sheets = new Set([...Object.keys(setCells), ...Object.keys(clearBands)]);
  for (const name of sheets) {
    const path = map[name];
    if (!path || !zip.file(path)) continue;
    let xml = await zip.file(path).async("string");
    if (clearBands[name]) xml = clearBand(xml, clearBands[name]);
    for (const { ref, value } of setCells[name] || []) xml = setCell(xml, ref, value);
    zip.file(path, xml);
  }
  if (fullCalcOnLoad && zip.file("xl/workbook.xml")) {
    zip.file("xl/workbook.xml", setFullCalcOnLoad(await zip.file("xl/workbook.xml").async("string")));
  }
  return zip;
}

/**
 * Strip cached <v> results from every formula cell across all worksheets (keeps
 * the <f>). Used when building blank templates so no stale CLIENT-derived values
 * remain in the file; Excel recomputes on open (with fullCalcOnLoad). Mutates zip.
 */
export async function stripAllFormulaCaches(zip) {
  const map = await sheetPathMap(zip);
  for (const p of Object.values(map)) {
    if (!zip.file(p)) continue;
    let xml = await zip.file(p).async("string");
    xml = xml.replace(/(<\/f>)<v>[\s\S]*?<\/v>/g, "$1").replace(/(<f\b[^>]*\/>)<v>[\s\S]*?<\/v>/g, "$1");
    zip.file(p, xml);
  }
  return zip;
}

/**
 * Blank the text of shared strings no longer referenced by any cell (orphaned
 * after clearing cells), keeping the <si> entries so indices stay aligned. This
 * removes residual client text from xl/sharedStrings.xml. Mutates zip.
 */
export async function scrubUnusedSharedStrings(zip) {
  const f = zip.file("xl/sharedStrings.xml");
  if (!f) return zip;
  const map = await sheetPathMap(zip);
  const used = new Set();
  for (const p of Object.values(map)) {
    if (!zip.file(p)) continue;
    const xml = await zip.file(p).async("string");
    for (const m of xml.matchAll(/<c\b[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>/g)) used.add(Number(m[1]));
  }
  let idx = -1;
  const ss = (await f.async("string")).replace(/<si>[\s\S]*?<\/si>/g, (si) => {
    idx += 1;
    return used.has(idx) ? si : "<si><t/></si>";
  });
  zip.file("xl/sharedStrings.xml", ss);
  return zip;
}

/** Blank author/editor names in docProps/core.xml (document metadata). Mutates zip. */
export async function scrubDocProps(zip) {
  const f = zip.file("docProps/core.xml");
  if (!f) return zip;
  const xml = (await f.async("string"))
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g, "<dc:creator></dc:creator>")
    .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/g, "<cp:lastModifiedBy></cp:lastModifiedBy>");
  zip.file("docProps/core.xml", xml);
  return zip;
}

/** Group flat dataset cells [{sheet,ref,value}] into { sheet: [{ref,value}] }. */
export function groupCellsBySheet(cells) {
  const out = {};
  for (const c of cells || []) (out[c.sheet] ??= []).push({ ref: c.ref, value: c.value });
  return out;
}
