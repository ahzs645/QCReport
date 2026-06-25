#!/usr/bin/env node
// Control-chart QA report. Reads a Digest-LFB ControlChart workbook, and for each
// charted element computes the Shewhart stats (mean, σ, ±1/2/3σ limits) over an
// optional date window, flagging out-of-control batches (beyond 3σ) and warnings
// (beyond 2σ).
//
// Usage:
//   npm run analyze:control-chart -- --source "<…ControlChart…xlsx>" [--from YYYY-MM-DD] [--to YYYY-MM-DD]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { writeCsv, writeJson } from "./lib/dataset.mjs";
import { openWorkbook } from "./lib/results-workbook.mjs";
import { buildSeries, getChartedElements, parseControlChartRawData } from "./lib/control-chart.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d) : "");

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    aliases: { s: "source", o: "output" },
    booleans: ["help"],
    defaults: { output: path.join("out", "control-chart") },
  });
  if (args.help) {
    console.log("Usage: npm run analyze:control-chart -- --source <ControlChart.xlsx> [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
    return;
  }
  const source = requireArg(args, "source", "path to a *_ControlChart_*.xlsx");
  const outDir = path.resolve(ROOT, args.output);

  const wb = await openWorkbook(source);
  const rawData = parseControlChartRawData(wb);
  const elements = getChartedElements(wb).filter((e) => e.label);
  console.log(`${path.basename(source)} — ${rawData.variable}, ${rawData.batches.length} batches, ${elements.length} charted elements`);
  if (args.from || args.to) console.log(`  window: ${args.from || "…"} → ${args.to || "…"}`);

  const summary = [];
  const flagged = [];
  for (const el of elements) {
    const s = buildSeries(rawData, el.label, { from: args.from || null, to: args.to || null });
    if (!s.limits) continue;
    const out = s.points.filter((p) => p.status === "out");
    const warn = s.points.filter((p) => p.status === "warn");
    summary.push({
      element: el.name,
      label: el.label,
      n: s.stats.n,
      mean: s.stats.mean,
      std: s.stats.std,
      ucl3: s.limits.sigma3.upper,
      lcl3: s.limits.sigma3.lower,
      outOfControl: out.length,
      warnings: warn.length,
    });
    for (const p of [...out, ...warn]) {
      flagged.push({ element: el.name, label: el.label, file: p.file, date: isoDate(p.date), value: p.value, status: p.status });
    }
  }

  writeJson(path.join(outDir, "control-chart-summary.json"), { source: path.basename(source), variable: rawData.variable, window: { from: args.from || null, to: args.to || null }, summary });
  if (flagged.length) writeCsv(path.join(outDir, "out-of-control.csv"), flagged);
  writeCsv(path.join(outDir, "control-chart-summary.csv"), summary);

  const totalOut = summary.reduce((s, e) => s + e.outOfControl, 0);
  const totalWarn = summary.reduce((s, e) => s + e.warnings, 0);
  console.log(`Wrote summary -> ${path.relative(ROOT, path.join(outDir, "control-chart-summary.json"))}`);
  console.log(`Across all elements: ${totalOut} out-of-control, ${totalWarn} warning point(s)` + (flagged.length ? " -> out-of-control.csv" : ""));
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
