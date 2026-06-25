#!/usr/bin/env node
// Phase 2a — ingest raw instrument exports into one sample-dataset, replacing the
// manual copy/paste into the calculation workbook.
//
// Implemented instruments:
//   ICPOES  "Conc" (.xlsx)  — analytes by label (row 16), samples by NALS id
//   IC      "CDet" (.xls)   — anions by name, samples by NALS # + descriptive name
// IC/ICPMS/ICPQQQ mass-spec and physical/biological inputs are follow-ups.
//
// The client roster (which samples this report covers) and the workbook layout
// come from a reference RESULTS workbook via --roster. Pass --validate to compare
// the reconstructed inputs against what the analyst actually pasted.
//
// Usage:
//   npm run ingest:raw -- --roster "<…RESULTS…OES.xlsx>" --source-root "<…/<sample> RW>"
//                        [--icpoes-conc <file.xlsx>] [--ic <file.xls>]
//                        [--validate "<…RESULTS…OES.xlsx>"] [--resolve-dilutions]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { writeCsv, writeJson } from "./lib/dataset.mjs";
import { writeDataset } from "./lib/store.mjs";
import { cellValue } from "./lib/sheet-utils.mjs";
import { buildSpec, getClientSamples, openWorkbook } from "./lib/results-workbook.mjs";
import { isIcpoesConcWorkbook, parseIcpoesConc } from "./lib/raw-parsers/icpoes-conc.mjs";
import { isIcWorkbook, parseIcWorkbook } from "./lib/raw-parsers/ic-cdet.mjs";
import { ingestIc, ingestIcpoes } from "./lib/ingest.mjs";
import { ingestQcBatch, parseQcBatch } from "./lib/qc-batch.mjs";
import { applyEdits, groupCellsBySheet, loadXlsxZip } from "./lib/xlsx-zip.mjs";
import { colToNumber } from "./lib/sheet-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDE = /RESULTS|_QC_|QC_Bact|HotBlk|Digest|Labels|VERIFICATION/i;

function findFiles(dir, re) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, re));
    else if (re.test(entry.name) && !entry.name.startsWith("~$")) out.push(full);
  }
  return out;
}

async function autoFindConc(sourceRoot) {
  for (const file of findFiles(sourceRoot, /\.xlsx$/i).filter((f) => !EXCLUDE.test(path.basename(f)))) {
    try {
      const wb = await openWorkbook(file);
      if (isIcpoesConcWorkbook(wb) && !wb.getWorksheet("REPORT DATA")) return file;
    } catch {
      /* skip */
    }
  }
  return null;
}

function autoFindIc(sourceRoot) {
  for (const file of findFiles(sourceRoot, /\.xls$/i)) {
    try {
      if (isIcWorkbook(XLSX.readFile(file, { bookSheets: true }))) return file;
    } catch {
      /* skip */
    }
  }
  return null;
}

const isBlank = (v) => v === null || v === undefined || v === "";

/**
 * Compare reconstructed analyte cells (skip A/B identity) for one sheet.
 * Distinguishes:
 *   matched    — both populated and equal
 *   mismatches — both populated but differ (real reconstruction differences)
 *   extra      — analyst left it blank; we filled from raw (editorial scope, not an error)
 * Fidelity % is computed over cells the analyst actually populated.
 */
