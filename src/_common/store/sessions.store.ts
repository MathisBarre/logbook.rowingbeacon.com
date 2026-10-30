import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { generateSessionId } from "../business/session.rules";
import { enqueueWrite } from "../database/writeQueue";
import { insertOuting } from "../database/repositories/club.repository";
import {
  OngoingOuting,
  OutingCrewMember,
} from "../database/repositories/club.types";

/** An ongoing outing, kept in memory and stored in the `outing` table. */
export type ZustandSession = OngoingOuting;

interface ZustandSessionsStoreState {
  session: ZustandSession[];
  hydrate: (sessions: ZustandSession[]) => void;
  startSession: (payload: {
    rowers: (Omit<OutingCrewMember, "role"> & {
      role?: OutingCrewMember["role"];
    })[];
    route: ZustandSession["route"];
    boat: ZustandSession["boat"];
    boatConfigurationId?: string | null;
    outingTypeCode?: string | null;
    captainRowerId?: string | null;
    startDateTime: string;
    estimatedEndDateTime?: string | undefined;
    comment: string;
  }) => Promise<void>;
  getOngoingSessions: () => ZustandSession[];
  getOngoingSession: (sessionId: string) => ZustandSession | undefined;
  findOngoingSessionByBoatId: (boatId: string) => ZustandSession | undefined;
  /** Replaces the ongoing outing that has the same id (in memory only). */
  updateSession: (outing: ZustandSession) => void;
  /**
   * When an outing was last finished (ms). Only finishing an outing sets it,
   * not a failed start rolled back nor a reload.
   */
  lastEndedAt: number | null;
  /** Removes an outing from the ongoing list (it stays in the database). */
  removeSession: (sessionId: string) => void;
  reset: () => void;
}

export const useSessionsStore = create<ZustandSessionsStoreState>()(
  devtools((set, get) => ({
    session: [],
    lastEndedAt: null,

    hydrate: (sessions) => {
      set({ session: sessions });
    },

    startSession: async (payload) => {
      const session: ZustandSession = {
        id: generateSessionId(),
        rowers: payload.rowers.map((rower) => ({
          id: rower.id,
          name: rower.name,
          role: rower.role ?? "rower",
        })),
        route: payload.route
          ? { id: payload.route.id, name: payload.route.name }
          : null,
        boat: { id: payload.boat.id, name: payload.boat.name },
        boatConfigurationId: payload.boatConfigurationId ?? null,
        outingTypeCode: payload.outingTypeCode ?? null,
        captainRowerId: payload.captainRowerId ?? null,
        startDateTime: payload.startDateTime,
        estimatedEndDateTime: payload.estimatedEndDateTime,
        comment: payload.comment,
        endDateTime: null,
      };

      set((state) => ({ session: [...state.session, session] }));

      const saved = await enqueueWrite("outing start", (db) =>
        insertOuting(db, {
          id: session.id,
          boatId: session.boat.id,
          boatConfigurationId: session.boatConfigurationId,
          routeId: session.route?.id ?? null,
          outingTypeCode: session.outingTypeCode,
          captainRowerId: session.captainRowerId,
          startDateTime: session.startDateTime,
          estimatedEndDateTime: session.estimatedEndDateTime ?? null,
          comment: session.comment,
          crew: session.rowers.map((rower) => ({
            rowerId: rower.id,
            role: rower.role,
          })),
        })
      );

      if (!saved) {
        set((state) => ({
          session: state.session.filter((s) => s.id !== session.id),
        }));
        throw new Error("OUTING_NOT_SAVED");
      }
    },

    getOngoingSessions() {
      return get().session.filter((session) => !session.endDateTime);
    },

    getOngoingSession(sessionId) {
      return get().session.find((session) => session.id === sessionId);
    },

    findOngoingSessionByBoatId(boatId) {
      return get().session.find(
        (session) => session.boat.id === boatId && !session.endDateTime
      );
    },

    updateSession(outing) {
      set((state) => ({
        session: state.session.map((session) =>
          session.id === outing.id ? outing : session
        ),
      }));
    },

    removeSession(sessionId) {
      set((state) => ({
        session: state.session.filter((session) => session.id !== sessionId),
        lastEndedAt: Date.now(),
      }));
    },

    reset() {
      set({ session: [], lastEndedAt: null });
    },
  }))
);
