# NALS Water Report Pipeline

How the lab's manual Excel process maps to this tool, the verified calculation
logic, the commands, and what is implemented vs. planned.

## The manual process (what we are reproducing)

1. Instruments export raw data: **ICPOES** (`Conc` sheet, .xlsx), **IC / ICPMS /
   ICPQQQ** (.xls), **pH / EC / Turbidity** and **bacteria** (PDFs).
2. An analyst **copy/pastes** each instrument's values into the master
   calculation workbook `*_RESULTS_*_OES.xlsx` (template
   `NALS_WATERPACKAGEDATA_XL_…`), into the blue input cells.
3. The workbook's formulas compute reportable values per sample, and
   `REPORT DATA` assembles the parameter × sample matrix.
4. The analyst copy/pastes one sample's column into a **Water Analysis Report**
   (`.docx` → `.pdf`), rounding to ~3 significant figures.

## Verified calculation logic

The calculation workbook structure (confirmed against real files and reproduced
in code with **100% agreement** — see "Validation"):

- **Input sheets** (`ICPOES/ICPMS/ICPQQQ/IC RESULTS`): raw values pasted into a
  blue band (rows ~18–62, one analyte per column). A reportable region below
  (rows ~69–114) applies, per cell:

  ```
  blank            -> "NO DATA"
  contains "Uncal" -> "Uncal"            (ICPOES only)
  contains "o"/"####" -> "over-range"    (ICPOES only)

### Over-range values and dilution reruns

An over-range straight run is not automatically a re-run: the same sample is usually
also on the tray at 10× or 100×. `ingestInstrument` substitutes the least-diluted
rerun that can answer, under two rules:

- The rerun's `Conc` is **already dilution-corrected by the instrument**, so it is used
  as-is and never multiplied by the factor again. Verified on a real batch — calcium
  read within 1% of its straight run at both 10× and 100×.
- The **reporting limit scales with the dilution**, so a reading below `limit × factor`
  is refused. Below that the analyte is not measurable at that dilution and the value
  is noise multiplied up: in the same batch, mercury's 100× rerun came out at 229 µg/L
  against a straight-run 1.6, purely from scaling a reading under the 7 µg/L limit.

What could not be answered is returned in `analysis.ingest.overRangeFlagged` with an
`over_range_needs_review` warning; what was answered is listed in
`overRangeResolutions` with the dilution factor used. Pass `--no-resolve-dilutions`
to leave every over-range value flagged instead.
  value < DL (row 63) or non-numeric -> "<DL" label (row 64)
  otherwise        -> the value
  ```

  Detection limits are per-analyte (row 63) with matching `<DL` display strings
  (row 64). A text DL such as `"n/a"` forces the label (Excel: `number < text`
  is TRUE).

- **Direct sheets** (`PHYSICAL/BIOLOGICAL RESULTS`): values entered/read directly
  (pH, EC, turbidity, coliforms…). **Hardness** is computed:
  `2.497·Ca + 4.118·Mg` (mg CaCO₃/L) from ICPOES.

- **REPORT DATA**: per parameter, `C`=name, `D`=units, `E`=CDWQ guideline (both
  from `CODES`), and `F`=a spilling `TRANSPOSE` array formula pulling that
  parameter's reportable column across the sample columns. The array master is
  in column F (sample 1), spilling right. Metals rows switch instrument source
  via the column-A dropdown (`ICPOES`/`ICPMS`/`ICPQQQ`).

- **Word report** = `REPORT DATA` filtered to one client-sample column, rounded.

## Commands

```bash
# Phase 1a (one-time): blank template + machine-readable spec from a real workbook
npm run extract:template -- --source "<…RESULTS…OES.xlsx>"

# Phase 1b: render a populated calc workbook (live formulas) from the template
npm run reexport:workbook -- --from-workbook "<…RESULTS…OES.xlsx>"   # round-trip
npm run reexport:workbook -- --dataset out/ingest/dataset.json --name run.xlsx

# Phase 1c: re-implement formulas in code and cross-check vs Excel's cached values
npm run compute:report -- --source "<…RESULTS…OES.xlsx>"

# Phase 2a: ingest raw instrument exports -> sample datasets (ICPOES + IC + QC)
npm run ingest:raw -- --roster "<…RESULTS…OES.xlsx>" --source-root "<…/<sample> RW>" \
                      [--icpoes-conc <OES.xlsx>] [--ic <IC.xls>] \
                      [--qc "<…QC_BatchA…OES.xlsx>"] \
                      [--validate "<…RESULTS…OES.xlsx>"] [--no-resolve-dilutions]

# Control-chart QA report (Shewhart, Digest LFB) over an optional date window
npm run analyze:control-chart -- --source "<…ControlChart…xlsx>" [--from YYYY-MM-DD] [--to YYYY-MM-DD]

# tests
npm test
```

