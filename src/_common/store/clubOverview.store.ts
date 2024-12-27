import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  toggleBoatIsInMaintenanceFn,
  updateBoatNameFn,
  updateBoatTypeFn,
} from "./clubOverview.store.functions";
import { BoatTypeEnum } from "../types/boat.type";
import { generateBoatId } from "../business/boat.rules";

export interface ClubOverviewState {
  club: {
    password: string;
  };
  boats: {
    id: string;
    name: string;
    isInMaintenance?: boolean;
    type?: BoatTypeEnum;
    archivedAt?: string | undefined;
  }[];
  routes: {
    id: string;
    name: string;
    archivedAt?: string | undefined;
  }[];
  rowers: {
    id: string;
    name: string;
    archivedAt?: string | undefined;
  }[];
}

export interface ClubOverviewStoreState {
  clubOverview: ClubOverviewState;
  coachNote: string;

  setCoachNote: (coachNote: string) => void;

  setClubOverview: (clubOverview: ClubOverviewState) => void;

  getBoatById: (boatId: string) => ClubOverviewState["boats"][0] | undefined;
  updateBoatType: (boatId: string, type: BoatTypeEnum) => void;
  updateBoatName: (boatId: string, name: string) => void;
  toggleBoatIsInMaintenance: (boatId: string) => void;
  addBoat: (boat: { name: string; type?: BoatTypeEnum }) => void;
  archiveBoat: (boatId: string) => void;
  getAllBoats: () => ClubOverviewState["boats"];

  updateRouteName: (routeId: string, name: string) => void;
  archiveRoute: (routeId: string) => void;
  addRoute: (routeName: string) => void;
  getRouteById: (
    routeId: string
  ) => ClubOverviewState["routes"][number] | undefined;
  getAllRoutes: () => ClubOverviewState["routes"];

  updateRowerName: (rowerId: string, name: string) => void;
  archiveRower: (rowerId: string) => void;
  addRower: (rowerName: string) => void;
  getRowersById: (rowersId: string[]) => ClubOverviewState["rowers"];
  getRowerById: (rowerId: string) => ClubOverviewState["rowers"][0] | undefined;
  getAllRowers: () => ClubOverviewState["rowers"];

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

export const useClubOverviewStore = create<ClubOverviewStoreState>()(
  devtools(
    persist(
      (set, get) => ({
        clubOverview: defaultClubOverviewState,

        coachNote: "",

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
        },

        setCoachNote: (coachNote: string) => {
          set(() => {
            return {
              coachNote,
            };
          });
        },

        setClubOverview: (
          clubOverview: ClubOverviewStoreState["clubOverview"]
        ) => {
          set(() => {
            return {
              clubOverview,
            };
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
          return get().clubOverview.rowers.find(
            (rower) => rower.id === rowerId
          );
        },

        addBoat: ({ name: boatName, type: boatType }) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: [
                ...state.clubOverview.boats,
                {
                  id: generateBoatId(),
                  name: boatName,
                  isInMaintenance: false,
                  type: boatType || BoatTypeEnum.OTHER,
                },
              ],
            },
          }));
        },

        archiveBoat: (boatId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: state.clubOverview.boats.map((boat) =>
                boat.id === boatId
                  ? {
                      ...boat,
                      archivedAt: new Date().toISOString(),
                    }
                  : boat
              ),
            },
          }));
        },

        updateBoatType: (boatId: string, type: BoatTypeEnum) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: updateBoatTypeFn(state.clubOverview.boats, boatId, type),
            },
          }));
        },

        updateBoatName: (boatId: string, name: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: updateBoatNameFn(state.clubOverview.boats, boatId, name),
            },
          }));
        },

        toggleBoatIsInMaintenance: (boatId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: toggleBoatIsInMaintenanceFn(
                state.clubOverview.boats,
                boatId
              ),
            },
          }));
        },

        getRouteById: (routeId: string) => {
          return get().clubOverview.routes.find(
            (route) => route.id === routeId
          );
        },

        updateRouteName: (routeId: string, name: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              routes: state.clubOverview.routes.map((route) =>
                route.id === routeId ? { ...route, name } : route
              ),
            },
          }));
        },

        archiveRoute: (routeId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              routes: state.clubOverview.routes.map((route) =>
                route.id === routeId
                  ? {
                      ...route,
                      archivedAt: new Date().toISOString(),
                    }
                  : route
              ),
            },
          }));
        },

        addRoute: (routeName: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              routes: [
                ...state.clubOverview.routes,
                {
                  id: Math.random().toString(),
                  name: routeName,
                },
              ],
            },
          }));
        },

        updateRowerName: (rowerId: string, name: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              rowers: state.clubOverview.rowers.map((rower) =>
                rower.id === rowerId ? { ...rower, name } : rower
              ),
            },
          }));
        },

        archiveRower: (rowerId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              rowers: state.clubOverview.rowers.map((rower) =>
                rower.id === rowerId
                  ? {
                      ...rower,
                      archivedAt: new Date().toISOString(),
                    }
                  : rower
              ),
            },
          }));
        },

        addRower: (rowerName: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              rowers: [
                ...state.clubOverview.rowers,
                {
                  id: Math.random().toString(),
                  name: rowerName,
                },
              ],
            },
          }));
        },

        reset: () => {
          set(() => {
            return {
              clubOverview: defaultClubOverviewState,
              coachNote: "",
            };
          });
        },

        getAllBoats: () => {
          const boats = get().clubOverview.boats.filter(
            (boat) => !boat.archivedAt
          );
          return boats;
        },
        getAllRoutes: () => {
          const routes = get().clubOverview.routes.filter(
            (route) => !route.archivedAt
          );
          return routes;
        },
        getAllRowers: () => {
          const rowers = get().clubOverview.rowers.filter(
            (rower) => !rower.archivedAt
          );
          return rowers;
        },
      }),
      {
        name: "clubOverview",
      }
    )
  )
);
