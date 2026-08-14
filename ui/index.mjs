// Optional React component library for the QCReport QC views — the single source
// of truth for rendering the quality-check tables/cards/charts. PURE / presentational:
// every component renders from props only and imports NO engine code, so a host app
// can render them without pulling exceljs/xlsx/jszip into its bundle. React is a
// PEER dependency (the host's React compiles this source). Compute lives in the
// headless engine (the package root, "qcreport"); this subpath is just the views.
//
//   import { QcPanel, ResultsPreview, AdjUnadjPanel, RackView } from "qcreport/ui";
//   import "qcreport/ui/styles.css";   // class styles, themeable via --qc-* variables
//
// Theme by overriding the --qc-* custom properties on a wrapping element.
//
// PresetsReference renders the constants the calculations use; feed it the light,
// engine-free "qcreport/presets" subpath (never the barrel):
//
//   import * as presets from "qcreport/presets";
//   <div className="qcreport-ui"><PresetsReference presets={presets} /></div>

export { QcPanel } from "./QcPanel.jsx";
export { ResultsPreview } from "./ResultsPreview.jsx";
export { AdjUnadjPanel } from "./AdjUnadjPanel.jsx";
export { RackView } from "./RackView.jsx";
export { ControlChart } from "./ControlChart.jsx";
export { ControlChartSvg } from "./ControlChartSvg.jsx";
export { PresetsReference } from "./PresetsReference.jsx";
