// Types for the qcreport/ui presentational components. The data shapes (the
// CONTRACT a host's data-prep must satisfy) are defined once in the engine
// (see buildQcViewModel) and re-exported here for convenience.
import type { ReactElement } from "react";
import type {
  AdjUnadjRow,
  ControlPoint,
  ControlSeries,
  PrepEntryView,
  QcChecks,
  QcCheckResultView,
  QcCheckView,
  QcStatus,
  ReportMatrixRow,
  SampleLite,
} from "qcreport";
// The preset constants come from the light, engine-free subpath.
import type { PresetBundle, QcCriteria } from "qcreport/presets";

export type { PresetBundle, QcCriteria };

export type {
  AdjUnadjRow,
  ControlPoint,
  ControlSeries,
  PrepEntryView,
  QcChecks,
  QcCheckResultView,
  QcCheckView,
  QcStatus,
  ReportMatrixRow,
  SampleLite,
};

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
export function PresetsReference(props: {
  /** The `qcreport/presets` module namespace (`import * as presets from "qcreport/presets"`). */
  presets: PresetBundle;
  /** Live criteria parsed off a loaded workbook; defaults to presets.DEFAULT_QC_CRITERIA. */
  criteria?: QcCriteria;
}): ReactElement | null;
