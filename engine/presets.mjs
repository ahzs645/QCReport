// Public "presets" surface — the encoded constants the calculations use, as a
// LIGHT, side-effect-free subpath so a host app can render the preset/reference
// page without pulling the full engine barrel (and with it exceljs / xlsx /
// jszip) into its always-loaded bundle.
//
//   import * as presets from "qcreport/presets";
//   import { PresetsReference } from "qcreport/ui";
//   <PresetsReference presets={presets} />
//
// The four source modules re-exported below are browser-safe and their only
// transitive imports are the dependency-free sheet-utils.mjs and
// raw-parsers/normalize.mjs — keep it that way: nothing here may import the
// barrel (engine/index.mjs) or any module that reaches a spreadsheet library.
//
// These are the ENCODED FALLBACKS. When a workbook is loaded, parseQcCriteria()
// (from the main "qcreport" entry) reads the live values off its CODES sheet and
// those win; pass the parsed object to <PresetsReference criteria={...} />.

// Per-cell reportable decision tree, flag codes and hardness coefficients.
export { REPORTABLE_RULES, DEFAULT_FLAGS, HARDNESS_COEFFICIENTS } from "../scripts/lib/formula-engine.mjs";

// QC acceptance criteria + the per-role check definitions and their labels.
export { DEFAULT_QC_CRITERIA, QC_CHECKS, QC_KINDS, QC_ROLE_LABELS } from "../scripts/lib/qc-engine.mjs";

// Control-chart math description (Shewhart, Digest LFB).
export { CONTROL_CHART_INFO } from "../scripts/lib/control-chart.mjs";

// How raw instrument rows are matched to workbook samples/analytes.
export { MATCH_INFO } from "../scripts/lib/sample-match.mjs";
