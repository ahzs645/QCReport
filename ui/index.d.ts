// Types for the qcreport/ui presentational components. These also define the
// data CONTRACT a host's data-prep must satisfy — import them to keep your
// bridge's output shape aligned with what the components render.
import type { ReactElement } from "react";
import type { ControlPoint, ControlSeries, ReportMatrixRow } from "qcreport";

export type { ReportMatrixRow, ControlSeries, ControlPoint };

/** PASS / FAIL / NA (the engine may emit other free-text statuses). */
export type QcStatus = "PASS" | "FAIL" | "NA" | string;

/** One analyte's result under a single QC check. */
export interface QcCheckResultView {
  analyte: string;
  /** Normalized analyte label — used by the "reportable only" filter. */
  norm: string;
  reportable: number | string | boolean;
  metric: number | null;
  unit?: string;
  status: QcStatus;
  note?: string;
}

/** A QC check (a role × kind), e.g. Digest LFB recovery, or Duplicate RPD. */
export interface QcCheckView {
  key: string;
  role: string;
  /** "blank" | "rpd" | "recovery" (the engine may add others). */
  kind: string;
  results: QcCheckResultView[];
}

export interface QcChecks {
  checks: QcCheckView[];
}

/** One row of the adjusted-vs-unadjusted dilution comparison. */
export interface AdjUnadjRow {
  id: string;
  sample: string;
  analyte: string;
  adjusted: number | string | null;
  unadjusted: number | string | null;
  diff: number | null;
  ratio: number | null;
}

/** A prep/rack cross-reference entry (HotBlock digestion / Labels workbook). */
export interface PrepEntryView {
  key: string;
  id: string;
  sampleName?: string;
  prepRole?: string;
  position?: string | number;
  rack?: { column: number; row: number } | null;
  amount?: string | number | null;
  acid?: string;
  comments?: string;
}

export interface SampleLite {
  id: string;
  name: string;
}

export function QcPanel(props: { qc: QcChecks; reportableAnalytes?: string[] }): ReactElement | null;
export function ResultsPreview(props: { matrix: ReportMatrixRow[]; samples: SampleLite[] }): ReactElement | null;
export function AdjUnadjPanel(props: { rows: AdjUnadjRow[]; reportableAnalytes?: string[] }): ReactElement | null;
export function RackView(props: { entries: PrepEntryView[] }): ReactElement | null;
export function ControlChart(props: { series: ControlSeries; title?: string; showLine?: boolean }): ReactElement | null;
export function ControlChartSvg(props: {
  series: ControlSeries;
  points: Array<ControlPoint & { id: number }>;
  showLine?: boolean;
  selected: number | null;
  onSelect: (id: number) => void;
}): ReactElement | null;
