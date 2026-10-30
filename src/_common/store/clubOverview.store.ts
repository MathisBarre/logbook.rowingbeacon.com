import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { v4 } from "uuid";
import {
  updateBoatNameFn,
  updateBoatNoteFn,
} from "./clubOverview.store.functions";
import { BoatTypeEnum } from "../business/boat.rules";
import {
  getConfigurationFromLegacyType,
  withSingleDefault,
} from "../business/boatConfiguration.rules";
import { SeriousnessCategoryEnum } from "../business/seriousness.rules";
import { AgeCategoryEnum } from "../business/ageCategory.rules";
import { getRowerFullName, splitRowerName } from "../business/rower.rules";
import { enqueueWrite } from "../database/writeQueue";
import { useSessionsStore } from "./sessions.store";
import { SETTING_ONBOARDING_DONE } from "../../onboarding/onboarding.store";
import {
  deleteAllClubData,
  saveBoat,
  saveBoatDamage,
  saveRoute,
  saveRower,
  saveSetting,
} from "../database/repositories/club.repository";
import { useDamageStore } from "./damage.store";
import {
  BoatDamage,
  ClubBoat,
  ClubRoute,
  ClubRower,
} from "../database/repositories/club.types";

export const SETTING_PASSWORD_HASH = "club.passwordHash";
export const SETTING_COACH_NOTE = "club.coachNote";

export interface ClubOverviewState {
  club: {
    password: string;
  };
  boats: ClubBoat[];
  routes: ClubRoute[];
  rowers: ClubRower[];
}

type UpdateRowerDto = Partial<
  Omit<ClubRower, "id" | "archivedAt" | "firstName" | "lastName">
> & { firstName?: string; lastName?: string };

type BulkUpdateRowerDto = Pick<ClubRower, "type" | "category">;

/** What onboarding, the demo and imports provide: v1-like records. */
export interface ClubOverviewInput {
  club: { password: string };
  boats: {
    id?: string;
    name: string;
    type?: BoatTypeEnum;
    isInMaintenance?: boolean;
    note?: string;
  }[];
  routes: { id?: string; name: string; distanceM?: number | null }[];
  rowers: {
    id?: string;
    name: string;
    type?: SeriousnessCategoryEnum;
    category?: AgeCategoryEnum;
  }[];
}

export interface ClubOverviewStoreState {
  clubOverview: ClubOverviewState;
  coachNote: string;

  hydrate: (data: {
    clubOverview: ClubOverviewState;
    coachNote: string;
  }) => void;

  setCoachNote: (coachNote: string) => void;

  /** False when the club could not be saved (nothing of it is kept). */
  setClubOverview: (clubOverview: ClubOverviewInput) => Promise<boolean>;

  getBoatById: (boatId: string) => ClubBoat | undefined;
  updateBoatName: (boatId: string, name: string) => void;
  updateBoatNote: (boatId: string, note: string) => void;
  updateBoat: (boatId: string, boat: Partial<Omit<ClubBoat, "id">>) => void;
  /**
   * In memory only: whether a boat is unusable comes from its damages
   * (damage store, ADR 0007).
   */
  syncUnusableBoats: (unusableBoatIds: Set<string>) => void;
  addBoat: (boat: { name: string; type?: BoatTypeEnum }) => ClubBoat;
  /** False, and nothing archived, while it is in an ongoing outing. */
  archiveBoat: (boatId: string) => boolean;
  getAllBoats: () => ClubBoat[];

  updateRouteName: (routeId: string, name: string) => void;
  updateRoute: (routeId: string, route: Partial<Omit<ClubRoute, "id">>) => void;
  /** False, and nothing archived, while it is in an ongoing outing. */
  archiveRoute: (routeId: string) => boolean;
  addRoute: (routeName: string, distanceM?: number | null) => ClubRoute;
  getRouteById: (routeId: string) => ClubRoute | undefined;
  getAllRoutes: () => ClubRoute[];

