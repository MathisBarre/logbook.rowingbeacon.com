/**
 * An outing as the outing editor fills it: a past outing entered after the
 * fact, or a correction of an ongoing or finished outing.
 */
export type OutingEditorMode = "past" | "ongoing" | "finished";

export interface OutingDraft {
  /** Absent for a past outing being entered. */
  id?: string;
  boatId: string;
  boatConfigurationId: string | null;
  routeId: string | null;
  outingTypeCode: string | null;
  /** Rowing seats in order; may hold new guest option ids (crew.rules). */
  rowerIds: string[];
  coxId: string | null;
  /** A crew member's id (or new guest option id), or null. */
  captainRowerId: string | null;
  /** Local "YYYY-MM-DDTHH:mm" values, as in datetime-local inputs. */
  startDateTime: string;
  /** Ongoing outings only. */
  estimatedEndDateTime: string | null;
  /** Required for past and finished outings, null for an ongoing one. */
  endDateTime: string | null;
  /** undefined keeps the stored distance (Distances module off). */
  distanceM?: number | null;
  comment: string;
  hasBeenCoached: boolean | null;
}

/** Blocking: the outing is not saved. */
export type OutingDraftError =
  | "START_REQUIRED"
  | "END_REQUIRED"
  | "END_BEFORE_START"
  | "END_IN_FUTURE"
  | "START_IN_FUTURE"
  | "NO_ROWERS"
  | "DUPLICATE_CREW_MEMBER"
  | "CAPTAIN_REQUIRED"
  | "BOAT_ALREADY_ON_SESSION"
  | "OUTING_NOT_FOUND"
  | "FAILED_TO_SAVE";

/** Shown to the user, who can save anyway. */
export type OutingDraftWarning =
  | {
      code: "BAD_AMOUNT_OF_ROWERS";
      nbOfRowers: number;
      boatRowersQuantity: number;
      boatName: string;
    }
  | { code: "BOAT_OVERLAP"; boatName: string }
  | { code: "ROWERS_OVERLAP"; rowerNames: string[] };

export type SaveOutingResult =
  | { status: "saved"; outingId: string }
  | { status: "error"; error: OutingDraftError }
  | { status: "warnings"; warnings: OutingDraftWarning[] };

export interface SaveOutingParams {
  mode: OutingEditorMode;
  draft: OutingDraft;
  /** The user confirmed the warnings shown: save anyway. */
  acceptWarnings: boolean;
}
