import { useCallback, useRef, useState } from "react";
import { generateSessionId } from "../../../_common/business/session.rules";
import { getNewGuestName } from "../../../_common/business/crew.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { getDatabase } from "../../../_common/database/database";
import {
  findOverlappingOutings,
  insertOuting,
  OutingOverlap,
  OutingToSave,
  updateOuting,
} from "../../../_common/database/repositories/club.repository";
import { SqlClient } from "../../../_common/database/sqlClient";
import {
  enqueueWrite,
  flushWrites,
} from "../../../_common/database/writeQueue";
import {
  isModuleEnabled,
  useModulesStore,
} from "../../../_common/store/modules.store";
import {
  useSessionsStore,
  ZustandSession,
} from "../../../_common/store/sessions.store";
import { toISODateFormat } from "../../../_common/utils/date.utils";
import { IStartSessionRepository } from "../../../boathouse/business/StartSession/StartSession.repository.interface";
import { useGetZustandStartSessionRepository } from "../../../boathouse/business/StartSession/StartSession.repository.zustand";
import { getOutingConfiguration } from "../../../boathouse/business/StartSession/StartSession.rules";
import {
  OutingDraft,
  OutingDraftError,
  OutingDraftWarning,
  SaveOutingParams,
  SaveOutingResult,
} from "./outingDraft";
import { readFinishedOutingDraft } from "./loadOutingDraft";
import {
  getCrewIds,
  getOngoingOutingDraft,
  getSeatCountWarning,
  validateOutingDraft,
} from "./outingDraft.rules";

export interface SaveOutingDependencies {
  repository: Pick<
    IStartSessionRepository,
    | "getBoat"
    | "getRoute"
    | "getRowersById"
    | "createGuest"
    | "findPersonByName"
  >;
  sessions: {
    getOngoingSessions(): ZustandSession[];
    getOngoingSession(sessionId: string): ZustandSession | undefined;
    updateSession(outing: ZustandSession): void;
  };
  database: {
    /** False when the write failed (reported through the result). */
    write(
      label: string,
      write: (db: SqlClient) => Promise<unknown>
    ): Promise<boolean>;
    findOverlaps(
      query: Parameters<typeof findOverlappingOutings>[1]
    ): Promise<OutingOverlap[]>;
    /** The finished outing as stored, null when missing or ongoing. */
    loadFinished(outingId: string): Promise<OutingDraft | null>;
  };
  requireCaptain(): boolean;
  now(): Date;
  generateId(): string;
}

const error = (code: OutingDraftError): SaveOutingResult => ({
  status: "error",
  error: code,
});

export class SaveOutingUsecase {
  constructor(private readonly dependencies: SaveOutingDependencies) {}

  async execute(params: SaveOutingParams): Promise<SaveOutingResult> {
    try {
      return await this.save(params);
    } catch (cause) {
      console.error("❌ Failed to save the outing", cause);
      return error("FAILED_TO_SAVE");
    }
  }

