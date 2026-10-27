import { describe, expect, it } from "vitest";
import {
  formatKilometres,
  isValidKilometreInput,
  parseKilometres,
  toKilometreInput,
} from "./distance.rules";

describe("distance rules", () => {
  it("parses kilometres typed with a comma or a dot", () => {
    expect(parseKilometres("12,5")).toBe(12500);
    expect(parseKilometres(" 8 ")).toBe(8000);
    expect(parseKilometres("")).toBeNull();
    expect(parseKilometres("abc")).toBeNull();
    expect(parseKilometres("-3")).toBeNull();
  });

  it("only accepts plain numbers of kilometres", () => {
    for (const valid of ["", " ", "12", "12.5", "12,5", "0", "10000"]) {
      expect(isValidKilometreInput(valid)).toBe(true);
    }
    const invalidInputs = [
      ...["abc", "-3", "1e3", "0x10"],
      ...["1 000", "12.5 km", "1,234.5", "10001"],
    ];
    for (const invalid of invalidInputs) {
      expect(isValidKilometreInput(invalid)).toBe(false);
      expect(parseKilometres(invalid)).toBeNull();
    }
  });

  it("formats metres as kilometres", () => {
    expect(formatKilometres(12500, "fr-FR")).toBe("12,5 km");
    expect(formatKilometres(null)).toBe("");
    expect(toKilometreInput(7250)).toBe("7.25");
    expect(toKilometreInput(undefined)).toBe("");
  });
});
