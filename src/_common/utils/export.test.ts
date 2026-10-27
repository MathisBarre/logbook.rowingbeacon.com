import { describe, expect, it } from "vitest";
import { toCsvCell } from "./export";

describe("CSV export", () => {
  it("quotes cells holding a comma, a quote or a line break", () => {
    expect(toCsvCell("RAS")).toBe("RAS");
    expect(toCsvCell(12.5)).toBe("12.5");
    expect(toCsvCell("vent, pluie")).toBe('"vent, pluie"');
    expect(toCsvCell('dit "attention"')).toBe('"dit ""attention"""');
    expect(toCsvCell("ligne 1\nligne 2")).toBe('"ligne 1\nligne 2"');
  });

  it("keeps text that looks like a formula as text", () => {
    expect(toCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(toCsvCell("-5 min")).toBe("'-5 min");
    expect(toCsvCell(-5)).toBe("-5");
  });
});
