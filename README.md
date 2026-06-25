# QCReport

Tooling for the NALS (Northern Analytical Laboratory Services, UNBC) water-analysis workflow.

The client-side app lives in [`app/`](app/) (Vite + React, no server). See [`app/README.md`](app/README.md)
to run it; it deploys to GitHub Pages via `.github/workflows/deploy-pages.yml`.

It makes the existing manual Excel process repeatable in code, in two staged capabilities:

1. **Re-export the calculation workbook** — regenerate the `*_RESULTS_*.xlsx` calculation
   workbook (template `NALS_WATERPACKAGEDATA_XL_…`) from a blessed blank template, faithfully
   preserving its formulas, lookup tables, and detection limits.
2. **Recreate from the original source** — ingest the raw instrument exports directly, compute
   the reportable values (re-implementing the workbook's formulas), and generate the per-sample
   Water Analysis Report — removing the manual copy/paste step.

See [`docs/pipeline.md`](docs/pipeline.md) for the full data-flow and the verified calculation
logic. The architecture mirrors the `RotationManager` workbook-extraction tooling.

## The chain

```
raw instrument exports          calculation workbook (.xlsx)            report
─────────────────────           ────────────────────────────           ──────────────────────
ICPOES "Conc" (.xlsx)  ─┐        INPUT sheets (blue cells)              Water Analysis Report
IC / ICPMS / ICPQQQ ────┼─paste→ ICPOES/ICPMS/ICPQQQ/IC RESULTS  ─┐     (.docx → .pdf), one per
pH / EC / Turb (PDF) ───┤        PHYSICAL / BIOLOGICAL RESULTS    │     client sample, = REPORT
Bacteria (PDF) ─────────┘                │ per-sample formulas    │     DATA filtered to one
                                         ▼                        │     sample column, rounded
                                 REPORT DATA matrix  ─────────────┴──→  to ~3 sig figs.
                                 (TRANSPOSE spills, CODES lookups,
                                  instrument-source dropdowns)
```

## Layout

```
templates/   blessed blank workbook + machine-readable spec + report .docx template
scripts/     thin CLI entrypoints (arg parsing + orchestration only)
scripts/lib/ all logic, as small single-responsibility modules:
             cli, sheet-utils, results-workbook, formula-engine, dataset,
             report-fill, raw-parsers/<instrument>, mapping.config.json
out/         generated datasets, re-exports, reports, QA (git-ignored)
test/        vitest fixtures (formula-engine decision tree, rounding)
```

## Commands

```bash
# Phase 1a — one-time: derive the blank template + spec from a known-good RESULTS workbook
npm run extract:template -- --source "/path/to/…RESULTS…OES.xlsx"

# Phase 1b — render a populated calculation workbook from the template + a sample set
npm run reexport:workbook -- --samples out/.../dataset.json --output out/reexports

# Phase 1c — compute reportable values in code and cross-check vs the workbook's cached values
npm run compute:report -- --source "/path/to/…RESULTS…OES.xlsx"

# Phase 2a — ingest raw instrument exports into one normalized dataset
npm run ingest:raw -- --source-root "/path/to/<sample> RW" --output out/ingest

# Phase 2b — generate the Word report(s) from computed values
npm run generate:report -- --dataset out/ingest/dataset.json --output out/reports
```

## Notes

- `out/` and any real lab/client data are git-ignored. Only the blank template (no client data)
  and code are committed.
- The blank template must be re-extracted when the workbook REV version changes; the version
  string (`INSTRUCTIONS!A3`) is surfaced in the spec and outputs.
