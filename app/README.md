# Water Report App — client-side QC + RESULTS

A fully client-side (no server) Vite + React app. Drop the raw ICPOES export and it
runs the **quality check in code** (the QC equations are re-implemented in JS — not
read from the Excel workbook's formulas), shows it in the UI, and generates the
populated **RESULTS** and **QC** workbooks for download.

## Run

```bash
cd app
npm install        # react, vite, exceljs, xlsx
npm run dev        # http://localhost:5173
npm run build      # static bundle in app/dist (open/host anywhere — no server)
npm run preview    # preview the built bundle
```

## Two tabs

- **Quality Check & Results** — drop the raw ICPOES export; see the QC panel + RESULTS
  preview and download the populated RESULTS and QC workbooks.
- **Control Charts** — a trending utility: load a Digest-LFB ControlChart workbook
  **or paste RAW DATA rows from Excel**, pick an element and a time period, and view the
  Shewhart chart (center line, ±1/2/3σ bands, out-of-control points). Drop raw runs too
  to append their LFB as new points.

## How it works

- All logic is the shared engine in `../scripts/lib/*` (pure, browser-portable).
  Vite bundles `exceljs` + `xlsx` (SheetJS) browser builds; nothing runs server-side.
- Files are read as `ArrayBuffer` → `loadWorkbook` (exceljs `.load`). Outputs are
  produced with `workbook.xlsx.writeBuffer()` → `Blob` → download.
- Bundled blank templates live in `public/templates/` (RESULTS + QC). The spec and
  QC structure are derived in-browser from these via `buildSpec` / `parseQcBatch`.

## Input

- **Raw ICPOES export** — required (a workbook with a `Concentration` sheet).
- **RESULTS workbook** — optional; supplies friendly sample names.
- **QC workbook** — optional; supplies the exact QC role→sample mapping for a run.

Files are classified by their sheets, so you can drop any combination.

## Layout

```
src/
  App.jsx                  orchestration + status
  core/pipeline.js         the only browser-specific glue (load files, run engine, download)
  components/
    DropZone.jsx  QcPanel.jsx  ResultsPreview.jsx  DownloadBar.jsx
public/templates/          bundled blank RESULTS + QC workbooks
```

## Notes

- The QC panel computes blank PASS/FAIL, recovery (`measured/true×100`), and RPD; it
  reproduces the workbook's results (e.g. the Sodium LRB FAIL) — validated against the
  real QC workbook. Recovery acceptance ranges are editable in
  `../scripts/lib/qc-engine.mjs` (`DEFAULT_QC_CRITERIA`).
- Over-range values surface as `over-range`; the dilution substitution is a manual
  analyst judgement (see the CLI's `--resolve-dilutions`).