  private async save({
    mode,
    draft,
    acceptWarnings,
  }: SaveOutingParams): Promise<SaveOutingResult> {
    const { sessions } = this.dependencies;

    if (mode !== "past" && !draft.id) {
      return error("OUTING_NOT_FOUND");
    }
    const ongoingOuting =
      mode === "ongoing" && draft.id
        ? sessions.getOngoingSession(draft.id)
        : undefined;
    if (mode === "ongoing" && !ongoingOuting) {
      return error("OUTING_NOT_FOUND");
    }

    const stored = ongoingOuting
      ? getOngoingOutingDraft(ongoingOuting)
      : mode === "finished" && draft.id
        ? await this.dependencies.database.loadFinished(draft.id)
        : null;
    if (mode === "finished" && !stored) {
      return error("OUTING_NOT_FOUND");
    }

    const invalid = validateOutingDraft(mode, draft, {
      now: this.dependencies.now(),
      requireCaptain: this.dependencies.requireCaptain(),
      ongoingOutings: sessions.getOngoingSessions(),
      stored: stored ?? undefined,
    });
    if (invalid) {
      return error(invalid);
    }

    // A typed name can be a member who is also picked from the list: refused
    // before any guest is created, and before the warnings, so that a user
    // who confirms them is not then told the outing cannot be saved.
    const knownIds = await this.findKnownCrewIds(getCrewIds(draft));
    if (new Set(knownIds).size !== knownIds.length) {
      return error("DUPLICATE_CREW_MEMBER");
    }

    if (!acceptWarnings) {
      const warnings = await this.getWarnings(mode, draft);
      if (warnings.length > 0) {
        return { status: "warnings", warnings };
      }
    }

    const { repository } = this.dependencies;
    const boat = await repository.getBoat(draft.boatId);
    const members = await this.resolveCrewMembers(getCrewIds(draft));
    const crew = [
      ...draft.rowerIds.map((id) => ({ id, role: "rower" as const })),
      ...(draft.coxId ? [{ id: draft.coxId, role: "cox" as const }] : []),
    ].map(({ id, role }) => ({ member: members.get(id), role }));

    // A registered rower that cannot be found must not silently leave the crew.
    if (crew.some(({ member }) => !member)) {
      return error("FAILED_TO_SAVE");
    }
    const resolvedCrew = crew.map(({ member, role }) => ({
      id: (member as Rower).id,
      name: (member as Rower).name,
      role,
    }));
    // A typed name can be a member who is also picked from the list.
    if (new Set(resolvedCrew.map((m) => m.id)).size !== resolvedCrew.length) {
      return error("DUPLICATE_CREW_MEMBER");
    }

    const outingId =
      mode === "past" ? this.dependencies.generateId() : draft.id;
    if (!outingId) {
      return error("OUTING_NOT_FOUND");
    }
    const outing: OutingToSave = {
      id: outingId,
      boatId: draft.boatId,
      // A late entry stores the default configuration when none is chosen.
      // An outing already stored keeps its configuration as it is, archived
      // since or missing: correcting it never rewrites the rigging history.
      boatConfigurationId:
        mode === "past"
          ? (getOutingConfiguration(boat, draft.boatConfigurationId)?.id ??
            null)
          : draft.boatConfigurationId,
      routeId: draft.routeId,
      outingTypeCode: draft.outingTypeCode,
      captainRowerId: draft.captainRowerId
        ? (members.get(draft.captainRowerId)?.id ?? null)
        : null,
      startDateTime: draft.startDateTime,
      estimatedEndDateTime: draft.estimatedEndDateTime,
      endDateTime: mode === "ongoing" ? null : draft.endDateTime,
      distanceM: draft.distanceM,
      comment: draft.comment,
      hasBeenCoached: draft.hasBeenCoached,
      crew: resolvedCrew.map(({ id, role }) => ({ rowerId: id, role })),
    };

    if (mode === "past") {
      const saved = await this.dependencies.database.write(
        "outing late entry",
        (db) => insertOuting(db, outing)
      );
      return saved ? { status: "saved", outingId } : error("FAILED_TO_SAVE");
    }

    // Shown at once, put back if the write fails.
    if (ongoingOuting) {
      sessions.updateSession({
        ...ongoingOuting,
        boat: { id: boat.id, name: boat.name },
        route: draft.routeId ? await repository.getRoute(draft.routeId) : null,
        boatConfigurationId: outing.boatConfigurationId ?? null,
        outingTypeCode: outing.outingTypeCode ?? null,
        captainRowerId: outing.captainRowerId ?? null,
        startDateTime: toISODateFormat(draft.startDateTime),
        estimatedEndDateTime: draft.estimatedEndDateTime
          ? toISODateFormat(draft.estimatedEndDateTime)
          : undefined,
        comment: draft.comment,
        rowers: resolvedCrew,
      });
    }

    let found = true;
    const saved = await this.dependencies.database.write(
      mode === "ongoing" ? "ongoing outing correction" : "outing correction",
      async (db) => {
        found = await updateOuting(db, outing, {
          onlyIfOngoing: mode === "ongoing",
          onlyIfFinished: mode === "finished",
        });
      }
    );

    if (!saved || !found) {
      if (ongoingOuting) sessions.updateSession(ongoingOuting);
      return error(saved ? "OUTING_NOT_FOUND" : "FAILED_TO_SAVE");
    }
    return { status: "saved", outingId };
  }

