import { create } from "zustand";
import { enqueueWrite } from "../database/writeQueue";
import { saveSetting } from "../database/repositories/club.repository";

export const SETTING_ALL_BOATS_BACK_BANNER = "boathouse.allBoatsBackBanner";
export const SETTING_CLUB_LATITUDE = "club.latitude";
export const SETTING_CLUB_LONGITUDE = "club.longitude";

interface BoathouseSettingsState {
  /** Show a reminder to close the boathouse when the last outing ends. */
  allBoatsBackBanner: boolean;
  /** Club location, used for sunrise and sunset. Null when not set. */
  clubLatitude: number | null;
  clubLongitude: number | null;
  hydrate: (settings: Record<string, unknown>) => void;
  setAllBoatsBackBanner: (enabled: boolean) => void;
  setClubLocation: (latitude: number | null, longitude: number | null) => void;
  reset: () => void;
}

const write = (key: string, value: unknown) => {
  void enqueueWrite(`setting ${key}`, (db) => saveSetting(db, key, value));
};

const toCoordinate = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const useBoathouseSettingsStore = create<BoathouseSettingsState>()(
  (set) => ({
    allBoatsBackBanner: true,
    clubLatitude: null,
    clubLongitude: null,
    hydrate(settings) {
      set({
        allBoatsBackBanner: settings[SETTING_ALL_BOATS_BACK_BANNER] !== false,
        clubLatitude: toCoordinate(settings[SETTING_CLUB_LATITUDE]),
        clubLongitude: toCoordinate(settings[SETTING_CLUB_LONGITUDE]),
      });
    },
    setAllBoatsBackBanner(enabled) {
      set({ allBoatsBackBanner: enabled });
      write(SETTING_ALL_BOATS_BACK_BANNER, enabled);
    },
    setClubLocation(latitude, longitude) {
      set({ clubLatitude: latitude, clubLongitude: longitude });
      write(SETTING_CLUB_LATITUDE, latitude);
      write(SETTING_CLUB_LONGITUDE, longitude);
    },
    reset() {
      set({
        allBoatsBackBanner: true,
        clubLatitude: null,
        clubLongitude: null,
      });
    },
  }),
);
