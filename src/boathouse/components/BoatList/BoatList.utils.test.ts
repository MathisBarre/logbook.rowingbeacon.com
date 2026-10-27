import { describe, it, expect } from "vitest";
import { getSectionCountLabel } from "./BoatList.utils";

describe("getSectionCountLabel", () => {
  it("should return the total count when there is no search", () => {
    expect(getSectionCountLabel(5, 5, "")).toBe("5");
  });

  it("should return filtered / total when a search is active", () => {
    expect(getSectionCountLabel(1, 5, "yole")).toBe("1 / 5");
  });
});
