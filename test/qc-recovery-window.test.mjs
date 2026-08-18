import { describe, it, expect } from "vitest";
import { qcRecoveryStatus } from "../scripts/lib/raw-parsers/esws-explore.mjs";

describe("judging a QC recovery", () => {
  it("uses the method's own window when the worksheet defines one", () => {
    // Real values from a batch: both were painted red by a fixed 90–110 window.
    expect(qcRecoveryStatus({ recovery: 86.9, lower: 80, upper: 120 })).toBe("pass");
    expect(qcRecoveryStatus({ recovery: 72.9, lower: 70, upper: 130 })).toBe("pass");
    expect(qcRecoveryStatus({ recovery: 110.4, lower: 70, upper: 130 })).toBe("pass");
  });

  it("still fails what the method's window excludes", () => {
    expect(qcRecoveryStatus({ recovery: 65.9, lower: 70, upper: 130 })).toBe("fail");
    expect(qcRecoveryStatus({ recovery: 131, lower: 70, upper: 130 })).toBe("fail");
  });

  it("falls back to 90–110 only when the worksheet sets nothing", () => {
    expect(qcRecoveryStatus({ recovery: 95 })).toBe("pass");
    expect(qcRecoveryStatus({ recovery: 86.9 })).toBe("fail");
    expect(qcRecoveryStatus({ recovery: 95, lower: null, upper: null })).toBe("pass");
  });

  it("says nothing about a cell with no recovery", () => {
    expect(qcRecoveryStatus({ recovery: null })).toBe("n/a");
    expect(qcRecoveryStatus(undefined)).toBe("n/a");
    expect(qcRecoveryStatus({ recovery: Number.NaN })).toBe("n/a");
  });

  it("treats the window as inclusive at both ends", () => {
    expect(qcRecoveryStatus({ recovery: 90, lower: 90, upper: 110 })).toBe("pass");
    expect(qcRecoveryStatus({ recovery: 110, lower: 90, upper: 110 })).toBe("pass");
  });
});
