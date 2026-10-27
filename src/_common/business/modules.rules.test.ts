import { describe, expect, it } from "vitest";
import {
  getModulesForProfile,
  MODULE_IDS,
  normalizeModuleIds,
} from "./modules.rules";

describe("modules rules", () => {
  it("enables nothing for the simple profile", () => {
    expect(getModulesForProfile("simple")).toEqual([]);
  });

  it("enables every module for a full club", () => {
    expect(getModulesForProfile("fullClub")).toEqual([...MODULE_IDS]);
  });

  it("drops unknown ids and duplicates from stored settings", () => {
    expect(
      normalizeModuleIds(["captain", "unknown", "distances", "captain"])
    ).toEqual(["distances", "captain"]);
    expect(normalizeModuleIds("distances")).toEqual([]);
  });
});
