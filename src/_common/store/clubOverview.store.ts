import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  toggleBoatIsInMaintenanceFn,
  updateBoatNameFn,
  updateBoatTypeFn,
} from "./clubOverview.store.functions";
import { BoatTypeEnum } from "../types/boat.type";
import { generateBoatId } from "../business/boat.rules";

export enum ProductChoiceEnum {
  CLASSIC = "CLASSIC",
  CLOUD = "CLOUD",
}

export interface ClubOverviewState {
  club: {
    password: string;
  };
  boats: {
    id: string;
    name: string;
    isInMaintenance?: boolean;
    type?: BoatTypeEnum;
  }[];
  routes: {
    id: string;
    name: string;
  }[];
  rowers: {
    id: string;
    name: string;
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
  addBoat: (boatName: string) => void;
  deleteBoat: (boatId: string) => void;

  updateRouteName: (routeId: string, name: string) => void;
  deleteRoute: (routeId: string) => void;
  addRoute: (routeName: string) => void;
  getRouteById: (
    routeId: string
  ) => ClubOverviewState["routes"][number] | undefined;

  updateRowerName: (rowerId: string, name: string) => void;
  deleteRower: (rowerId: string) => void;
  addRower: (rowerName: string) => void;
  getRowersById: (rowersId: string[]) => ClubOverviewState["rowers"];

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

        addBoat: (boatName: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: [
                ...state.clubOverview.boats,
                {
                  id: generateBoatId(),
                  name: boatName,
                  isInMaintenance: false,
                },
              ],
            },
          }));
        },

        deleteBoat: (boatId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              boats: state.clubOverview.boats.filter(
                (boat) => boat.id !== boatId
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

        deleteRoute: (routeId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              routes: state.clubOverview.routes.filter(
                (route) => route.id !== routeId
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

        deleteRower: (rowerId: string) => {
          set((state) => ({
            clubOverview: {
              ...state.clubOverview,
              rowers: state.clubOverview.rowers.filter(
                (rower) => rower.id !== rowerId
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
      }),
      {
        name: "clubOverview",
      }
    )
  )
);