  private async getWarnings(
    mode: SaveOutingParams["mode"],
    draft: OutingDraft
  ): Promise<OutingDraftWarning[]> {
    const { repository, database } = this.dependencies;
    const boat = await repository.getBoat(draft.boatId);
    const warnings: OutingDraftWarning[] = [];

    // The seats of a configuration archived since are not known any more.
    const isConfigurationKnown =
      draft.boatConfigurationId === null ||
      (boat.configurations ?? []).some(
        (configuration) => configuration.id === draft.boatConfigurationId
      );
    const seatCountWarning = isConfigurationKnown
      ? getSeatCountWarning(boat, draft)
      : null;
    if (seatCountWarning) warnings.push(seatCountWarning);

    // A typed name already known (member or guest) can overlap; a new guest
    // cannot.
    const crewIds = (await this.findKnownCrewIds(getCrewIds(draft))).filter(
      (id) => !getNewGuestName(id)
    );
    // An ongoing outing has no end: it overlaps whatever runs after its start.
    const overlaps = await database.findOverlaps({
      excludeOutingId: draft.id,
      boatId: draft.boatId,
      rowerIds: crewIds,
      startDateTime: draft.startDateTime,
      endDateTime: mode === "ongoing" ? null : draft.endDateTime,
    });

    if (overlaps.some((overlap) => overlap.boatOverlaps)) {
      warnings.push({ code: "BOAT_OVERLAP", boatName: boat.name });
    }

    const overlappingRowerIds = new Set(
      overlaps.flatMap((overlap) => overlap.rowerIds)
    );
    if (overlappingRowerIds.size > 0) {
      const ids = crewIds.filter((id) => overlappingRowerIds.has(id));
      const known = await repository.getRowersById(ids);
      warnings.push({
        code: "ROWERS_OVERLAP",
        rowerNames: ids.map(
          (id) => known.find((rower) => rower.id === id)?.name ?? id
        ),
      });
    }

    return warnings;
  }

  /** Ids with typed names replaced by the person they stand for, if any. */
  private async findKnownCrewIds(ids: string[]) {
    const { repository } = this.dependencies;
    return Promise.all(
      ids.map(async (id) => {
        const guestName = getNewGuestName(id);
        if (guestName === null) return id;
        return (await repository.findPersonByName(guestName))?.id ?? id;
      })
    );
  }

  /** Registered rowers for ids, guests created for typed names, by option id. */
  private async resolveCrewMembers(ids: string[]) {
    const { repository } = this.dependencies;
    const registered = await repository.getRowersById(
      ids.filter((id) => getNewGuestName(id) === null)
    );
    const members = new Map<string, Rower>();

    for (const id of ids) {
      const guestName = getNewGuestName(id);
      const member =
        guestName === null
          ? registered.find((rower) => rower.id === id)
          : await repository.createGuest(guestName);

      if (member) {
        members.set(id, member);
      }
    }

    return members;
  }
}

export const useSaveOuting = () => {
  const repository = useGetZustandStartSessionRepository();
  const [isSaving, setIsSaving] = useState(false);
  const inFlight = useRef<Promise<SaveOutingResult> | null>(null);

  const saveOuting = useCallback(
    (params: SaveOutingParams) => {
      // A double click gets the answer of the save already running.
      if (inFlight.current) return inFlight.current;

      const sessions = useSessionsStore.getState();
      const usecase = new SaveOutingUsecase({
        repository,
        sessions,
        database: {
          // The error is reported through the result, not as a toast.
          write: (label, write) => enqueueWrite(label, write, { quiet: true }),
          findOverlaps: async (query) => {
            await flushWrites();
            const { db } = await getDatabase();
            return findOverlappingOutings(db, query);
          },
          loadFinished: async (outingId) => {
            await flushWrites();
            const { db } = await getDatabase();
            return readFinishedOutingDraft(db, outingId);
          },
        },
        requireCaptain: () =>
          isModuleEnabled("captain") &&
          useModulesStore.getState().captainRequired,
        now: () => new Date(),
        generateId: generateSessionId,
      });

      setIsSaving(true);
      const saving = usecase.execute(params).finally(() => {
        inFlight.current = null;
        setIsSaving(false);
      });
      inFlight.current = saving;
      return saving;
    },
    [repository]
  );

  return { saveOuting, isSaving };
};
