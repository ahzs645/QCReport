#!/usr/bin/env node
// Phase 1b — render a populated calculation workbook from the blank template by
// injecting a sample dataset. The result is a live-formula .xlsx that an analyst
// opens in Excel; it recalculates on open (fullCalcOnLoad).
//
// Two input modes:
//   --from-workbook <RESULTS.xlsx>   extract a dataset from an existing run and
//                                    re-export it (round-trip)
//   --dataset <dataset.json>         inject a dataset (e.g. from ingest:raw)
//
// Usage:
//   npm run reexport:workbook -- --from-workbook "/path/to/…RESULTS…OES.xlsx"
//   npm run reexport:workbook -- --dataset out/ingest/dataset.json --name run.xlsx

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";
import { extractInputs } from "./lib/sample-dataset.mjs";
import { readDataset, writeDataset } from "./lib/store.mjs";
import { buildSpec, openWorkbook } from "./lib/results-workbook.mjs";
import { applyEdits, groupCellsBySheet, loadXlsxZip } from "./lib/xlsx-zip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    aliases: { o: "output" },
    booleans: ["help"],
    defaults: {
      template: path.join("templates", "nals-results-template.xlsx"),
      output: path.join("out", "reexports"),
    },
  });
  if (args.help || (!args["from-workbook"] && !args.dataset)) {
    console.log(
      "Usage:\n" +
        "  npm run reexport:workbook -- --from-workbook <RESULTS.xlsx> [--name out.xlsx]\n" +
        "  npm run reexport:workbook -- --dataset <dataset.json> [--name out.xlsx]",
    );
    return;
  }

  const templatePath = path.resolve(ROOT, args.template);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}. Run extract:template first.`);
  }
  const outDir = path.resolve(ROOT, args.output);

  // 1. Obtain the dataset to inject.
  let dataset;
  let baseName;
  if (args["from-workbook"]) {
    const src = args["from-workbook"];
    console.log(`Extracting dataset from ${src}`);
    const srcWb = await openWorkbook(src);
    dataset = extractInputs(srcWb, buildSpec(srcWb), path.basename(src));
    baseName = args.name || `reexport-${path.basename(src)}`;
    writeDataset(path.join(outDir, "datasets", path.parse(baseName).name), dataset);
  } else {
    // Accepts a modular dataset dir / index.json, or a flat dataset.json.
    dataset = readDataset(path.resolve(ROOT, args.dataset));
    baseName = args.name || "reexport.xlsx";
  }
  console.log(
    `  ${dataset.cells?.length || 0} input cells, ${dataset.dropdowns?.length || 0} dropdowns, ` +
      `${dataset.samples?.filter((s) => s.kind === "client").length || 0} client samples`,
  );

  // 2. Surgically inject the cells into the pristine template (JSZip — never
  //    rewrites formulas/metadata, so the output opens clean in Excel).
  const zip = await loadXlsxZip(fs.readFileSync(templatePath));
  await applyEdits(zip, { setCells: groupCellsBySheet(dataset.cells), fullCalcOnLoad: true });
  const outPath = path.join(outDir, baseName.endsWith(".xlsx") ? baseName : `${baseName}.xlsx`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  console.log(`Injected ${dataset.cells.length} cells (surgical, formulas + metadata preserved)`);
  console.log(`Wrote re-export -> ${path.relative(ROOT, outPath)}`);
  console.log("Open in Excel to recalculate (fullCalcOnLoad is set).");
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
