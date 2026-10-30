import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  getExpiredV1Backups,
  getV1BackupDate,
  toV1BackupFileName,
} from "./v1Migration/v1Backups";
import { appDataDir, join } from "@tauri-apps/api/path";
import i18n from "../i18n/config";
import { getDatabase } from "./database";
import { loadClubData } from "./repositories/club.repository";
import { upgradeToBoatDamages } from "./upgradeToBoatDamages";
import {
  runV1Migration,
  V1MigrationResult,
} from "./v1Migration/runV1Migration";
import { setReloadAfterFailedWrite, setWriteClient } from "./writeQueue";
import { SqlClient } from "./sqlClient";
import {
  SETTING_COACH_NOTE,
  SETTING_PASSWORD_HASH,
  useClubOverviewStore,
} from "../store/clubOverview.store";
import { useSessionsStore } from "../store/sessions.store";
import { useModulesStore } from "../store/modules.store";
import { useBoathouseSettingsStore } from "../store/boathouseSettings.store";
import { useAnalyticsSettingsStore } from "../../analytics/store/analyticsSettings.store";
import { ensureMachineInfo } from "../../analytics/engine/activePerformance";
import useIncidentStore from "../store/incident.store";
import { useDamageStore } from "../store/damage.store";
import { useReservationStore } from "../store/reservation.store";
import { loadReservations } from "./repositories/reservation.repository";
import { useOnboardingStore } from "../../onboarding/onboarding.store";
import {
  boatLevelConfigStoreCore,
  SETTING_BOAT_TYPE_LEVEL_CONFIGS,
} from "../store/boatLevelConfig.store";
import {
  BoatTypeLevelConfigs,
  DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
} from "../store/boatLevelConfig.rules";

const writeV1Backup = async (content: string) => {
  const fileName = toV1BackupFileName(new Date());
  await mkdir("backups", { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(`backups/${fileName}`, content, {
    baseDir: BaseDirectory.AppData,
  });
  return join(await appDataDir(), "backups", fileName);
};

/** Deletes the chosen v1 backups; resolves with false when it failed. */
const removeV1Backups = async (select: (fileNames: string[]) => string[]) => {
  try {
    if (!(await exists("backups", { baseDir: BaseDirectory.AppData }))) {
      return true;
    }
    const entries = await readDir("backups", {
      baseDir: BaseDirectory.AppData,
    });
    const selected = select(
      entries.filter((entry) => entry.isFile).map((entry) => entry.name)
    );
    for (const fileName of selected) {
      await remove(`backups/${fileName}`, { baseDir: BaseDirectory.AppData });
    }
    return true;
  } catch (error) {
    console.error("❌ Failed to delete v1 backups", error);
    return false;
  }
};

const DAY_IN_MS = 24 * 3600 * 1000;
let pruneTimer: ReturnType<typeof setInterval> | null = null;

/** Deletes v1 backups past their retention; never blocks the start. */
const pruneV1Backups = () =>
  removeV1Backups((fileNames) => getExpiredV1Backups(fileNames, new Date()));

/** The v1 backups hold every name of the club: "delete data" removes them. */
export const deleteAllV1Backups = () =>
  removeV1Backups((fileNames) =>
    fileNames.filter((fileName) => getV1BackupDate(fileName) !== null)
  );

/**
 * Replace every in-memory store with what SQLite holds. Resolves with true
 * when the onboarding flag is still to be saved.
 */
export const loadIntoStores = async (db: SqlClient) => {
  const data = await loadClubData(db);

  useClubOverviewStore.getState().hydrate({
    clubOverview: {
      club: {
        password: (data.settings[SETTING_PASSWORD_HASH] as string) ?? "",
      },
      boats: data.boats,
      rowers: data.rowers,
      routes: data.routes,
    },
    coachNote: (data.settings[SETTING_COACH_NOTE] as string) ?? "",
  });
  useModulesStore.getState().hydrate(data.settings);
  useBoathouseSettingsStore.getState().hydrate(data.settings);
  useAnalyticsSettingsStore.getState().hydrate(data.settings);
  const onboardingToSave = useOnboardingStore
    .getState()
    .hydrate(
      data.settings,
      Boolean(data.settings[SETTING_PASSWORD_HASH]) || data.boats.length > 0,
      (key) => window.localStorage.getItem(key)
    );
  useSessionsStore.getState().hydrate(data.ongoingOutings);
  useIncidentStore.getState().hydrate(data.incidents);
  useDamageStore
    .getState()
    .hydrate(data.damages, data.legacyMaintenanceBoatIds);
  useReservationStore.getState().hydrate(await loadReservations(db), data.settings);
  boatLevelConfigStoreCore.getState().hydrate({
    boatTypeLevelConfigs: {
      ...DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
      ...((data.settings[SETTING_BOAT_TYPE_LEVEL_CONFIGS] as
        | Partial<BoatTypeLevelConfigs>
        | undefined) ?? {}),
    },
    boatLevelConfigs: data.boatLevelConfigs,
  });

  return onboardingToSave;
};

/**
 * Open the database, migrate v1 data if needed, then load every club record
 * into the in-memory stores (ADR 0003).
 */
export const bootstrapClubData = async (): Promise<V1MigrationResult> => {
  const { db } = await getDatabase();

  const migration = await runV1Migration(db, {
    readLocalStorage: (key) => window.localStorage.getItem(key),
    removeLocalStorage: (key) => window.localStorage.removeItem(key),
    writeBackup: writeV1Backup,
    unknownLabels: {
      boat: i18n.t("migration.unknownBoat"),
      rower: i18n.t("migration.unknownRower"),
      route: i18n.t("migration.unknownRoute"),
    },
  });

  try {
    await upgradeToBoatDamages(db);
  } catch (error) {
    // Retried on the next start; the boats keep showing as before.
    console.error("❌ Failed to move data to boat damages", error);
  }

  if (await loadIntoStores(db)) {
    void useOnboardingStore.getState().saveDerivedFlag();
  }
  // The performance profile "auto" needs the machine: ask now, so the
  // first analytics queries start with their final timeouts.
  void ensureMachineInfo();
  void pruneV1Backups();
  // A boathouse computer may stay on for months: purge daily too.
  if (!pruneTimer) {
    pruneTimer = setInterval(() => void pruneV1Backups(), DAY_IN_MS);
  }

  setReloadAfterFailedWrite(loadIntoStores);
  setWriteClient(db);

  return migration;
};
