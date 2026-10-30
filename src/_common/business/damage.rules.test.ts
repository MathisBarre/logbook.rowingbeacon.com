import { describe, expect, it } from "vitest";
import { BoatDamage } from "../database/repositories/club.types";
import {
  getDepartureWarnings,
  getEarliestFixDate,
  getOpenDamagesOfBoat,
  getUnusableBoatIds,
  getWorstOpenSeverity,
  isBeforeDate,
  isBoatUnusable,
  isInTheFuture,
  parseRepairCost,
  sortDamages,
  sortDamagesChronologically,
} from "./damage.rules";

const damage = (patch: Partial<BoatDamage>): BoatDamage => ({
  id: "d",
  boatId: "b1",
  kind: "damage",
  severity: "usable",
  description: "",
  reportedAt: "2026-10-01T10:00:00.000Z",
  reportedByRowerId: null,
  outingId: null,
  incidentId: null,
  fixedAt: null,
  fixedByRowerId: null,
  repairNote: null,
  repairCost: null,
  ...patch,
});

describe("damage rules", () => {
  const damages = [
    damage({ id: "usable" }),
    damage({ id: "limited", severity: "limited" }),
    damage({ id: "fixed", severity: "unusable", fixedAt: "2026-10-02" }),
    damage({ id: "other", boatId: "b2", severity: "unusable" }),
  ];

  it("blocks a boat only for an open unusable damage", () => {
    expect(isBoatUnusable(damages, "b1")).toBe(false);
    expect(isBoatUnusable(damages, "b2")).toBe(true);
    expect([...getUnusableBoatIds(damages)]).toEqual(["b2"]);
  });

  it("warns at departure about the open damages that do not block", () => {
    expect(getDepartureWarnings(damages, "b1").map((d) => d.id)).toEqual([
      "limited",
      "usable",
    ]);
    expect(getDepartureWarnings(damages, "b2")).toEqual([]);
  });

  it("gives the worst open severity", () => {
    expect(getWorstOpenSeverity(damages, "b1")).toBe("limited");
    expect(getWorstOpenSeverity(damages, "b2")).toBe("unusable");
    expect(getWorstOpenSeverity(damages, "b3")).toBeNull();
    expect(getOpenDamagesOfBoat(damages, "b1")).toHaveLength(2);
  });

  it("sorts open first, then by severity, then latest first", () => {
    const sorted = sortDamages([
      damage({ id: "old", reportedAt: "2026-01-01T00:00:00.000Z" }),
      damage({ id: "fixed", severity: "unusable", fixedAt: "2026-10-02" }),
      damage({ id: "new", reportedAt: "2026-10-05T00:00:00.000Z" }),
      damage({ id: "worse", severity: "limited" }),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["worse", "new", "old", "fixed"]);
  });

  it("sorts the history by report date, whatever the state", () => {
    const sorted = sortDamagesChronologically([
      damage({ id: "old", reportedAt: "2026-01-01T00:00:00.000Z" }),
      damage({
        id: "fixed",
        severity: "unusable",
        reportedAt: "2026-10-04T00:00:00.000Z",
        fixedAt: "2026-10-05T00:00:00.000Z",
      }),
      damage({ id: "new", reportedAt: "2026-10-05T00:00:00.000Z" }),
      damage({ id: "worse", severity: "limited", reportedAt: "2026-03-01" }),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["new", "fixed", "worse", "old"]);
  });

  it("compares dates to the minute", () => {
    const now = new Date("2026-10-28T14:30:45.000Z");
    expect(isInTheFuture("2026-10-28T14:30:00.000Z", now)).toBe(false);
    expect(isInTheFuture("2026-10-28T14:31:00.000Z", now)).toBe(true);
    expect(
      isBeforeDate("2026-10-28T14:30:00.000Z", "2026-10-28T14:30:30.000Z")
    ).toBe(false);
    expect(
      isBeforeDate("2026-10-28T14:29:00.000Z", "2026-10-28T14:30:30.000Z")
    ).toBe(true);
  });

  it("lets a damage dated in the future be repaired now", () => {
    const now = new Date("2026-10-28T14:30:00.000Z");
    expect(
      getEarliestFixDate(
        damage({ reportedAt: "2026-10-28T14:00:00.000Z" }),
        now
      )
    ).toBe("2026-10-28T14:00:00.000Z");
    // An efa2 report date typed a year ahead.
    expect(
      getEarliestFixDate(
        damage({ reportedAt: "2027-10-12T09:20:00.000Z" }),
        now
      )
    ).toBeNull();
  });

  it("reads a repair cost", () => {
    expect(parseRepairCost("")).toBeNull();
    expect(parseRepairCost(" 12,5 ")).toBe(12.5);
    expect(parseRepairCost("40")).toBe(40);
    expect(parseRepairCost("abc")).toBe("invalid");
    expect(parseRepairCost("1.234")).toBe("invalid");
  });
});
