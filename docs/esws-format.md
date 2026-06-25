# The Agilent ICP Expert `.esws` format (reverse-engineered)

`.esws` is the native worksheet file written by **Agilent ICP Expert** (the
ICP-OES software; instruments like the 5800/5900). Each lab run is saved as one
`.esws`, and ICP Expert can additionally **Export to Excel** to produce the
`.xlsx` ("Raw Data" / "Unadjusted Conc" sheets) that `icpoes-conc.mjs` reads.
Parsing the `.esws` directly removes that manual export step.

This document records what we found by inspecting two real files
(`…Apr_13_2026.esws`, 7.8 MB; `…Jun_15_2026.esws`, 17 MB). There is **no public
spec or SDK** for `.esws` — Agilent does not document it.

## Container: a ZIP of .NET-serialized parts

A `.esws` is a ZIP archive (Open Packaging Convention: it carries a
`[Content_Types].xml`). Its parts have **no file extension** and are **.NET
`BinaryFormatter` payloads** — i.e. [MS-NRBF] "Remoting Binary Format" object
graphs, *not* text/XML. The serialized assemblies are `Agilent.Worksheet.Storage`
and `Varian.MPExpert.*` (Varian = ICP Expert's lineage).

Entry groups (526 parts in the smaller file):

| Part(s) | Contents |
| --- | --- |
| `Summary` | worksheet metadata (version, owner, instrument serial, QC enabled) |
| `Method/NewElementWavelengths` | **the analyte list** (111 element-wavelengths) |
| `Method/NewHiddenElementWavelengths` | hidden analytes |
| `Method/SampleSolutionDefinitions` | **the sample sequence** (labels, dilution, weight, volume) |
| `Method/StandardSolutionDefinitions`, `QCSolutionDefinitions`, `IECStandardSolutionDefinitions` | standards / QC / IEC sequence entries (same shape) |
| `ResultsNew/WithoutRecalc/Solutions/Solution0…N` | **per-solution measured results** (one part per run) |
| `ResultsNew/HiddenElementWavelengths/Measurements/*` | hidden-line diagnostics |
| `Results/Spectrum/<GUID>` | raw spectra (large; not needed for the conc table) |
| `IntelliQuant/*` | IntelliQuant semi-quant screening |

We read only the **bold** groups; spectra and IntelliQuant are skipped.

## Reading MS-NRBF

`scripts/lib/raw-parsers/nrbf.mjs` is a from-scratch, browser-portable
[MS-NRBF] reader (no JS/npm library for this format exists; the only readers are
.NET-only — `System.Formats.Nrbf`, `bbowyersmyth/BinaryFormatDataStructure`). It
follows the same "decode the record graph, never instantiate types" approach the
modern .NET reader uses. It handles: `SerializationHeader`, `BinaryLibrary`,
`BinaryObjectString`, `ClassWithMembersAndTypes` / `SystemClassWithMembersAndTypes`
/ `ClassWithId`, `MemberPrimitiveTyped`, `MemberReference`, `ObjectNull(+Multiple)`,
`ArraySinglePrimitive/Object/String`, `BinaryArray`, `MessageEnd`. It returns a
map of `objectId → object`, with `{__ref}` placeholders resolved against that map.

## The object graph we use

```
NewElementWavelengthDataType        (Method/NewElementWavelengths → array)
  Id                  ← analyte key (join target)
  ElementSymbol       "Ag"
  Wavelength.value    328.068      → label "Ag 328.068 nm"
  CalibrationRange.Maximum         → over-range threshold (see caveat)
  ConcentrationUnit

SolutionDefinitionDataType          (Method/*SolutionDefinitions → array)
  Key                 GUID         ← join target for results
  Name                "2026NALS02701 A01" / "Rinse" / "CCV 500ppb"
  Dilution, Weight, Volume         → adjustment factor

NewSolutionData                     (ResultsNew/WithoutRecalc/Solutions/SolutionN)
  SolutionDefinitionKey → SolutionDefinitionDataType.Key (→ the row label)
  Measurements[] : NewMeasurementDataType
    ElementWavelengthId → NewElementWavelengthDataType.Id (→ the column)
    ConcentrationCalculator.average   = ADJUSTED concentration ("Raw Data")
    Replicates[] : NewReplicateDataType
      Concentration                        (per-rep adjusted)
      ConcentrationPreWeightVolumeDilution (per-rep unadjusted)
      OverrangeFlag                        (enum; not the displayed "o" — see caveat)
```

## Reconstructing the concentration table

For each `SolutionN`:

- **label** = `SampleSolutionDefinitions[…].Name` via `SolutionDefinitionKey`.
- For each measurement, **column** = analyte via `ElementWavelengthId → Id`.
- **adjusted** value = `ConcentrationCalculator.average`.
- **unadjusted** value = `adjusted / (Dilution × Volume/Weight)`.
  (For direct water samples `Weight = Volume = 1`, so this is `adjusted /
  Dilution`. For digestions, e.g. `Weight 0.15 g`, `Volume 15 mL`, the factor is
  `Dilution × 100`.)
- **over-range `o`** ⟺ `unadjusted > CalibrationRange.Maximum`.

## Validation (vs the sibling `.xlsx`, free ground truth)

Every `.esws` is saved next to its `.xlsx` export, so we cross-checked the parser
against the `Raw Data` (adjusted) and `Unadjusted Conc` sheets of both files:

| | Adjusted | Unadjusted | Over-range `o` |
| --- | --- | --- | --- |
| File 1 (7.8 MB) | 5150/5150 | 5150/5150 | 61/61 |
| File 2 (17 MB) | 10061/10061 | 10061/10061 | 152/153 |

All **15,211 concentration values are exact**; over-range is **213/214**.

### Known caveat — the over-range `o` flag

The displayed `o` means "above the top calibration **standard**", which sits ~10%
below `CalibrationRange.Maximum` (the curve's curvature limit). Using `calMax` is
**conservative**: it produced **zero false positives**, and the single miss
(`Te 182.153` at `1.0962`, below `calMax 1.1`) is a value in that 10% headroom
band. Exact parity would require parsing per-analyte standard concentrations from
`Method/Standards`. The concentration values themselves are unaffected.

## Where this lives

- `scripts/lib/raw-parsers/nrbf.mjs` — the MS-NRBF reader.
- `scripts/lib/raw-parsers/icpoes-esws.mjs` — `.esws` → `{ analytes, rows }`
  (the same contract as `icpoes-conc.mjs`, so it can later feed the same ingest
  path as an alternative ICPOES source).
- `app/src/views/EwsParserView.jsx` + `app/src/core/esws.js` — the standalone
  **EWS Parser** tab (unzip + decode in-browser, table + CSV/JSON export).
- `test/nrbf.test.mjs` — round-trip test of the reader on a synthetic stream.
