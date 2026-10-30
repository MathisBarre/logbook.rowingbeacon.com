import { describe, it, expect } from "vitest";
import {
  getSectionCountLabel,
  sortBoatsByAvailability,
} from "./BoatList.utils";

describe("getSectionCountLabel", () => {
  it("should return the total count when there is no search", () => {
    expect(getSectionCountLabel(5, 5, "")).toBe("5");
  });

  it("should return filtered / total when a search is active", () => {
    expect(getSectionCountLabel(1, 5, "yole")).toBe("1 / 5");
  });
});

describe("sortBoatsByAvailability", () => {
  const boats = [
    { id: "free", name: "Free" },
    { id: "repair", name: "Repair", isInMaintenance: true },
    { id: "out", name: "Out" },
    { id: "out-repair", name: "Out and broken", isInMaintenance: true },
    { id: "old", name: "Old", archivedAt: "2024-01-01T00:00:00.000Z" },
    {
      id: "old-repair",
      name: "Old broken",
      isInMaintenance: true,
      archivedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "old-out",
      name: "Old out",
      archivedAt: "2024-01-01T00:00:00.000Z",
    },
  ];

  const ids = (list: { id: string }[]) => list.map((boat) => boat.id);

  it("should split boats into available, in use and unavailable lists", () => {
    const result = sortBoatsByAvailability(boats, [
      "out",
      "out-repair",
      "old-out",
    ]);

    expect(ids(result.availableBoats)).toEqual(["free"]);
    expect(ids(result.unavailableBoats)).toEqual(["repair"]);
    expect(ids(result.boatsInUse)).toEqual(["out", "out-repair", "old-out"]);
  });

  it("should keep a boat in maintenance that is out in the in use list only", () => {
    const result = sortBoatsByAvailability(boats, ["out-repair"]);

    expect(ids(result.boatsInUse)).toEqual(["out-repair"]);
    expect(ids(result.unavailableBoats)).not.toContain("out-repair");
  });

  it("should hide archived boats unless they are out", () => {
    const result = sortBoatsByAvailability(boats, []);

    expect(ids(result.availableBoats)).toEqual(["free", "out"]);
    expect(ids(result.unavailableBoats)).toEqual(["repair", "out-repair"]);
    expect(result.boatsInUse).toEqual([]);
  });

  it("should return no unavailable boat when none is in maintenance", () => {
    const result = sortBoatsByAvailability([{ id: "a", name: "A" }], []);

    expect(result.unavailableBoats).toEqual([]);
  });
});
