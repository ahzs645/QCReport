import { describe, expect, it } from "vitest";
import { buildIdentityIndex, positionCode, prepRole } from "../scripts/lib/raw-parsers/sample-prep.mjs";

describe("prepRole — QC/prep role inferred from the HotBlock sample name", () => {
  it("detects the method blank", () => expect(prepRole("Method Blank")).toBe("blank"));
  it("detects a duplicate", () => expect(prepRole("UNBC Water Jan 12, 2026 DUP")).toBe("duplicate"));
  it("detects a matrix spike", () => expect(prepRole("UNBC Water Jan 12, 2026 SPIKED")).toBe("lfmSpike"));
  it("detects the ICV standard", () => expect(prepRole("1ppm LVL 6 (100ppb Hg) ICV LVL 6")).toBe("icv"));
  it("returns null for a real client sample", () => {
    expect(prepRole("Mackenzie Treated Water")).toBeNull();
    expect(prepRole("Kitchen")).toBeNull();
  });
});

describe("positionCode — autosampler position from a NALS label", () => {
  it("extracts the A.. position", () => {
    expect(positionCode("2026NALS02598 A06")).toBe("A06");
    expect(positionCode("2026NALS02604 A10")).toBe("A10");
  });
  it("handles extra whitespace", () => expect(positionCode("2026NALS02598    A01")).toBe("A01"));
  it("returns null when there is no position", () => expect(positionCode("NALS Blank")).toBeNull());
});

describe("buildIdentityIndex — merge HotBlock + Labels on the id+position key", () => {
  const hotblock = { samples: [{ key: "2026nals02598 a06", id: "2026NALS02598 A06", position: "A06", sampleName: "Mackenzie Treated Water", prepRole: null, amount: "15mL", comments: "acid" }] };
  const labels = { rows: [{ key: "2026nals02598 a06", id: "2026NALS02598 A06", position: "A06", rackColumn: 2, rackRow: 4, acid: "2% HNO3" }] };

  it("combines name (HotBlock) and rack (Labels) under one key", () => {
    const idx = buildIdentityIndex({ hotblock, labels });
    const e = idx.get("2026nals02598 a06");
    expect(e.sampleName).toBe("Mackenzie Treated Water");
    expect(e.rack).toEqual({ column: 2, row: 4 });
  });
  it("works with only one source present (fallback principle)", () => {
    expect(buildIdentityIndex({ hotblock }).get("2026nals02598 a06").sampleName).toBe("Mackenzie Treated Water");
    expect(buildIdentityIndex({ labels }).get("2026nals02598 a06").rack).toEqual({ column: 2, row: 4 });
    expect(buildIdentityIndex({}).size).toBe(0);
  });
});
