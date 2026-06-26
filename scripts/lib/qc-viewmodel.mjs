// View-model shaper: flatten a BatchAnalysis (analyzeBatch/analyzeFiles output)
// into the plain, engine-free props the `qcreport/ui` components render. This is
// the single source of truth for the analysis -> component-props shaping, shared
// by every consumer (the standalone app + external hosts like the NALS report
// generator) so the prep logic never drifts from the components it feeds.
import { normalizeAnalyteLabel } from "./raw-parsers/normalize.mjs";
import { adjustedVsUnadjusted } from "./report-compute.mjs";

const NALS_ROW = /\d{4}\s*nals\s*\d+/i;

function normalize(label) {
  try {
    return normalizeAnalyteLabel(label);
  } catch {
    return label;
  }
}

/** Format an engine prep warning into a human-readable line. */
function formatPrepWarning(w) {
  if (w?.kind === "prep_row_excluded") {
    return `Excluded ${w.id} — prep/QC (${w.role}: "${w.name}"), not a client sample.`;
  }
  if (w?.kind === "name_mismatch") {
    return `Name mismatch for ${w.id}: RESULTS "${w.results}" vs HotBlock "${w.prep}".`;
  }
  return null;
}

/** Adjusted-vs-unadjusted comparison across every NALS-id run row. */
function buildAdjUnadj(analysis, samples) {
  const adjusted = analysis._conc;
  const unadjusted = analysis._unadj;
  if (!adjusted?.rows?.length || !unadjusted) return [];

  const nameById = new Map(samples.map((s) => [s.id, s.name]));
  const runSamples = adjusted.rows
    .filter((r) => NALS_ROW.test(r.label))
    .map((r) => ({ id: r.label, name: nameById.get(r.label) || r.label }));
  if (!runSamples.length) return [];

  try {
    const rows = adjustedVsUnadjusted(adjusted, unadjusted, runSamples);
    return rows.map((r) => ({
      id: String(r.id ?? ""),
      sample: String(r.sample ?? r.id ?? ""),
      analyte: String(r.analyte ?? ""),
      adjusted: r.adjusted ?? null,
      unadjusted: r.unadjusted ?? null,
      diff: typeof r.diff === "number" ? r.diff : null,
      ratio: typeof r.ratio === "number" ? r.ratio : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Shape a BatchAnalysis into the QC view-model: everything the `qcreport/ui`
 * components need, plus meta (sources/version/role-hints/prep-warnings/summary)
 * a host shell shows around them. Pure — no fs/fetch/DOM.
 */
export function buildQcViewModel(analysis) {
  const samples = (analysis.samples ?? []).map((s) => ({
    id: String(s.id),
    name: (typeof s.name === "string" && s.name.trim()) || String(s.id),
  }));

  const rawChecks = analysis.qc?.checks ?? [];
  const checks = rawChecks.map((c) => ({
    key: String(c.key),
    role: String(c.role ?? c.key),
    kind: String(c.kind ?? ""),
    results: (c.results ?? []).map((r) => ({
      analyte: String(r.analyte),
      norm: normalize(String(r.analyte)),
      reportable: r.reportable,
      metric: typeof r.metric === "number" ? r.metric : r.metric == null ? null : Number(r.metric) || null,
      unit: r.unit == null ? undefined : String(r.unit),
      status: String(r.status ?? "NA"),
      note: r.note == null ? undefined : String(r.note),
    })),
  }));

  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    for (const r of c.results) {
      if (r.status === "PASS") pass += 1;
      else if (r.status === "FAIL") fail += 1;
    }
  }

  const prepEntries = analysis.prep?.entries ?? [];
  const prepWarnings = (analysis.prep?.warnings ?? []).map(formatPrepWarning).filter(Boolean);

  return {
    sources: analysis.sources ?? {},
    version: analysis.version ?? "",
    samples,
    checks,
    reportableAnalytes: analysis.reportableAnalytes ?? [],
    matrix: analysis.reportMatrix ?? [],
    adjUnadj: buildAdjUnadj(analysis, samples),
    prepEntries,
    qcRoleHints: analysis.qcRoleHints ?? [],
    prepWarnings,
    summary: { pass, fail },
  };
}