function validateSheet(wb, cells, sheetName) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return null;
  const mismatches = [];
  let matched = 0;
  let extra = 0;
  for (const { sheet, ref, value } of cells) {
    if (sheet !== sheetName || /^[AB]\d+$/.test(ref)) continue;
    const actual = cellValue(ws.getCell(ref).value);
    if (isBlank(actual) && !isBlank(value)) {
      extra += 1; // analyst omitted this sample/instrument in this report
      continue;
    }
    if (String(actual) === String(value)) matched += 1;
    else mismatches.push({ sheet, ref, ingested: value, actual });
  }
  const compared = matched + mismatches.length;
  return { sheet: sheetName, compared, matched, extra, pct: compared ? ((100 * matched) / compared).toFixed(1) : "0", mismatches };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    aliases: { o: "output" },
    booleans: ["help", "resolve-dilutions"],
    defaults: { output: path.join("out", "ingest") },
  });
  if (args.help) {
    console.log("Usage: npm run ingest:raw -- --roster <RESULTS.xlsx> --source-root <dir> [--validate <RESULTS.xlsx>]");
    return;
  }

  const rosterPath = requireArg(args, "roster", "RESULTS workbook providing the client roster + layout");
  const sourceRoot = args["source-root"] ? path.resolve(args["source-root"]) : null;
  const outDir = path.resolve(ROOT, args.output);
  const resolveDilutions = Boolean(args["resolve-dilutions"]);

  console.log(`Roster + layout from ${path.basename(rosterPath)}`);
  const rosterWb = await openWorkbook(rosterPath);
  const spec = buildSpec(rosterWb);
  const samples = getClientSamples(rosterWb, spec);
  console.log(`  ${samples.length} client samples`);

  const allCells = [];
  const allWarnings = [];
  const summaries = [];

  // ---- ICPOES (.xlsx Conc) ----
  let concPath = args["icpoes-conc"] || (sourceRoot && (await autoFindConc(sourceRoot)));
  if (concPath) {
    const parsed = await parseIcpoesConc(concPath);
    const oes = spec.instrumentSheets["ICPOES RESULTS"];
    const r = ingestIcpoes(parsed, {
      samples,
      analytes: oes.analytes,
      inputBandStart: oes.inputRows.start,
      resolveDilutions,
    });
    allCells.push(...r.cells);
    allWarnings.push(...r.warnings);
    summaries.push({ instrument: "ICPOES", file: path.basename(concPath), matched: r.matchedSamples, samples: samples.length, cells: r.cells.length, overRangeFlagged: r.overRangeFlagged });
    console.log(`ICPOES (${path.basename(concPath)}): matched ${r.matchedSamples}/${samples.length}, ${r.cells.length} cells, ${r.overRangeFlagged} over-range flagged`);
  } else {
    console.log("ICPOES: no raw Conc file found (skipped)");
  }

  // ---- IC (.xls CDet/UV) ----
  let icPath = args.ic || (sourceRoot && autoFindIc(sourceRoot));
  if (icPath) {
    const parsed = parseIcWorkbook(XLSX.readFile(icPath));
    const icSheet = spec.instrumentSheets["IC RESULTS"];
    const r = ingestIc(parsed, {
      samples,
      analytes: icSheet.analytes,
      inputBandStart: icSheet.inputRows.start,
      resolveDilutions,
    });
    allCells.push(...r.cells);
    allWarnings.push(...r.warnings);
    summaries.push({ instrument: "IC", file: path.basename(icPath), matched: r.matchedSamples, samples: samples.length, cells: r.cells.length, overRangeFlagged: r.overRangeFlagged });
    console.log(`IC (${path.basename(icPath)}): matched ${r.matchedSamples}/${samples.length}, ${r.cells.length} cells`);
  } else {
    console.log("IC: no raw .xls file found (skipped)");
  }

  // ---- write the RESULTS dataset (modular: index + per-sheet cell parts) ----
  const resultsDataset = {
    version: spec.version,
    source: { roster: path.basename(rosterPath), icpoesConc: concPath && path.basename(concPath), ic: icPath && path.basename(icPath) },
    samples,
    cells: allCells,
    dropdowns: [],
  };
  const resultsIndex = writeDataset(path.join(outDir, "results"), resultsDataset);
  console.log(`\nRESULTS dataset -> ${path.relative(ROOT, resultsIndex)} (${allCells.length} cells)`);

  // ---- QC BatchA (separate workbook, separate dataset) ----
  let qcReport = null;
  if (args.qc) {
    if (!concPath) throw new Error("--qc needs the raw OES file (--icpoes-conc / --source-root) for the Unadjusted data");
    const qcWb = await openWorkbook(args.qc);
    const qcModel = parseQcBatch(qcWb);
    const unadjusted = await parseIcpoesConc(concPath, { kind: "unadjusted" });
    const qc = ingestQcBatch(qcModel, unadjusted);
    allWarnings.push(...qc.warnings);
    const qcDataset = {
      version: cellValue(qcWb.getWorksheet("INSTRUCTIONS")?.getCell("A2").value) || null,
      source: { qcWorkbook: path.basename(args.qc), rawUnadjusted: path.basename(concPath) },
      samples: qcModel.qcRows.map((q) => ({ role: q.role, rawLabel: q.rawLabel })),
      cells: qc.cells,
      dropdowns: [],
    };
    const qcIndex = writeDataset(path.join(outDir, "qc"), qcDataset);
    console.log(
      `QC BatchA: ${qc.matchedRows}/${qcModel.qcRows.length} QC rows matched, ${qc.cells.length} cells` +
        `${qc.ambiguousRows ? `, ${qc.ambiguousRows} ambiguous-label row(s) flagged (verify occurrence)` : ""} -> ${path.relative(ROOT, qcIndex)}`,
    );
    // Validate reconstructed QC green cells against the existing QC workbook
    // (before we clear/repopulate it below).
    qcReport = validateSheet(qcWb, qc.cells, "BATCH");
    if (qcReport) {
      console.log(`Validation BATCH: ${qcReport.matched}/${qcReport.compared} match (${qcReport.pct}%), ${qcReport.mismatches.length} differ`);
    }

    // Produce a populated QC workbook from raw via surgical JSZip injection
    // (clear the green region, set raw-derived values) — formulas + metadata stay
    // pristine so it opens clean in Excel and recalculates on open.
    const rows = qcModel.qcRows.map((r) => r.row);
    const cols = qcModel.analytes.map((a) => colToNumber(a.col));
    const zip = await loadXlsxZip(fs.readFileSync(args.qc));
    await applyEdits(zip, {
      clearBands: { BATCH: { rowStart: Math.min(...rows), rowEnd: Math.max(...rows), colStart: Math.min(...cols), colEnd: Math.max(...cols) } },
      setCells: groupCellsBySheet(qc.cells),
      fullCalcOnLoad: true,
    });
    const qcOut = path.join(outDir, "qc", `${path.parse(args.qc).name}-from-raw.xlsx`);
    fs.writeFileSync(qcOut, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    console.log(`Populated QC workbook -> ${path.relative(ROOT, qcOut)} (open in Excel to recalc)`);
  }

  if (allWarnings.length) writeCsv(path.join(outDir, "warnings.csv"), allWarnings);
  writeJson(path.join(outDir, "ingest-summary.json"), { summaries, warnings: allWarnings.length });

  // ---- validation (RESULTS sheets) ----
  if (args.validate) {
    const valWb = args.validate === rosterPath ? rosterWb : await openWorkbook(args.validate);
    const reports = ["ICPOES RESULTS", "IC RESULTS"]
      .map((s) => validateSheet(valWb, allCells, s))
      .filter((r) => r && r.compared);
    const mism = [];
    for (const rep of reports) {
      console.log(
        `Validation ${rep.sheet}: ${rep.matched}/${rep.compared} of analyst-entered cells match (${rep.pct}%), ` +
          `${rep.mismatches.length} differ, ${rep.extra} extra (filled from raw, analyst left blank)`,
      );
      mism.push(...rep.mismatches);
    }
    if (qcReport) mism.push(...qcReport.mismatches);
    writeJson(path.join(outDir, "validation.json"), { results: reports, qc: qcReport });
    if (mism.length) writeCsv(path.join(outDir, "validation-mismatches.csv"), mism);
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
