#!/usr/bin/env node
// Phase 1a — derive the blank template + machine-readable spec from a known-good
// RESULTS workbook.
//
// Outputs:
//   templates/nals-results-template.xlsx  (sample data cleared, all formulas kept)
//   templates/workbook-spec.json          (parsed structure)
//   out/extract-template/clear-report.json (what was cleared, for audit)
//
// Usage:
//   npm run extract:template -- --source "/path/to/…RESULTS…OES.xlsx"
//                              [--template templates/nals-results-template.xlsx]
//                              [--spec templates/workbook-spec.json]
//                              [--keep-data]   # build spec only, don't clear

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { writeJson } from "./lib/dataset.mjs";
import { writeSpec } from "./lib/store.mjs";
import {
  buildSpec,
  clearSampleData,
  openWorkbook,
  sanitizeConditionalFormatting,
} from "./lib/results-workbook.mjs";
import { clearQcGreenCells, parseQcBatch } from "./lib/qc-batch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    aliases: { s: "source", t: "template" },
    booleans: ["keep-data", "help"],
    defaults: {
      template: path.join("templates", "nals-results-template.xlsx"),
      spec: path.join("templates", "spec"),
    },
  });

  if (args.help) {
    console.log(
      "Usage:\n" +
        "  npm run extract:template -- --source <RESULTS.xlsx> [--keep-data]\n" +
        "  npm run extract:template -- --qc <QC_BatchA.xlsx>   # blank QC template",
    );
    return;
  }

  // QC blank-template mode: clear the green cells, keep formulas.
  if (args.qc) {
    const qcWb = await openWorkbook(args.qc);
    const qcModel = parseQcBatch(qcWb);
    const cleared = clearQcGreenCells(qcWb, qcModel);
    qcWb.calcProperties = { ...(qcWb.calcProperties || {}), fullCalcOnLoad: true };
    sanitizeConditionalFormatting(qcWb);
    const qcTemplatePath = path.resolve(ROOT, args["qc-template"] || path.join("templates", "nals-qc-template.xlsx"));
    await qcWb.xlsx.writeFile(qcTemplatePath);
    console.log(`Cleared ${cleared} QC green cells; wrote blank QC template -> ${path.relative(ROOT, qcTemplatePath)}`);
    return;
  }

  const source = requireArg(args, "source", "path to a known-good *_RESULTS_*.xlsx");
  const templatePath = path.resolve(ROOT, args.template);
  const specDir = path.resolve(ROOT, args.spec);

  console.log(`Reading ${source}`);
  const wb = await openWorkbook(source);

  const spec = buildSpec(wb);
  spec.generatedFrom = path.basename(source);
  console.log(`  version: ${spec.version || "(unknown)"}`);
  console.log(`  sheets: ${spec.sheets.length}`);
  for (const [name, m] of Object.entries(spec.instrumentSheets)) {
    console.log(`    ${name}: ${m.analytes.length} analyte cols, input rows ${m.inputRows?.start}-${m.inputRows?.end}`);
  }
  for (const [name, r] of Object.entries(spec.reportSheets)) {
    console.log(`    ${name}: ${r.parameters.length} parameters`);
  }

  const indexPath = writeSpec(specDir, spec);
  console.log(`Wrote spec -> ${path.relative(ROOT, indexPath)} (+ per-sheet parts under ${path.relative(ROOT, specDir)}/)`);

  if (!args["keep-data"]) {
    const cleared = clearSampleData(wb, spec);
    const cfRemoved = sanitizeConditionalFormatting(wb);
    await wb.xlsx.writeFile(templatePath);
    console.log(`Cleared ${cleared.cells} sample cells across ${cleared.sheets.length} sheets`);
    if (cfRemoved) console.log(`Dropped ${cfRemoved} unsupported conditional-format rule(s) (cosmetic)`);
    console.log(`Wrote blank template -> ${path.relative(ROOT, templatePath)}`);
    writeJson(path.join(ROOT, "out", "extract-template", "clear-report.json"), {
      source: path.basename(source),
      version: spec.version,
      cleared,
    });
  } else {
    console.log("--keep-data set: spec only, template not written.");
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