## Control charts (Shewhart, Digest LFB)

A separate trending utility (CLI + app tab). The Digest LFB recovery the QC engine
computes is the same value plotted on the `NALS_DIGEST_LFB_…_ControlChart` workbook:
per element, the LFB measured value per batch over the year, with center line = mean
(non-zero) and control limits at ±1σ/±2σ/±3σ. `scripts/lib/control-chart.mjs`
reproduces the workbook's stats exactly (mean/std verified to 10 dp) and adds
date-window filtering; `analyze:control-chart` writes per-element stats +
out-of-control / warning batches. In the app, the **Control Charts** tab loads a
ControlChart workbook, lets you pick an element and time period, and renders the
chart (SVG); dropping raw ICPOES runs appends their LFB as new highlighted points.

## QA reporting

- `compute:report` — engine vs Excel cross-check (100% on reportable cells).
- `ingest:raw --validate` — reconstructed inputs vs the analyst's pasted values.
- QC engine — vs the QC workbook (220/222 blank, 508/529 recovery).
- `analyze:control-chart` — out-of-control (beyond 3σ) and warning (beyond 2σ) batches.
- `npm test` — 28 vitest fixtures (formula-engine, qc-engine, control-chart).

## Validation (real data)

Run on `2026NALS02604 RW` and `2026NALS02621 RW`:

- **Re-export (1b):** all 1784 input cells round-trip with **0 diffs**; reportable
  formulas, `TRANSPOSE` array formulas, and instrument dropdowns preserved
  (9811 formulas). `fullCalcOnLoad` is set so Excel recalculates on open.
