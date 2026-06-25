#!/usr/bin/env node
// Build pristine blank templates by SURGICALLY clearing the input cells of real
// Excel-authored workbooks (JSZip), preserving formulas, styles, and dynamic-array
// metadata. Replaces the old exceljs-written templates, which Excel flagged as
// corrupt (dropped xl/metadata.xml + rewrote array/shared formulas).
//
// Usage:
//   npm run build:templates -- --results "<…RESULTS…OES.xlsx>" --qc "<…QC_BatchA…OES.xlsx>"

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";
import { ensureDir } from "./lib/dataset.mjs";
import { buildSpec, openWorkbook, inputBands } from "./lib/results-workbook.mjs";
import { parseQcBatch } from "./lib/qc-batch.mjs";
import { applyEdits, loadXlsxZip, scrubUnusedSharedStrings, stripAllFormulaCaches } from "./lib/xlsx-zip.mjs";
import { colToNumber } from "./lib/sheet-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function clearToTemplate(sourcePath, clearBands, outPath) {
  const zip = await loadXlsxZip(fs.readFileSync(sourcePath));
  await applyEdits(zip, { clearBands, fullCalcOnLoad: true });
  // Scrub residual client-derived values so the blank template (which may be
  // bundled into a public site) carries no lab/client data.
  await stripAllFormulaCaches(zip);
  await scrubUnusedSharedStrings(zip);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { booleans: ["help"] });
  if (args.help || (!args.results && !args.qc)) {
    console.log("Usage: npm run build:templates -- --results <RESULTS.xlsx> [--qc <QC_BatchA.xlsx>]");
    return;
  }

  if (args.results) {
    const wb = await openWorkbook(args.results);
    const spec = buildSpec(wb);
    const bands = inputBands(spec); // { sheet: {start,end} } for instrument + direct sheets
    const clearBands = {};
    for (const [sheet, b] of Object.entries(bands)) clearBands[sheet] = { rowStart: b.start, rowEnd: b.end };
    // Also clear the REPORT DATA sample (spill) columns — cached sample names + values.
    for (const [sheet, report] of Object.entries(spec.reportSheets)) {
      const src = report.layout?.sourceCol;
      if (src) clearBands[sheet] = { rowStart: 1, rowEnd: 200, colStart: src + 1, colEnd: src + 60 };
    }
    const out = path.join(ROOT, "templates", "nals-results-template.xlsx");
    await clearToTemplate(args.results, clearBands, out);
    console.log(`RESULTS template (pristine, scrubbed) -> ${path.relative(ROOT, out)} — cleared ${Object.keys(clearBands).length} sheets`);
  }

  if (args.qc) {
    const wb = await openWorkbook(args.qc);
    const qc = parseQcBatch(wb);
    const rows = qc.qcRows.map((r) => r.row);
    const cols = qc.analytes.map((a) => colToNumber(a.col));
    const clearBands = {
      BATCH: {
        rowStart: Math.min(...rows),
        rowEnd: Math.max(...rows),
        colStart: Math.min(...cols),
        colEnd: Math.max(...cols),
      },
      // SUMMARY TABLE holds cached QC results (recovery %, pass/fail) — scrub them.
      "SUMMARY TABLE": { rowStart: 8, rowEnd: 120, colStart: colToNumber("D"), colEnd: colToNumber("R") },
    };
    const out = path.join(ROOT, "templates", "nals-qc-template.xlsx");
    await clearToTemplate(args.qc, clearBands, out);
    console.log(`QC template (pristine) -> ${path.relative(ROOT, out)} — cleared BATCH green region`);
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
