import { describe, expect, it } from "vitest";
import {
  buildSeries,
  controlLimits,
  controlStats,
  pointStatus,
} from "../scripts/lib/control-chart.mjs";

describe("controlStats", () => {
  it("mean + sample (n−1) std, ignoring zeros and nulls", () => {
    const s = controlStats([0.09, 0.11, 0, null, undefined]);
    expect(s.n).toBe(2);
    expect(s.mean).toBeCloseTo(0.1, 10);
    expect(s.std).toBeCloseTo(Math.sqrt(((0.09 - 0.1) ** 2 + (0.11 - 0.1) ** 2) / 1), 10);
  });
  it("single value -> std 0", () => {
    expect(controlStats([0.1]).std).toBe(0);
  });
  it("no values -> nulls", () => {
    expect(controlStats([0, null]).mean).toBeNull();
  });
});

describe("controlLimits", () => {
  it("±1/2/3σ around the mean", () => {
    const l = controlLimits(0.1, 0.005);
    expect(l.center).toBe(0.1);
    expect(l.sigma2.upper).toBeCloseTo(0.11, 10);
    expect(l.sigma3.upper).toBeCloseTo(0.115, 10);
    expect(l.sigma3.lower).toBeCloseTo(0.085, 10);
  });
});

describe("pointStatus", () => {
  const limits = controlLimits(0.1, 0.005);
  it("classifies in / warn / out", () => {
    expect(pointStatus(0.1, limits)).toBe("in");
    expect(pointStatus(0.112, limits)).toBe("warn"); // past 2σ (0.11), within 3σ (0.115)
    expect(pointStatus(0.12, limits)).toBe("out"); // past 3σ
    expect(pointStatus(0.08, limits)).toBe("out");
  });
});

describe("buildSeries", () => {
  const rawData = {
    acceptedValue: 0.1,
    criterion: 20,
    batches: [
      { file: "b1", date: new Date("2025-02-01"), values: { "Al 396.152 nm": 0.098 } },
      { file: "b2", date: new Date("2025-03-01"), values: { "Al 396.152 nm": 0.102 } },
      { file: "b3", date: new Date("2025-04-01"), values: { "Al 396.152 nm": 0.20 } },
    ],
  };
  it("computes RPD% vs accepted value and PASS/FAIL vs criterion", () => {
    const s = buildSeries(rawData, "Al 396.152 nm");
    expect(s.points[0].rpd).toBeCloseTo(2, 6); // |0.098-0.1|/0.1*100
    expect(s.points[0].performance).toBe("PASS");
    expect(s.points[2].rpd).toBeCloseTo(100, 6); // |0.20-0.1|/0.1*100
    expect(s.points[2].performance).toBe("FAIL"); // 100 > 20
  });
  it("computes a series over all points", () => {
    const s = buildSeries(rawData, "Al 396.152 nm");
    expect(s.points).toHaveLength(3);
    expect(s.stats.n).toBe(3);
  });
  it("restricts to a date window (and recomputes stats over it)", () => {
    const s = buildSeries(rawData, "Al 396.152 nm", { from: "2025-02-01", to: "2025-03-15" });
    expect(s.points).toHaveLength(2);
    expect(s.stats.mean).toBeCloseTo(0.1, 10);
  });
  it("appends new run points, flagged isNew, sorted by date", () => {
    const s = buildSeries(rawData, "Al 396.152 nm", {
      extraPoints: [{ file: "run", date: new Date("2025-02-15"), value: 0.099 }],
    });
    expect(s.points).toHaveLength(4);
    expect(s.points.find((p) => p.isNew)?.file).toBe("run");
    // sorted: b1(2-01) < run(2-15) < b2(3-01) < b3(4-01)
    expect(s.points[1].isNew).toBe(true);
  });
});
