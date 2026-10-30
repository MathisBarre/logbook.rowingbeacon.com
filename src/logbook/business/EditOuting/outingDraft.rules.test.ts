import { describe, expect, it } from "vitest";
import { BoatTypeEnum } from "../../../_common/business/boat.rules";
import { toNewGuestOptionId } from "../../../_common/business/crew.rules";
import { OngoingOuting } from "../../../_common/database/repositories/club.types";
import { OutingDraft } from "./outingDraft";
import {
  getEmptyPastOutingDraft,
  getOngoingOutingDraft,
  getSeatCountWarning,
  validateOutingDraft,
} from "./outingDraft.rules";

const now = new Date(2026, 9, 28, 14, 30, 45);

const draft: OutingDraft = {
  id: "o1",
  boatId: "b1",
  boatConfigurationId: null,
  routeId: null,
  outingTypeCode: null,
  rowerIds: ["r1", "r2"],
  coxId: null,
  captainRowerId: "r1",
  startDateTime: "2026-10-28T12:00",
  estimatedEndDateTime: null,
  endDateTime: "2026-10-28T13:30",
  comment: "",
  hasBeenCoached: null,
};

const context = { now, requireCaptain: false, ongoingOutings: [] };

describe("outing draft rules", () => {
  describe("getOngoingOutingDraft", () => {
    it("splits the cox from the rowers and converts dates to local time", () => {
      const outing: OngoingOuting = {
        id: "o1",
        boat: { id: "b1", name: "Marie-Claire" },
        boatConfigurationId: "c1",
        route: { id: "route1", name: "Amont" },
        outingTypeCode: "training",
        captainRowerId: "r3",
        startDateTime: new Date(2026, 9, 28, 9, 5).toISOString(),
        estimatedEndDateTime: new Date(2026, 9, 28, 11, 0).toISOString(),
        comment: "Vent",
        endDateTime: null,
        rowers: [
          { id: "r1", name: "Léa", role: "rower" },
          { id: "r3", name: "Sam", role: "cox" },
          { id: "r2", name: "Paul", role: "rower" },
        ],
      };

      expect(getOngoingOutingDraft(outing)).toEqual({
        id: "o1",
        boatId: "b1",
        boatConfigurationId: "c1",
        routeId: "route1",
        outingTypeCode: "training",
        rowerIds: ["r1", "r2"],
        coxId: "r3",
        captainRowerId: "r3",
        startDateTime: "2026-10-28T09:05",
        estimatedEndDateTime: "2026-10-28T11:00",
        endDateTime: null,
        comment: "Vent",
        hasBeenCoached: null,
      });
    });

    it("fills the optional fields with null", () => {
      const result = getOngoingOutingDraft({
        id: "o1",
        boat: { id: "b1", name: "Marie-Claire" },
        route: null,
        startDateTime: new Date(2026, 9, 28, 9, 5).toISOString(),
        comment: "",
        endDateTime: null,
        rowers: [{ id: "r1", name: "Léa", role: "rower" }],
      });

      expect(result).toMatchObject({
        boatConfigurationId: null,
        routeId: null,
        outingTypeCode: null,
        coxId: null,
        captainRowerId: null,
        estimatedEndDateTime: null,
      });
    });
  });

  describe("getEmptyPastOutingDraft", () => {
    it("proposes the last hour, to the minute", () => {
      expect(getEmptyPastOutingDraft(now, "b1")).toEqual({
        boatId: "b1",
        boatConfigurationId: null,
        routeId: null,
        outingTypeCode: null,
        rowerIds: [],
        coxId: null,
        captainRowerId: null,
        startDateTime: "2026-10-28T13:30",
        estimatedEndDateTime: null,
        endDateTime: "2026-10-28T14:30",
        comment: "",
        hasBeenCoached: null,
      });
    });

    it("has no boat unless one is given", () => {
      expect(getEmptyPastOutingDraft(now).boatId).toBe("");
    });
  });

  describe("validateOutingDraft", () => {
    it("accepts a valid draft in every mode", () => {
      expect(validateOutingDraft("past", draft, context)).toBeNull();
      expect(validateOutingDraft("finished", draft, context)).toBeNull();
      expect(
        validateOutingDraft("ongoing", { ...draft, endDateTime: null }, context)
      ).toBeNull();
    });

    it("requires an end for past and finished outings only", () => {
      const withoutEnd = { ...draft, endDateTime: null };

      expect(validateOutingDraft("past", withoutEnd, context)).toBe(
        "END_REQUIRED"
      );
      expect(validateOutingDraft("finished", withoutEnd, context)).toBe(
        "END_REQUIRED"
      );
      expect(validateOutingDraft("ongoing", withoutEnd, context)).toBeNull();
    });

    it("refuses an end before the start but accepts an equal one", () => {
      expect(
        validateOutingDraft(
          "past",
          { ...draft, endDateTime: "2026-10-28T11:59" },
          context
        )
      ).toBe("END_BEFORE_START");
      expect(
        validateOutingDraft(
          "past",
          { ...draft, endDateTime: draft.startDateTime },
          context
        )
      ).toBeNull();
    });

    it("refuses a start in the future", () => {
      expect(
        validateOutingDraft(
          "past",
          {
            ...draft,
            startDateTime: "2026-10-28T14:31",
            endDateTime: "2026-10-28T15:00",
          },
          context
        )
      ).toBe("START_IN_FUTURE");
    });

    it("tolerates an end up to a minute after now", () => {
      expect(
        validateOutingDraft(
          "past",
          { ...draft, endDateTime: "2026-10-28T14:31" },
          context
        )
      ).toBeNull();
      expect(
        validateOutingDraft(
          "finished",
          { ...draft, endDateTime: "2026-10-28T14:32" },
          context
        )
      ).toBe("END_IN_FUTURE");
    });

    it("lets an ongoing outing start in the past and ignores its dates otherwise", () => {
      expect(
        validateOutingDraft(
          "ongoing",
          { ...draft, startDateTime: "2026-10-01T08:00", endDateTime: null },
          context
        )
      ).toBeNull();
    });

    it("refuses an expected return before the start of an ongoing outing", () => {
      expect(
        validateOutingDraft(
          "ongoing",
          {
            ...draft,
            startDateTime: "2026-10-28T12:00",
            estimatedEndDateTime: "2026-10-28T11:00",
            endDateTime: null,
          },
          context
        )
      ).toBe("END_BEFORE_START");
    });

    it("needs a start in every mode", () => {
      for (const mode of ["past", "finished", "ongoing"] as const) {
        expect(
          validateOutingDraft(mode, { ...draft, startDateTime: "" }, context)
        ).toBe("START_REQUIRED");
      }
    });

    it("needs at least one rower, a cox alone is not enough", () => {
      expect(
        validateOutingDraft(
          "past",
          { ...draft, rowerIds: [], coxId: "r3" },
          context
        )
      ).toBe("NO_ROWERS");
    });

    it("corrects a stored outing without rowers or captain when its crew is kept", () => {
      const stored = { rowerIds: [], coxId: null, captainRowerId: null };
      const noCrew = {
        ...draft,
        rowerIds: [],
        coxId: null,
        captainRowerId: null,
      };
      const strict = { ...context, requireCaptain: true, stored };

      expect(validateOutingDraft("finished", noCrew, strict)).toBeNull();
      expect(
        validateOutingDraft("finished", { ...noCrew, rowerIds: ["r1"] }, strict)
      ).toBe("CAPTAIN_REQUIRED");
      expect(
        validateOutingDraft("finished", { ...noCrew, coxId: "r3" }, strict)
      ).toBe("NO_ROWERS");
      expect(validateOutingDraft("past", noCrew, strict)).toBe("NO_ROWERS");
    });

    it("refuses someone picked twice, typed guests compared by name", () => {
      expect(
        validateOutingDraft("past", { ...draft, coxId: "r2" }, context)
      ).toBe("DUPLICATE_CREW_MEMBER");
      expect(
        validateOutingDraft(
          "past",
          {
            ...draft,
            rowerIds: [toNewGuestOptionId("Léa Martin"), "r2"],
            coxId: toNewGuestOptionId(" lea  martin"),
            captainRowerId: "r2",
          },
          context
        )
      ).toBe("DUPLICATE_CREW_MEMBER");
    });

    it("requires a captain from the crew when the option is on", () => {
      const strict = { ...context, requireCaptain: true };

      expect(
        validateOutingDraft("past", { ...draft, captainRowerId: null }, strict)
      ).toBe("CAPTAIN_REQUIRED");
      expect(
        validateOutingDraft("past", { ...draft, captainRowerId: "r9" }, strict)
      ).toBe("CAPTAIN_REQUIRED");
      expect(validateOutingDraft("past", draft, strict)).toBeNull();
      expect(
        validateOutingDraft(
          "past",
          {
            ...draft,
            rowerIds: [toNewGuestOptionId("Jean")],
            captainRowerId: toNewGuestOptionId("Jean"),
          },
          strict
        )
      ).toBeNull();
      expect(
        validateOutingDraft("past", { ...draft, captainRowerId: null }, context)
      ).toBeNull();
    });

    it("refuses an ongoing outing on a boat that is on another ongoing outing", () => {
      const ongoingDraft = { ...draft, endDateTime: null };
      const ongoingOutings = [
        { id: "o1", boat: { id: "b1" } },
        { id: "o2", boat: { id: "b2" } },
      ];

      expect(
        validateOutingDraft("ongoing", ongoingDraft, {
          ...context,
          ongoingOutings,
        })
      ).toBeNull();
      expect(
        validateOutingDraft(
          "ongoing",
          { ...ongoingDraft, boatId: "b2" },
          { ...context, ongoingOutings }
        )
      ).toBe("BOAT_ALREADY_ON_SESSION");
      expect(
        validateOutingDraft(
          "finished",
          { ...draft, boatId: "b2" },
          { ...context, ongoingOutings }
        )
      ).toBeNull();
    });
  });

  describe("getSeatCountWarning", () => {
    const coxedFour = {
      id: "b1",
      name: "Marie-Claire",
      configurations: [
        {
          id: "c1",
          seats: 4,
          rigging: "scull" as const,
          coxed: true,
          isDefault: true,
          position: 0,
        },
        {
          id: "c2",
          seats: 4,
          rigging: "sweep" as const,
          coxed: false,
          isDefault: false,
          position: 1,
        },
      ],
    };

    it("is null when the crew fits the configuration", () => {
      expect(
        getSeatCountWarning(coxedFour, {
          ...draft,
          boatConfigurationId: "c1",
          rowerIds: ["r1", "r2", "r3", "r4"],
          coxId: "r5",
        })
      ).toBeNull();
    });

    it("warns when rowers do not fill the seats", () => {
      expect(
        getSeatCountWarning(coxedFour, {
          ...draft,
          boatConfigurationId: "c1",
        })
      ).toEqual({
        code: "BAD_AMOUNT_OF_ROWERS",
        nbOfRowers: 2,
        boatRowersQuantity: 4,
        boatName: "Marie-Claire",
      });
    });

    it("counts a cox in a coxless boat as a rower", () => {
      expect(
        getSeatCountWarning(coxedFour, {
          ...draft,
          boatConfigurationId: "c2",
          rowerIds: ["r1", "r2", "r3"],
          coxId: "r4",
        })
      ).toBeNull();
    });

    it("falls back on the legacy boat type without configurations", () => {
      const legacy = {
        id: "b2",
        name: "Pierre",
        type: BoatTypeEnum.TWO_ROWERS_COXED,
      };

      expect(getSeatCountWarning(legacy, { ...draft, coxId: "r3" })).toBeNull();
      expect(getSeatCountWarning(legacy, draft)).toEqual({
        code: "BAD_AMOUNT_OF_ROWERS",
        nbOfRowers: 2,
        boatRowersQuantity: 3,
        boatName: "Pierre",
      });
    });

    it("has nothing to compare for a boat of unknown size", () => {
      expect(
        getSeatCountWarning({ id: "b3", name: "Autre" }, draft)
      ).toBeNull();
    });
  });
});