- **Engine vs Excel (1c):** **8235/8235 reportable cells match (100%)** on both
  workbooks. REPORT DATA mapping: 100% on populated values (the only diffs are
  Excel's own blank-vs-cached-0 storage quirks on empty cells).
- **Raw ingest (2a, ICPOES):** **8/8 client samples matched**; **97.6%** of the
  analyst's pasted cells reconstructed automatically from the raw `Conc` file
  (analytes matched by label, samples by NALS id). The remaining ~2.4% are
  over-range cells where the analyst used to substitute a dilution rerun by hand;
  these are now substituted automatically (see below), and only the ones no usable
  dilution can answer are flagged for review.
- **Raw ingest (2a, IC):** anions matched by name, samples by NALS # + descriptive
  name; CDet detector primary, UV fallback for `n.a.` cells. The reported sample
  (Kitchen) reconstructs **7/7 anions exactly**. Note: a shared IC batch covers
  several reports, so which samples' IC a given report includes is an editorial
  choice — the tool fills all available raw data and labels anything the analyst
  left blank as "extra", rather than guessing scope.

## Data storage (modular — index + parts, not monolithic)

Each generator writes an `index.json` that references small per-sheet / per-instrument
part files, so artifacts stay navigable, diff-friendly, and independently regenerable:

```
templates/spec/                 # from extract:template
  index.json                    # version, sheet list, primaryReportSheet, refs -> parts
  instruments/<sheet>.json       # one file per ICPOES/ICPMS/ICPQQQ/IC RESULTS
  reports/<sheet>.json           # one file per REPORT DATA variant

out/ingest-<id>/                # from ingest:raw — one dataset per target workbook
  results/                       # the RESULTS (non-QC) workbook dataset
    index.json                   # version, source, samples, cellParts -> parts, counts
    cells/<sheet>.json           # e.g. icpoes-results.json, ic-results.json ({ref,value})
    dropdowns.json
  qc/                            # the QC BatchA workbook dataset (separate)
    index.json
    cells/batch.json
  warnings.csv  validation.json
```

`store.mjs` centralises this: `writeSpec/readSpec`, `writeDataset/readDataset`. Readers
reassemble the parts into the same in-memory objects the rest of the code uses, and also
accept a legacy flat `.json` for back-compat.

## Module map (all logic in small, single-purpose modules)

```
scripts/extract-template.mjs    1a CLI
scripts/reexport-workbook.mjs   1b CLI
scripts/compute-report.mjs      1c CLI
scripts/ingest-raw.mjs          2a CLI
scripts/lib/
  cli.mjs              arg parsing
  sheet-utils.mjs      cell value/ref helpers, shared-formula resolver, formula translation
  results-workbook.mjs workbook domain model: classify sheets, parse reportable
                       formulas, build spec, sample roster, clear/inject bands
  report-map.mjs       parse REPORT DATA -> parameters + source mapping (layout auto-detect)
  formula-engine.mjs   pure reportable decision tree, hardness, rounding, valuesMatch
  compute.mjs          cross-checks (engine vs cached; report mapping vs cached)
  sample-dataset.mjs   extract/inject the bridge dataset
  dataset.mjs          JSON/CSV writers
  ingest.mjs           generic instrument ingestion + ICPOES/IC wrappers
  qc-batch.mjs         QC BatchA parse + ingest (Unadjusted QC data -> GREEN cells)
  qc-engine.mjs        QC equations in code (blank/recovery/RPD + acceptance ranges)
  control-chart.mjs    Shewhart stats, date-window series, RAW DATA parser
  report-compute.mjs   forward report-matrix + client-sample detection (app preview)
  sample-match.mjs     flexible sample matcher (exact id / NALS#+name)
  store.mjs            modular index+parts read/write (spec + dataset)
  raw-parsers/
    normalize.mjs      label/id normalisation, dilution helpers
    icpoes-conc.mjs    ICPOES Conc / Unadjusted (.xlsx) parser
    ic-cdet.mjs        IC CDet/UV (.xls, SheetJS) parser
```

## Status

| Capability | State |
|---|---|
| 1a extract template + spec | ✅ done, all report variants parsed |
| 1b re-export live-formula workbook | ✅ done, round-trip verified |
| 1c formula engine + cross-check | ✅ done, 100% engine match |
| 2a ICPOES raw ingest | ✅ done, 97.6% reconstruction |
| 2a IC raw ingest (.xls) | ✅ done, reported sample 7/7 anions |
| 2a QC BatchA ingest | ✅ done — 12/12 QC rows matched; unique-label rows exact, recurring-label rows (IPC Blank/CCV) flagged |
| modular data storage (index + parts) | ✅ done — spec + dataset split via store.mjs |
| 2a ICPMS / ICPQQQ (.xls) parsers | ⛔ next — element/transition label matching (ambiguous; needs care) |
| 2a physical / biological inputs | ⛔ next — manual CSV; PDF parse later |
| QC engine in code (qc-engine.mjs) | ✅ done — blank/recovery/RPD; vs workbook 220/222 blank, 508/529 recovery |
| client-side app (Vite+React, no server) | ✅ done — drop raw → QC panel + RESULTS preview + download both books (`app/`) |
| control-chart utility (Shewhart, date-windowed) | ✅ done — `analyze:control-chart` CLI + app "Control Charts" tab; stats match workbook exactly |
| QA reporting + vitest + docs | ✅ done — cross-checks + validation + out-of-control report; 28 tests |
| 2b Word report generation | ⛔ next — fill a .docx template per client sample |
| over-range dilution policy | ✅ automatic, limit-guarded; verified 8/8 against a real batch |
| per-report instrument scope | ⚠️ tool fills all available raw data; "extra" cells flagged |

## Notes & limits

- Conditional formatting (blue input / red over-range highlighting) is dropped on
  re-export — exceljs cannot round-trip the extension rules. Cosmetic only;
  formulas are intact.
- Re-extract the template when the workbook REV version changes (the version
  string in `INSTRUCTIONS!A3` is surfaced in the spec and CLI output).
- `out/` and any real lab/client data are git-ignored; only the blank template
  (no client data) and code are committed.