  updateRower: (rowerId: string, rower: UpdateRowerDto) => void;
  updateRowers: (rowerIds: string[], rower: BulkUpdateRowerDto) => void;
  /** False, and nothing archived, while it is in an ongoing outing. */
  archiveRower: (rowerId: string) => boolean;
  unarchiveRower: (rowerId: string) => void;
  addRower: (
    rowerName: string,
    category?: AgeCategoryEnum | null,
    type?: SeriousnessCategoryEnum | null,
    extra?: Partial<Omit<ClubRower, "id" | "name">>
  ) => ClubRower;
  getRowersById: (rowersId: string[]) => ClubRower[];
  getRowerById: (rowerId: string) => ClubRower | undefined;
  /** Members and other non-guest rowers that are neither archived nor merged. */
  getAllRowers: () => ClubRower[];
  getAllGuests: () => ClubRower[];

  setHashedPassword: (password: string) => void;

  reset: () => void;
}

const defaultClubOverviewState: ClubOverviewState = {
  club: {
    password: "",
  },
  boats: [],
  routes: [],
  rowers: [],
};

export const createBoat = (boat: {
  id?: string;
  name: string;
  type?: BoatTypeEnum;
  isInMaintenance?: boolean;
  note?: string;
}): ClubBoat => ({
  id: boat.id ?? v4(),
  name: boat.name,
  isInMaintenance: boat.isInMaintenance ?? false,
  type: boat.type || BoatTypeEnum.OTHER,
  note: boat.note ?? "",
  configurations: [
    {
      id: v4(),
      ...getConfigurationFromLegacyType(boat.type),
      isDefault: true,
      position: 0,
    },
  ],
});

export const createRower = (
  name: string,
  rower: Partial<Omit<ClubRower, "id" | "name">> & { id?: string } = {}
): ClubRower => {
  const split = splitRowerName(name);
  const firstName = rower.firstName ?? split.firstName;
  const lastName = rower.lastName ?? split.lastName;

  return {
    status: "member",
    ...rower,
    id: rower.id ?? v4(),
    firstName,
    lastName,
    name: getRowerFullName({ firstName, lastName }),
  };
};

export const createRoute = (route: {
  id?: string;
  name: string;
  distanceM?: number | null;
}): ClubRoute => ({
  id: route.id ?? v4(),
  name: route.name,
  distanceM: route.distanceM ?? null,
});

/** Records of an ongoing outing stay active until it is finished. */
const isInOngoingOuting = (record: {
  boatId?: string;
  rowerId?: string;
  routeId?: string;
}) =>
  useSessionsStore
    .getState()
    .getOngoingSessions()
    .some(
      (outing) =>
        outing.boat.id === record.boatId ||
        (record.routeId !== undefined && outing.route?.id === record.routeId) ||
        (record.rowerId !== undefined &&
          (outing.captainRowerId === record.rowerId ||
            outing.rowers.some((rower) => rower.id === record.rowerId)))
    );

