import { Boat } from "../../../_common/business/boat.rules";
import { BoatConfiguration } from "../../../_common/business/boatConfiguration.rules";
import {
  getCrewMemberKey,
  hasDuplicateCrewMember,
} from "../../../_common/business/crew.rules";
import { OngoingOuting } from "../../../_common/database/repositories/club.types";
import {
  getDateTimeWithoutTimezone,
  MINUTE_IN_MS,
} from "../../../_common/utils/date.utils";
import { getCrewSizeMismatch } from "../../../boathouse/business/StartSession/StartSession.rules";
import {
  OutingDraft,
  OutingDraftError,
  OutingDraftWarning,
  OutingEditorMode,
} from "./outingDraft";

/** Late entries are proposed one hour long, ending now. */
const DEFAULT_PAST_OUTING_DURATION_MS = 60 * MINUTE_IN_MS;

/** The clock of the computer and the one that was read may differ a little. */
const END_IN_FUTURE_TOLERANCE_MS = MINUTE_IN_MS;

export const getOngoingOutingDraft = (outing: OngoingOuting): OutingDraft => ({
  id: outing.id,
  boatId: outing.boat.id,
  boatConfigurationId: outing.boatConfigurationId ?? null,
  routeId: outing.route?.id ?? null,
  outingTypeCode: outing.outingTypeCode ?? null,
  rowerIds: outing.rowers
    .filter((member) => member.role === "rower")
    .map((member) => member.id),
  coxId: outing.rowers.find((member) => member.role === "cox")?.id ?? null,
  captainRowerId: outing.captainRowerId ?? null,
  startDateTime: getDateTimeWithoutTimezone(outing.startDateTime),
  estimatedEndDateTime: outing.estimatedEndDateTime
    ? getDateTimeWithoutTimezone(outing.estimatedEndDateTime)
    : null,
  endDateTime: null,
  comment: outing.comment,
  hasBeenCoached: null,
});

export const getEmptyPastOutingDraft = (
  now: Date,
  boatId = ""
): OutingDraft => ({
  boatId,
  boatConfigurationId: null,
  routeId: null,
  outingTypeCode: null,
  rowerIds: [],
  coxId: null,
  captainRowerId: null,
  startDateTime: getDateTimeWithoutTimezone(
    new Date(now.getTime() - DEFAULT_PAST_OUTING_DURATION_MS)
  ),
  estimatedEndDateTime: null,
  endDateTime: getDateTimeWithoutTimezone(now),
  comment: "",
  hasBeenCoached: null,
});

export interface OutingDraftContext {
  now: Date;
  /** Captain module option: refuse an outing without a captain. */
  requireCaptain: boolean;
  ongoingOutings: { id: string; boat: { id: string } }[];
  /**
   * The crew of the outing as stored, when it is corrected: an outing
   * imported or entered before a rule existed (no rower, no captain) can
   * still be corrected without inventing a crew member.
   */
  stored?: Pick<OutingDraft, "rowerIds" | "coxId" | "captainRowerId">;
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Levels (age, seriousness) are not checked: the outing already happened,
 * or was already accepted at departure.
 */
export const validateOutingDraft = (
  mode: OutingEditorMode,
  draft: OutingDraft,
  context: OutingDraftContext
): OutingDraftError | null => {
  const start = new Date(draft.startDateTime);
  if (Number.isNaN(start.getTime())) return "START_REQUIRED";

  if (mode === "ongoing") {
    // Same rule as at departure; the start may be ahead, as at departure.
    const estimatedEnd = draft.estimatedEndDateTime
      ? new Date(draft.estimatedEndDateTime)
      : null;
    if (estimatedEnd && estimatedEnd < start) return "END_BEFORE_START";
  } else {
    if (!draft.endDateTime) return "END_REQUIRED";

    const end = new Date(draft.endDateTime);
    if (Number.isNaN(end.getTime())) return "END_REQUIRED";
    // Equal is accepted, as when an outing is stopped.
    if (end < start) return "END_BEFORE_START";
    if (start > context.now) return "START_IN_FUTURE";
    if (end.getTime() > context.now.getTime() + END_IN_FUTURE_TOLERANCE_MS) {
      return "END_IN_FUTURE";
    }
  }

  const { stored } = context;
  const crewKept =
    mode !== "past" &&
    !!stored &&
    sameIds(draft.rowerIds, stored.rowerIds) &&
    draft.coxId === stored.coxId;
  if (draft.rowerIds.length === 0 && !crewKept) return "NO_ROWERS";

  const crewIds = getCrewIds(draft);
  if (hasDuplicateCrewMember(crewIds)) return "DUPLICATE_CREW_MEMBER";

  if (
    context.requireCaptain &&
    !(crewKept && draft.captainRowerId === stored?.captainRowerId)
  ) {
    const captainKey = draft.captainRowerId
      ? getCrewMemberKey(draft.captainRowerId)
      : null;
    if (!captainKey || !crewIds.map(getCrewMemberKey).includes(captainKey)) {
      return "CAPTAIN_REQUIRED";
    }
  }

  if (
    mode === "ongoing" &&
    context.ongoingOutings.some(
      (outing) => outing.id !== draft.id && outing.boat.id === draft.boatId
    )
  ) {
    return "BOAT_ALREADY_ON_SESSION";
  }

  return null;
};

/** Crew ids in seat order, cox last. */
export const getCrewIds = (draft: OutingDraft) => [
  ...draft.rowerIds,
  ...(draft.coxId ? [draft.coxId] : []),
];

/** Same count rule as at departure, shown as a warning. */
export const getSeatCountWarning = (
  boat: Boat & { configurations?: BoatConfiguration[] },
  draft: OutingDraft
): OutingDraftWarning | null => {
  const mismatch = getCrewSizeMismatch(boat, {
    nbOfRowers: draft.rowerIds.length,
    hasCox: !!draft.coxId,
    boatConfigurationId: draft.boatConfigurationId,
  });

  return mismatch
    ? { code: "BAD_AMOUNT_OF_ROWERS", ...mismatch, boatName: boat.name }
    : null;
};
