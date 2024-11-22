import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { generateSessionId } from "../business/session.rules";

interface ZustandRower {
  id: string;
  name: string;
}

interface ZustandRoute {
  id: string;
  name: string;
}

interface ZustandBoat {
  id: string;
  name: string;
}

export interface ZustandSession {
  id: string;
  rowers: ZustandRower[];
  route: ZustandRoute;
  boat: ZustandBoat;
  startDateTime: string;
  estimatedEndDateTime: string;
  comment: string;
  endDateTime: string | null;
}

interface ZustandSessionsStoreState {
  session: ZustandSession[];
  startSession: (payload: {
    rowers: ZustandRower[];
    route: ZustandRoute;
    boat: ZustandBoat;
    startDateTime: string;
    estimatedEndDateTime: string;
    comment: string;
  }) => void;
  stopSession: (
    boatId: string,
    payload: {
      endDateTime: string;
      comment: string | null;
    }
  ) => void;
  getOngoingSessions: () => ZustandSession[];
  getOngoingSession: (sessionId: string) => ZustandSession | undefined;
  getCompletedSessions: () => ZustandSession[];
  findOngoingSessionByBoatId: (boatId: string) => ZustandSession | undefined;
  removeSession: (sessionId: string) => void;
  reset: () => void;
  bulkAddSessions: (sessions: ZustandSession[]) => void;
}

export const useSessionsStore = create<ZustandSessionsStoreState>()(
  devtools(
    persist(
      (set, get) => ({
        session: [],
        startSession: (payload) => {
          set((state) => {
            return {
              session: [
                ...state.session,
                {
                  id: generateSessionId(),
                  rowers: payload.rowers,
                  route: payload.route,
                  boat: payload.boat,
                  startDateTime: payload.startDateTime,
                  estimatedEndDateTime: payload.estimatedEndDateTime,
                  comment: payload.comment,
                  endDateTime: null,
                },
              ],
            };
          });
        },

        stopSession: (boatId, payload) => {
          set((state) => {
            const session = state.getOngoingSessions().find((session) => {
              return session.boat.id === boatId;
            });

            return {
              session: state.session.map((sessionInState) =>
                sessionInState.id === session?.id
                  ? {
                      ...sessionInState,
                      endDateTime: payload.endDateTime,
                      comment: payload.comment
                        ? payload.comment
                        : sessionInState.comment,
                    }
                  : sessionInState
              ),
            };
          });
        },

        getOngoingSessions() {
          return get().session.filter((session) => !session.endDateTime);
        },

        getOngoingSession(sessionId) {
          return get().session.find((session) => session.id === sessionId);
        },

        getCompletedSessions() {
          return get().session.filter((session) => session.endDateTime);
        },

        findOngoingSessionByBoatId(boatId) {
          return get().session.find(
            (session) => session.boat.id === boatId && !session.endDateTime
          );
        },

        bulkAddSessions(sessions) {
          set((state) => {
            return {
              session: [...state.session, ...sessions],
            };
          });
        },

        removeSession(sessionId) {
          set((state) => {
            return {
              session: state.session.filter(
                (session) => session.id !== sessionId
              ),
            };
          });
        },

        reset() {
          set(() => {
            return {
              session: [],
            };
          });
        },
      }),
      {
        name: "sessions",
      }
    )
  )
);
