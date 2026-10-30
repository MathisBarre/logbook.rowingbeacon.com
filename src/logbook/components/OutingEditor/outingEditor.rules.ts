import { DEFAULT_OUTING_TYPE_CODE } from "../../../_common/business/outingType.rules";
import {
  parseKilometres,
  toKilometreInput,
} from "../../../_common/business/distance.rules";
import type { CrewOption } from "../../../boathouse/components/StartSessionDialog/RowersSection";
import type {
  OutingDraft,
  OutingDraftError,
  OutingEditorMode,
} from "../../business/EditOuting/outingDraft";

/** What the editor fields hold; text fields are strings, never undefined. */
export interface OutingEditorValues {
  boatId: string;
  boatConfigurationId: string | null;
  routeId: string | null;
  rowers: CrewOption[];
  cox: CrewOption | null;
  outingTypeCode: string | null;
  captainId: string | null;
  startDateTime: string;
  estimatedEndDateTime: string;
  endDateTime: string;
  distanceKm: string;
  comment: string;
  coached: "yes" | "no" | "";
}

export const toEditorValues = (
  draft: OutingDraft,
  toCrewOption: (id: string) => CrewOption
): OutingEditorValues => ({
  boatId: draft.boatId,
  boatConfigurationId: draft.boatConfigurationId,
  routeId: draft.routeId,
  rowers: draft.rowerIds.map(toCrewOption),
  cox: draft.coxId ? toCrewOption(draft.coxId) : null,
  outingTypeCode: draft.outingTypeCode,
  captainId: draft.captainRowerId,
  startDateTime: draft.startDateTime,
  estimatedEndDateTime: draft.estimatedEndDateTime ?? "",
  endDateTime: draft.endDateTime ?? "",
  distanceKm: toKilometreInput(draft.distanceM),
  comment: draft.comment,
  coached:
    draft.hasBeenCoached === null ? "" : draft.hasBeenCoached ? "yes" : "no",
});

/** Which optional parts of the editor apply to this outing and club. */
export interface OutingEditorContext {
  mode: OutingEditorMode;
  hasOutingTypes: boolean;
  hasCaptain: boolean;
  hasDistances: boolean;
  /** The chosen configuration has a cox seat. */
  isCoxed: boolean;
}

export const showsEndDateTime = (mode: OutingEditorMode) => mode !== "ongoing";
export const showsDistance = (mode: OutingEditorMode, hasDistances: boolean) =>
  hasDistances && mode !== "ongoing";
export const showsCoached = (mode: OutingEditorMode) => mode !== "ongoing";

/**
 * Fields of a disabled module, or not shown for this mode, keep the stored
 * value of the initial draft: editing never erases data.
 */
export const toOutingDraft = (
  values: OutingEditorValues,
  initialDraft: OutingDraft,
  context: OutingEditorContext
): OutingDraft => {
  const { mode } = context;

  return {
    ...initialDraft,
    boatId: values.boatId,
    boatConfigurationId: values.boatConfigurationId,
    routeId: values.routeId,
    outingTypeCode: context.hasOutingTypes
      ? (values.outingTypeCode ?? DEFAULT_OUTING_TYPE_CODE)
      : initialDraft.outingTypeCode,
    rowerIds: values.rowers.map((rower) => rower.id),
    coxId: context.isCoxed ? (values.cox?.id ?? null) : null,
    captainRowerId: context.hasCaptain
      ? values.captainId
      : initialDraft.captainRowerId,
    startDateTime: values.startDateTime,
    estimatedEndDateTime:
      mode === "ongoing"
        ? values.estimatedEndDateTime || null
        : initialDraft.estimatedEndDateTime,
    endDateTime: showsEndDateTime(mode) ? values.endDateTime || null : null,
    // undefined keeps the stored distance.
    distanceM: showsDistance(mode, context.hasDistances)
      ? parseKilometres(values.distanceKm)
      : undefined,
    comment: values.comment,
    hasBeenCoached: showsCoached(mode)
      ? values.coached === ""
        ? null
        : values.coached === "yes"
      : initialDraft.hasBeenCoached,
  };
};

export type EditorFieldName =
  | "boat"
  | "startDateTime"
  | "endDateTime"
  | "estimatedEndDateTime"
  | "rowers"
  | "captain"
  | "distanceKm"
  | "coached"
  | "form";

export type EditorErrors = Partial<Record<EditorFieldName, string>>;

/** The field a blocking error belongs to, and its translation key. */
export const getErrorPlacement = (
  error: OutingDraftError,
  mode: OutingEditorMode
): { field: EditorFieldName; messageKey: string } => {
  switch (error) {
    case "START_REQUIRED":
      return {
        field: "startDateTime",
        messageKey: "outingEditor.startRequired",
      };
    case "END_REQUIRED":
      return { field: "endDateTime", messageKey: "outingEditor.endRequired" };
    case "END_BEFORE_START":
      return mode === "ongoing"
        ? {
            field: "estimatedEndDateTime",
            messageKey: "session.returnBeforeStart",
          }
        : {
            field: "endDateTime",
            messageKey: "session.endDateMustBeAfterStartDate",
          };
    case "END_IN_FUTURE":
      return { field: "endDateTime", messageKey: "outingEditor.endInFuture" };
    case "START_IN_FUTURE":
      return {
        field: "startDateTime",
        messageKey: "outingEditor.startInFuture",
      };
    case "NO_ROWERS":
      return { field: "rowers", messageKey: "outingEditor.noRowers" };
    case "DUPLICATE_CREW_MEMBER":
      return { field: "rowers", messageKey: "session.duplicateCrewMember" };
    case "CAPTAIN_REQUIRED":
      return { field: "captain", messageKey: "session.captainRequired" };
    case "BOAT_ALREADY_ON_SESSION":
      return { field: "form", messageKey: "session.boatAlreadyOnSession" };
    case "OUTING_NOT_FOUND":
      return { field: "form", messageKey: "outingEditor.notFound" };
    case "FAILED_TO_SAVE":
      return { field: "form", messageKey: "session.notSaved" };
  }
};
