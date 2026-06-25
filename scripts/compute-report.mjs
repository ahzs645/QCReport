#!/usr/bin/env node
// Phase 1c — re-implement the workbook formulas in code and cross-check against
// the workbook's own cached values. This is the correctness proof: if the engine
// reproduces Excel's results on real data, we have captured the logic faithfully.
//
// Usage:
//   npm run compute:report -- --source "/path/to/…RESULTS…OES.xlsx"
//                            [--output out/compute-report]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { writeCsv, writeJson } from "./lib/dataset.mjs";
import { buildSpec, openWorkbook } from "./lib/results-workbook.mjs";
import { crossCheckInstrumentSheets, crossCheckReportMatrix } from "./lib/compute.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pct = (n, d) => (d === 0 ? "100.0" : ((100 * n) / d).toFixed(1));

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    aliases: { s: "source", o: "output" },
    booleans: ["help"],
    defaults: { output: path.join("out", "compute-report") },
  });
  if (args.help) {
    console.log("Usage: npm run compute:report -- --source <RESULTS.xlsx> [--output <dir>]");
    return;
  }

  const source = requireArg(args, "source", "path to a *_RESULTS_*.xlsx with data");
  const outDir = path.resolve(ROOT, args.output);

  console.log(`Reading ${source}`);
  const wb = await openWorkbook(source);
  const spec = buildSpec(wb);

  const engine = crossCheckInstrumentSheets(wb, spec);
  const matrix = crossCheckReportMatrix(wb, spec);

  console.log(`\nVersion: ${spec.version}`);
  console.log("Engine vs cached reportable values (instrument sheets):");
  console.log(`  ${engine.matched}/${engine.total} match (${pct(engine.matched, engine.total)}%)`);
  console.log(`REPORT DATA mapping vs cached (${matrix.reportSheet}, ${matrix.samples} samples):`);
  console.log(
    `  ${matrix.matched}/${matrix.total} match (${pct(matrix.matched, matrix.total)}%)` +
      `${matrix.artifacts ? `, ${matrix.artifacts} blank/zero cache artifact(s)` : ""}`,
  );

  const summary = {
    source: path.basename(source),
    version: spec.version,
    engine: { total: engine.total, matched: engine.matched, mismatched: engine.mismatches.length },
    reportMatrix: {
      reportSheet: matrix.reportSheet,
      samples: matrix.samples,
      total: matrix.total,
      matched: matrix.matched,
      artifacts: matrix.artifacts,
      mismatched: matrix.mismatches.length,
    },
  };
  writeJson(path.join(outDir, "cross-check-summary.json"), summary);
  if (engine.mismatches.length) {
    writeCsv(path.join(outDir, "engine-mismatches.csv"), engine.mismatches);
    console.log(`\n${engine.mismatches.length} engine mismatch(es) -> engine-mismatches.csv`);
    for (const m of engine.mismatches.slice(0, 8)) {
      console.log(`  ${m.sheet}!${m.reportableCell}: input=${JSON.stringify(m.input)} computed=${JSON.stringify(m.computed)} cached=${JSON.stringify(m.cached)}`);
    }
  }
  if (matrix.mismatches.length) {
    writeCsv(path.join(outDir, "report-mismatches.csv"), matrix.mismatches);
    console.log(`${matrix.mismatches.length} report-matrix mismatch(es) -> report-mismatches.csv`);
    for (const m of matrix.mismatches.slice(0, 8)) {
      console.log(`  ${m.parameter} s${m.sample}: source=${JSON.stringify(m.sourceVal)} report=${JSON.stringify(m.reportVal)} (${m.source})`);
    }
  }
  console.log(`\nWrote summary -> ${path.relative(ROOT, path.join(outDir, "cross-check-summary.json"))}`);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