export const useClubOverviewStore = create<ClubOverviewStoreState>()(
  devtools((set, get) => {
    const writeBoat = (boatId: string) => {
      const boat = get().clubOverview.boats.find((b) => b.id === boatId);
      if (boat) void enqueueWrite("boat", (db) => saveBoat(db, boat));
    };
    const writeRower = (rowerId: string) => {
      const rower = get().clubOverview.rowers.find((r) => r.id === rowerId);
      if (rower) void enqueueWrite("rower", (db) => saveRower(db, rower));
    };
    const writeRoute = (routeId: string) => {
      const route = get().clubOverview.routes.find((r) => r.id === routeId);
      if (route) void enqueueWrite("route", (db) => saveRoute(db, route));
    };
    const setBoats = (update: (boats: ClubBoat[]) => ClubBoat[]) => {
      set((state) => ({
        clubOverview: {
          ...state.clubOverview,
          boats: update(state.clubOverview.boats),
        },
      }));
    };
    const setRowers = (update: (rowers: ClubRower[]) => ClubRower[]) => {
      set((state) => ({
        clubOverview: {
          ...state.clubOverview,
          rowers: update(state.clubOverview.rowers),
        },
      }));
    };
    const setRoutes = (update: (routes: ClubRoute[]) => ClubRoute[]) => {
      set((state) => ({
        clubOverview: {
          ...state.clubOverview,
          routes: update(state.clubOverview.routes),
        },
      }));
    };

    return {
      clubOverview: defaultClubOverviewState,

      coachNote: "",

      hydrate: ({ clubOverview, coachNote }) => {
        set({ clubOverview, coachNote });
      },

      setHashedPassword: (password: string) => {
        set((state) => ({
          clubOverview: {
            ...state.clubOverview,
            club: {
              ...state.clubOverview.club,
              password,
            },
          },
        }));
        void enqueueWrite("password", (db) =>
          saveSetting(db, SETTING_PASSWORD_HASH, password)
        );
      },

      setCoachNote: (coachNote: string) => {
        set({ coachNote });
        void enqueueWrite("coach note", (db) =>
          saveSetting(db, SETTING_COACH_NOTE, coachNote)
        );
      },

      setClubOverview: (input) => {
        const clubOverview: ClubOverviewState = {
          club: input.club,
          boats: input.boats.map(createBoat),
          rowers: input.rowers.map((rower) =>
            createRower(rower.name, {
              id: rower.id,
              type: rower.type,
              category: rower.category,
            })
          ),
          routes: input.routes.map(createRoute),
        };

        set({ clubOverview });
        // A boat given as in maintenance starts with an "unavailable" entry.
        const damages: BoatDamage[] = clubOverview.boats
          .filter((boat) => boat.isInMaintenance)
          .map((boat) => ({
            id: v4(),
            boatId: boat.id,
            kind: "unavailable",
            severity: "unusable",
            description: "",
            reportedAt: new Date().toISOString(),
            reportedByRowerId: null,
            outingId: null,
            incidentId: null,
            fixedAt: null,
            fixedByRowerId: null,
            repairNote: null,
            repairCost: null,
          }));
        useDamageStore.getState().hydrate(damages);

        return enqueueWrite("club", async (db) => {
          try {
            // The onboarding starts from a clean slate and flags itself as
            // not done first: an app closed halfway reopens on the
            // onboarding, whose next attempt clears the partial club.
            await deleteAllClubData(db);
            await saveSetting(db, SETTING_ONBOARDING_DONE, false);
            await saveSetting(
              db,
              SETTING_PASSWORD_HASH,
              clubOverview.club.password
            );
            for (const boat of clubOverview.boats) await saveBoat(db, boat);
            for (const rower of clubOverview.rowers) await saveRower(db, rower);
            for (const route of clubOverview.routes) await saveRoute(db, route);
            for (const damage of damages) await saveBoatDamage(db, damage);
          } catch (error) {
            // Not atomic: a half-saved club would read as set up on the next
            // start. Remove it so the onboarding can simply be done again.
            await deleteAllClubData(db).catch(() => undefined);
            throw error;
          }
        });
      },

      getBoatById: (boatId: string) => {
        return get().clubOverview.boats.find((boat) => boat.id === boatId);
      },

      getRowersById: (rowersId: string[]) => {
        return get().clubOverview.rowers.filter((rower) =>
          rowersId.includes(rower.id)
        );
      },

      getRowerById: (rowerId: string) => {
        return get().clubOverview.rowers.find((rower) => rower.id === rowerId);
      },

      addBoat: ({ name: boatName, type: boatType }) => {
        const boat = createBoat({ name: boatName, type: boatType });
        setBoats((boats) => [...boats, boat]);
        writeBoat(boat.id);
        return boat;
      },

      archiveBoat: (boatId: string) => {
        if (isInOngoingOuting({ boatId })) return false;
        setBoats((boats) =>
          boats.map((boat) =>
            boat.id === boatId
              ? { ...boat, archivedAt: new Date().toISOString() }
              : boat
          )
        );
        writeBoat(boatId);
        return true;
      },

      updateBoatName: (boatId: string, name: string) => {
        setBoats((boats) => updateBoatNameFn(boats, boatId, name));
        writeBoat(boatId);
      },

      updateBoatNote: (boatId: string, note: string) => {
        setBoats((boats) => updateBoatNoteFn(boats, boatId, note));
        writeBoat(boatId);
      },

      updateBoat: (boatId, update) => {
        setBoats((boats) =>
          boats.map((boat) =>
            boat.id === boatId
              ? {
                  ...boat,
                  ...update,
                  configurations: withSingleDefault(
                    update.configurations ?? boat.configurations
                  ),
                }
              : boat
          )
        );
        writeBoat(boatId);
      },

      syncUnusableBoats: (unusableBoatIds) => {
        setBoats((boats) =>
          boats.map((boat) =>
            Boolean(boat.isInMaintenance) === unusableBoatIds.has(boat.id)
              ? boat
              : { ...boat, isInMaintenance: unusableBoatIds.has(boat.id) }
          )
        );
      },

      getRouteById: (routeId: string) => {
        return get().clubOverview.routes.find((route) => route.id === routeId);
      },

      updateRouteName: (routeId: string, name: string) => {
        setRoutes((routes) =>
          routes.map((route) =>
            route.id === routeId ? { ...route, name } : route
          )
        );
        writeRoute(routeId);
      },

      updateRoute: (routeId, update) => {
        setRoutes((routes) =>
          routes.map((route) =>
            route.id === routeId ? { ...route, ...update } : route
          )
        );
        writeRoute(routeId);
      },

      archiveRoute: (routeId: string) => {
        if (isInOngoingOuting({ routeId })) return false;
        setRoutes((routes) =>
          routes.map((route) =>
            route.id === routeId
              ? { ...route, archivedAt: new Date().toISOString() }
              : route
          )
        );
        writeRoute(routeId);
        return true;
      },

      addRoute: (routeName: string, distanceM?: number | null) => {
        const route = createRoute({ name: routeName, distanceM });
        setRoutes((routes) => [...routes, route]);
        writeRoute(route.id);
        return route;
      },

      updateRower: (rowerId: string, rower: UpdateRowerDto) => {
        setRowers((rowers) =>
          rowers.map((r) => {
            if (r.id !== rowerId) return r;

            const names =
              rower.firstName !== undefined || rower.lastName !== undefined
                ? {
                    firstName: rower.firstName ?? r.firstName,
                    lastName: rower.lastName ?? r.lastName,
                  }
                : rower.name !== undefined
                  ? splitRowerName(rower.name)
                  : { firstName: r.firstName, lastName: r.lastName };

            return {
              ...r,
              ...rower,
              ...names,
              name: getRowerFullName(names),
            };
          })
        );
        writeRower(rowerId);
      },

      updateRowers: (rowerIds: string[], rower: BulkUpdateRowerDto) => {
        setRowers((rowers) =>
          rowers.map((r) => (rowerIds.includes(r.id) ? { ...r, ...rower } : r))
        );
        rowerIds.forEach(writeRower);
      },

      archiveRower: (rowerId: string) => {
        if (isInOngoingOuting({ rowerId })) return false;
        setRowers((rowers) =>
          rowers.map((rower) =>
            rower.id === rowerId
              ? { ...rower, archivedAt: new Date().toISOString() }
              : rower
          )
        );
        writeRower(rowerId);
        return true;
      },

      unarchiveRower: (rowerId: string) => {
        setRowers((rowers) =>
          rowers.map((rower) =>
            rower.id === rowerId ? { ...rower, archivedAt: undefined } : rower
          )
        );
        writeRower(rowerId);
      },

      addRower: (rowerName, category, type, extra) => {
        const rower = createRower(rowerName, {
          category: category || undefined,
          type: type || undefined,
          ...extra,
        });
        setRowers((rowers) => [...rowers, rower]);
        writeRower(rower.id);
        return rower;
      },

      reset: () => {
        set({ clubOverview: defaultClubOverviewState, coachNote: "" });
      },

      getAllBoats: () => {
        return get().clubOverview.boats.filter((boat) => !boat.archivedAt);
      },
      getAllRoutes: () => {
        return get().clubOverview.routes.filter((route) => !route.archivedAt);
      },
      getAllRowers: () => {
        return get().clubOverview.rowers.filter(
          (rower) =>
            !rower.archivedAt && !rower.mergedIntoId && rower.status !== "guest"
        );
      },
      getAllGuests: () => {
        return get().clubOverview.rowers.filter(
          (rower) =>
            !rower.archivedAt && !rower.mergedIntoId && rower.status === "guest"
        );
      },
    };
  })
);
