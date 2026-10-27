import { describe, expect, it } from "vitest";
import { BoatTypeEnum, getBoatNumberOfRowers } from "./boat.rules";
import {
  getConfigurationCode,
  getConfigurationError,
  renewChangedConfigurations,
  withSingleDefault,
  getConfigurationFromLegacyType,
  getCrewSize,
  getDefaultConfiguration,
  getLegacyTypeFromConfiguration,
} from "./boatConfiguration.rules";

describe("boat configurations", () => {
  it("round-trips every v1 boat type", () => {
    for (const type of Object.values(BoatTypeEnum)) {
      const configuration = getConfigurationFromLegacyType(type);
      expect(getLegacyTypeFromConfiguration(configuration)).toBe(type);
      expect(getCrewSize(configuration)).toBe(getBoatNumberOfRowers(type));
    }
  });

  it("writes the usual rowing notation", () => {
    expect(
      getConfigurationCode({ seats: 1, rigging: "scull", coxed: false })
    ).toBe("1x");
    expect(
      getConfigurationCode({ seats: 4, rigging: "sweep", coxed: false })
    ).toBe("4-");
    expect(
      getConfigurationCode({ seats: 4, rigging: "sweep", coxed: true })
    ).toBe("4+");
    expect(
      getConfigurationCode({ seats: 4, rigging: "scull", coxed: true })
    ).toBe("4x+");
    expect(
      getConfigurationCode({ seats: 4, rigging: null, coxed: false })
    ).toBe("4");
    expect(
      getConfigurationCode({ seats: null, rigging: null, coxed: false })
    ).toBeNull();
  });

  it("picks the default configuration, else the first one", () => {
    expect(
      getDefaultConfiguration([
        { id: "a", isDefault: false, position: 1 },
        { id: "b", isDefault: true, position: 2 },
      ])?.id
    ).toBe("b");
    expect(
      getDefaultConfiguration([
        { id: "a", isDefault: false, position: 1 },
        { id: "b", isDefault: false, position: 0 },
      ])?.id
    ).toBe("b");
  });
});

describe("configuration checks", () => {
  const config = (
    id: string,
    seats: number | null,
    rigging: "scull" | "sweep" | null = "scull",
    coxed = false
  ) => ({ id, seats, rigging, coxed, isDefault: false, position: 0 });

  it("accepts unknown seats and whole numbers from 1 to 24", () => {
    const list = [config("a", null), config("b", 4)];
    expect(getConfigurationError(list[0], list)).toBeNull();
    expect(getConfigurationError(list[1], list)).toBeNull();
  });

  it("keeps unknown seats only on a configuration saved that way", () => {
    const list = [config("a", null), config("b", null)];
    const saved = [config("a", null), config("b", 4)];
    expect(getConfigurationError(list[0], list, saved)).toBeNull();
    expect(getConfigurationError(list[1], list, saved)).toBe("invalidSeats");
    const added = [config("c", null)];
    expect(getConfigurationError(added[0], added, saved)).toBe("invalidSeats");
  });

  it("refuses 0, negative, decimal or too many seats", () => {
    for (const seats of [0, -2, 1.5, 30]) {
      const list = [config("a", seats)];
      expect(getConfigurationError(list[0], list)).toBe("invalidSeats");
    }
  });

  it("refuses an odd sweep boat and a duplicate", () => {
    const odd = [config("a", 1, "sweep")];
    expect(getConfigurationError(odd[0], odd)).toBe("sweepNeedsEvenSeats");
    const twins = [config("a", 4), config("b", 4)];
    expect(getConfigurationError(twins[0], twins)).toBeNull();
    expect(getConfigurationError(twins[1], twins)).toBe(
      "duplicateConfiguration"
    );
  });

  it("gives a changed configuration a new id and keeps the others", () => {
    const saved = [config("a", 4), config("b", 4, "sweep")];
    const edited = [config("a", 4), config("b", 4, "sweep", true)];
    const renewed = renewChangedConfigurations(edited, saved, () => "new");
    expect(renewed.map((c) => c.id)).toEqual(["a", "new"]);
  });

  it("keeps exactly one default configuration", () => {
    const two = withSingleDefault([
      { ...config("a", 4), isDefault: true },
      { ...config("b", 4, "sweep"), isDefault: true },
    ]);
    expect(two.map((c) => c.isDefault)).toEqual([true, false]);
    const none = withSingleDefault([
      { ...config("a", 4), isDefault: false, position: 1 },
      { ...config("b", 2), isDefault: false, position: 0 },
    ]);
    expect(none.map((c) => c.isDefault)).toEqual([false, true]);
  });
});
