import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import i18n from "../i18n/config";
import { runBackup } from "../backup/backup.tauri";
import { flushWrites } from "../database/writeQueue";
import {
  getDownloadPercent,
  getReleaseNotes,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_DOWNLOAD_TIMEOUT_MS,
} from "./update.rules";
import { useLocaleStore } from "../store/locale.store";
import { useOnboardingStore } from "../../onboarding/onboarding.store";
import { isUpdateBusy, useUpdateStore } from "./update.store";
import { isDemoMode } from "../../demo/demoMode";

/** The checked update; the store only keeps what the screens show. */
let pendingUpdate: Update | null = null;
/**
 * The update whose bytes are downloaded (and signature-checked). A retry
 * after a failed backup or install reuses them: downloading again would
 * keep the first ~100 MB in memory until the update is closed.
 */
let downloadedUpdate: Update | null = null;
/** Each new version is announced once per launch. */
let announcedVersion: string | null = null;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let checkInFlight: Promise<boolean> | null = null;

export class UpdateBackupFailedError extends Error {}

/** Installing restarts the app without the usual backup of the real club. */
export class UpdateBlockedInDemoError extends Error {}

/**
 * Asks the public releases for a newer version. Resolves to whether one is
 * available; a failure (offline boathouse) only matters when asked by hand.
 */
export const checkForUpdate = async ({ manual }: { manual: boolean }) => {
  // Asked by hand during a background check: wait for it, then ask again so
  // the answer and its errors are this check's own.
  // Several manual checks queue behind each other the same way.
  while (manual && checkInFlight) await checkInFlight;
  const store = useUpdateStore.getState();
  if (store.phase !== "idle" && store.phase !== "failed") {
    return store.available !== null;
  }
  store.setPhase("checking");
  const result = runCheck({ manual });
  checkInFlight = result.catch(() => false);
  try {
    return await result;
  } finally {
    checkInFlight = null;
  }
};

/** The update screens only exist once the club is set up. */
const canAnnounce = () =>
  useLocaleStore.getState().locale !== null &&
  useOnboardingStore.getState().isOnboarded;

const runCheck = async ({ manual }: { manual: boolean }) => {
  try {
    // Without a timeout a stalled connection would keep "checking" for good.
    const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
    // An install started meanwhile owns the checked update: leave it alone.
    if (useUpdateStore.getState().phase !== "checking") {
      await update?.close().catch(() => undefined);
      return useUpdateStore.getState().available !== null;
    }
    await pendingUpdate?.close().catch(() => undefined);
    pendingUpdate = update;
    useUpdateStore.getState().setAvailable(
      update
        ? {
            version: update.version,
            currentVersion: update.currentVersion,
            notes: getReleaseNotes(update.body, update.version),
          }
        : null
    );
    // The version is no longer offered: a later one must not pop up alone.
    if (!update) useUpdateStore.getState().setDialogOpen(false);
    useUpdateStore.getState().setPhase("idle");
    if (
      update &&
      !manual &&
      announcedVersion !== update.version &&
      canAnnounce()
    ) {
      announcedVersion = update.version;
      toast.info(i18n.t("update.available", { version: update.version }), {
        duration: 30000,
        action: {
          label: i18n.t("update.see"),
          onClick: () => useUpdateStore.getState().setDialogOpen(true),
        },
      });
    }
    return update !== null;
  } catch (error) {
    if (useUpdateStore.getState().phase === "checking") {
      useUpdateStore.getState().setPhase("idle");
    }
    if (manual) throw error;
    console.error("❌ Update check failed", error);
    return false;
  }
};

/** Check at start-up and every 6 hours; never in development. */
export const startUpdateChecks = () => {
  if (import.meta.env.DEV) return;
  void checkForUpdate({ manual: false });
  updateCheckTimer ??= setInterval(() => {
    void checkForUpdate({ manual: false });
  }, UPDATE_CHECK_INTERVAL_MS);
};

/**
 * Downloads the update, backs the club data up, installs the update and
 * restarts the app. Nothing is installed when the backup fails. On Windows
 * the installer closes the app itself and starts the new version.
 */
export const installUpdate = async () => {
  // The backup made before installing would save the demo, not the club.
  if (isDemoMode()) throw new UpdateBlockedInDemoError();
  // A background check started meanwhile (e.g. during the admin password):
  // install the update it finds rather than ignore the click.
  if (checkInFlight) await checkInFlight;
  const store = useUpdateStore.getState();
  // One install at a time, and never while a check replaces the update.
  if (store.phase === "checking" || isUpdateBusy(store.phase)) return;
  if (!pendingUpdate) return;
  const update = pendingUpdate;

  let total: number | undefined;
  let downloaded = 0;
  try {
    store.setPhase("download");
    if (downloadedUpdate !== update) {
      // The check timeout would also cap the download: give it its own, so a
      // dropped connection ends in "failed" instead of a dialog stuck open.
      await update.download(
        (event) => {
          if (event.event === "Started") {
            total = event.data.contentLength;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            store.setPhase("download", getDownloadPercent(downloaded, total));
          }
        },
        { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS }
      );
      downloadedUpdate = update;
    }
  } catch (error) {
    store.setPhase("failed");
    throw error;
  }

  // Backed up once downloaded, right before installing: the backup holds the
  // outings logged during a long download too.
  store.setPhase("backup");
  try {
    await runBackup("before-update");
  } catch (error) {
    console.error("❌ Backup before update failed", error);
    store.setPhase("failed");
    throw new UpdateBackupFailedError();
  }

  try {
    store.setPhase("install");
    // Writes made since the backup land before the installer stops the app.
    await flushWrites();
    await update.install();
    // Installed: the plugin has dropped the bytes, a retry downloads again.
    downloadedUpdate = null;
    await relaunch();
  } catch (error) {
    store.setPhase("failed");
    throw error;
  }
};
