// Smoke test for the public engine barrel (engine/index.mjs): every advertised
// export must resolve (so a downstream consumer can import them), and a couple of
// pure functions must run end-to-end without any workbook/fs/fetch. This guards the
// callable surface the NALS Word report generator depends on.
import { describe, expect, it } from "vitest";
import * as engine from "../engine/index.mjs";

const EXPECTED_EXPORTS = [
  // orchestration
  "analyzeBatch", "classifyWorkbook", "applyIdentity",
  // workbook + spec
  "loadWorkbook", "buildSpec", "getClientSamples", "getSamples", "findHeaderFields", "clearSampleData",
  // raw parsers
  "parseIcpoesConcWorkbook", "isIcpoesConcWorkbook", "extractEsws", "buildContract", "isEswsZip",
  "parseIcWorkbook", "isIcWorkbook", "parseHotBlock", "parseLabels", "buildIdentityIndex",
  "isHotBlockWorkbook", "isLabelsWorkbook",
  // compute
  "computeReportMatrix", "detectClientSamples", "reportableAnalyteKeys", "adjustedVsUnadjusted",
  "reportableValue", "hardnessAsCaCO3", "roundSignificant", "roundDecimals", "valuesMatch",
  // qc
  "runQcCheck", "parseQcCriteria", "DEFAULT_QC_CRITERIA",
  // ingest + excel
  "ingestInstrument", "ingestIcpoes", "ingestIc", "parseQcBatch", "ingestQcBatch",
  "loadXlsxZip", "sheetPathMap", "applyEdits", "groupCellsBySheet",
  // matching + normalize
  "matchSample", "nalsNumber", "normalizeAnalyteLabel", "normalizeSampleId", "isDilution",
  "dilutionFactor", "baseSampleId", "isOverRangeValue",
  // control charts
  "controlStats", "controlLimits", "pointStatus", "rpdFromAccepted", "performance", "parseControlChartRawData",
];

describe("engine barrel", () => {
  it("re-exports the full advertised surface", () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(engine[name], `missing export: ${name}`).toBeDefined();
    }
  });

  it("does not leak Node-only file helpers", () => {
    expect(engine.openWorkbook).toBeUndefined();
    expect(engine.writeJson).toBeUndefined();
    expect(engine.writeCsv).toBeUndefined();
  });

  it("runs pure compute helpers without any I/O", () => {
    expect(engine.reportableValue(0.0146, { detectionLimit: 0.007, belowLabel: "<0.007" })).toBe(0.0146);
    expect(engine.reportableValue(null, { detectionLimit: 0.007, belowLabel: "<0.007" })).toBe("NO DATA");
    expect(engine.roundSignificant(123.456, 3)).toBeCloseTo(123, 6);
    expect(engine.normalizeAnalyteLabel("Aluminum 396.152")).toEqual(expect.any(String));
  });
});
