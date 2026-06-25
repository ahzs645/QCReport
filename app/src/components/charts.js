// Chart-style indirection: the EWS plots come in two interchangeable renderers
// with identical props — "rich" (Recharts) and "classic" (hand-rolled SVG).
// The rich set is lazy-loaded (its own chunk with Recharts) so the rest of the
// app and Classic mode never download the charting library.
import React from "react";
import * as Classic from "./EwsCharts.jsx";
import ControlChartSvg from "./ControlChartSvg.jsx";

export const CHART_STYLES = [
  { id: "rich", label: "Rich" },
  { id: "classic", label: "Classic" },
];

// Rich renderers are lazy-loaded; Vite groups Recharts into a shared chunk that
// only downloads when a Rich chart is actually shown.
const RichCalibration = React.lazy(() => import("./EwsChartsRich.jsx").then((m) => ({ default: m.CalibrationPlot })));
const RichSpectrum = React.lazy(() => import("./EwsChartsRich.jsx").then((m) => ({ default: m.SpectrumPlot })));
const RichControl = React.lazy(() => import("./ControlChartRich.jsx"));

export function getCharts(style) {
  return style === "classic"
    ? { CalibrationPlot: Classic.CalibrationPlot, SpectrumPlot: Classic.SpectrumPlot }
    : { CalibrationPlot: RichCalibration, SpectrumPlot: RichSpectrum };
}

/** The control-chart plot component for the given style. */
export function getControlPlot(style) {
  return style === "classic" ? ControlChartSvg : RichControl;
}

const STORE_KEY = "chartStyle"; // shared app-wide (EWS + Control Charts)

export function loadChartStyle() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return CHART_STYLES.some((s) => s.id === v) ? v : "rich";
  } catch {
    return "rich";
  }
}

export function saveChartStyle(style) {
  try { localStorage.setItem(STORE_KEY, style); } catch { /* ignore */ }
}
