import { describe, expect, it } from "vitest";
import type { OutingDraft } from "../../business/EditOuting/outingDraft";
import {
  getErrorPlacement,
  OutingEditorContext,
  toEditorValues,
  toOutingDraft,
} from "./outingEditor.rules";

const draft: OutingDraft = {
  id: "outing-1",
  boatId: "boat-1",
  boatConfigurationId: "config-1",
  routeId: "route-1",
  outingTypeCode: "training",
  rowerIds: ["rower-1", "rower-2"],
  coxId: "cox-1",
  captainRowerId: "rower-1",
  startDateTime: "2026-10-01T08:00",
  estimatedEndDateTime: null,
  endDateTime: "2026-10-01T09:30",
  distanceM: 12500,
  comment: "Fog",
  hasBeenCoached: true,
};

const context: OutingEditorContext = {
  mode: "finished",
  hasOutingTypes: true,
  hasCaptain: true,
  hasDistances: true,
  isCoxed: true,
};

const toValues = (source: OutingDraft) =>
  toEditorValues(source, (id) => ({ id, name: id }));

describe("toOutingDraft", () => {
  it("gives back the draft it was filled from", () => {
    expect(toOutingDraft(toValues(draft), draft, context)).toEqual(draft);
  });

  it("keeps the stored values of the disabled modules", () => {
    const values = {
      ...toValues(draft),
      outingTypeCode: "regatta",
      captainId: "rower-2",
      distanceKm: "99",
    };

    expect(
      toOutingDraft(values, draft, {
        ...context,
        hasOutingTypes: false,
        hasCaptain: false,
        hasDistances: false,
      })
    ).toEqual({ ...draft, distanceM: undefined });
  });

  it("leaves the stored distance alone while the Distances module is off", () => {
    expect(
      toOutingDraft(toValues(draft), draft, { ...context, hasDistances: false })
        .distanceM
    ).toBeUndefined();
  });

  it("reads the distance in km, and clears it when emptied", () => {
    const values = toValues(draft);

    expect(
      toOutingDraft({ ...values, distanceKm: "8,5" }, draft, context).distanceM
    ).toBe(8500);
    expect(
      toOutingDraft({ ...values, distanceKm: "" }, draft, context).distanceM
    ).toBeNull();
  });

  it("drops the cox of a boat configuration without cox seat", () => {
    expect(
      toOutingDraft(toValues(draft), draft, { ...context, isCoxed: false })
        .coxId
    ).toBeNull();
  });

  it("only keeps the expected return of an ongoing outing", () => {
    const ongoing: OutingDraft = {
      ...draft,
      estimatedEndDateTime: "2026-10-01T10:00",
      endDateTime: null,
      distanceM: undefined,
      hasBeenCoached: null,
    };
    const result = toOutingDraft(toValues(ongoing), ongoing, {
      ...context,
      mode: "ongoing",
    });

    expect(result).toEqual(ongoing);
    expect(result.distanceM).toBeUndefined();
    expect(
      toOutingDraft(
        { ...toValues(ongoing), estimatedEndDateTime: "" },
        ongoing,
        { ...context, mode: "ongoing" }
      ).estimatedEndDateTime
    ).toBeNull();
  });

  it("keeps the stored expected return of a finished outing", () => {
    const finished = { ...draft, estimatedEndDateTime: "2026-10-01T09:00" };

    expect(
      toOutingDraft(
        { ...toValues(finished), estimatedEndDateTime: "" },
        finished,
        context
      ).estimatedEndDateTime
    ).toBe("2026-10-01T09:00");
  });

  it("keeps an unanswered coaching question unanswered", () => {
    const unknown = { ...draft, hasBeenCoached: null };

    expect(
      toOutingDraft(toValues(unknown), unknown, context).hasBeenCoached
    ).toBeNull();
    expect(
      toOutingDraft({ ...toValues(unknown), coached: "no" }, unknown, context)
        .hasBeenCoached
    ).toBe(false);
  });
});

describe("getErrorPlacement", () => {
  it("shows an end before the start on the field that holds it", () => {
    expect(getErrorPlacement("END_BEFORE_START", "past").field).toBe(
      "endDateTime"
    );
    expect(getErrorPlacement("END_BEFORE_START", "ongoing").field).toBe(
      "estimatedEndDateTime"
    );
  });

  it("falls back to the form for errors without a field", () => {
    expect(getErrorPlacement("FAILED_TO_SAVE", "past").field).toBe("form");
    expect(getErrorPlacement("BOAT_ALREADY_ON_SESSION", "ongoing").field).toBe(
      "form"
    );
  });
});
