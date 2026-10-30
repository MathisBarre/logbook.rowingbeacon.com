import { describe, expect, it } from "vitest";
import { BoatDamage, ClubIncident } from "../database/repositories/club.types";
import {
  filterDamages,
  formatRepairCost,
  getDamageDefaultsFromIncident,
  getDamageDescription,
  getIncidentsWithoutDamage,
  parseDamageDateTime,
} from "./damageLog.rules";

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

const incident = (patch: Partial<ClubIncident>): ClubIncident => ({
  id: "i1",
  boatId: "b1",
  message: "Broken rigger",
  sessionId: "s1",
  datetime: "2026-10-01T10:00:00.000Z",
  ...patch,
});

describe("damage log rules", () => {
  it("keeps only open damages with the open filter", () => {
    const open = damage({ id: "open" });
    const fixed = damage({ id: "fixed", fixedAt: "2026-10-02T10:00:00.000Z" });

    expect(filterDamages([open, fixed], "open")).toEqual([open]);
    expect(filterDamages([open, fixed], "all")).toEqual([open, fixed]);
  });

  it("finds the incidents that did not give a damage yet", () => {
    const incidents = [incident({ id: "i1" }), incident({ id: "i2" })];
    const damages = [
      damage({ id: "d1", incidentId: "i1" }),
      damage({ id: "d2", incidentId: null }),
    ];

    expect(getIncidentsWithoutDamage(incidents, damages)).toEqual([
      incidents[1],
    ]);
  });

  it("counts a fixed damage as already declared from its incident", () => {
    const damages = [
      damage({ incidentId: "i1", fixedAt: "2026-10-02T10:00:00.000Z" }),
    ];

    expect(
      getIncidentsWithoutDamage([incident({ id: "i1" })], damages)
    ).toEqual([]);
  });

  it("prefills a declaration from an incident", () => {
    expect(getDamageDefaultsFromIncident(incident({}))).toEqual({
      boatId: "b1",
      description: "Broken rigger",
      outingId: "s1",
      incidentId: "i1",
      reportedAt: "2026-10-01T10:00:00.000Z",
    });
  });

  it("does not take the text of an incident without details as a description", () => {
    expect(
      getDamageDefaultsFromIncident(
        incident({ message: "Keine Angaben" }),
        new Set(["Aucun détail renseigné", "Keine Angaben"])
      ).description
    ).toBe("");
  });

  it("has no outing when the incident lost its session", () => {
    expect(
      getDamageDefaultsFromIncident(incident({ sessionId: "" })).outingId
    ).toBeNull();
  });

  it("returns null for an empty description", () => {
    expect(getDamageDescription(damage({ description: "  " }))).toBeNull();
    expect(getDamageDescription(damage({ description: " Crack " }))).toBe(
      "Crack"
    );
  });

  it("parses a date-time field value", () => {
    expect(parseDamageDateTime("2026-10-28T14:30")).toBe(
      new Date("2026-10-28T14:30").toISOString()
    );
    expect(parseDamageDateTime("")).toBeNull();
    expect(parseDamageDateTime("not a date")).toBeNull();
  });

  it("formats a repair cost for a locale", () => {
    expect(formatRepairCost(12.5, "fr-FR")).toBe("12,50");
    expect(formatRepairCost(12.5, "en-US")).toBe("12.50");
    expect(formatRepairCost(40, "en-US")).toBe("40");
  });
});
