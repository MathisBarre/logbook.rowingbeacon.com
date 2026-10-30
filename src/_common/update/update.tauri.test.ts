import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  runBackup: vi.fn(),
  flushWrites: vi.fn(),
  steps: [] as string[],
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugin.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugin.relaunch }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("../i18n/config", () => ({ default: { t: (key: string) => key } }));
vi.mock("../backup/backup.tauri", () => ({ runBackup: plugin.runBackup }));
vi.mock("../database/writeQueue", () => ({
  flushWrites: plugin.flushWrites,
}));
vi.mock("../store/locale.store", () => ({
  useLocaleStore: { getState: () => ({ locale: "fr-FR" }) },
}));
vi.mock("../../onboarding/onboarding.store", () => ({
  useOnboardingStore: { getState: () => ({ isOnboarded: true }) },
}));

/** Records a plugin call, in order, as an async call would resolve. */
const step = (name: string) => {
  plugin.steps.push(name);
  return Promise.resolve();
};

const fakeUpdate = (version: string) => ({
  version,
  currentVersion: "2.0.1",
  body: `Rowing Beacon v${version}`,
  download: vi.fn(() => step(`download ${version}`)),
  install: vi.fn(() => step(`install ${version}`)),
  close: vi.fn(() => Promise.resolve()),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Module state (checked update, running check) is fresh in each test. */
const load = async () => {
  vi.resetModules();
  const updates = await import("./update.tauri");
  const { useUpdateStore } = await import("./update.store");
  return { ...updates, useUpdateStore };
};

beforeEach(() => {
  plugin.steps = [];
  plugin.check.mockReset();
  plugin.relaunch.mockReset().mockImplementation(() => step("relaunch"));
  plugin.runBackup.mockReset().mockImplementation(() => step("backup"));
  plugin.flushWrites.mockReset().mockImplementation(() => step("flush"));
});

describe("installUpdate", () => {
  it("downloads, backs up, then installs and restarts", async () => {
    const { checkForUpdate, installUpdate, useUpdateStore } = await load();
    plugin.check.mockResolvedValue(fakeUpdate("2.1.0"));
    await checkForUpdate({ manual: true });

    await installUpdate();

    expect(plugin.steps).toEqual([
      "download 2.1.0",
      "backup",
      "flush",
      "install 2.1.0",
      "relaunch",
    ]);
    expect(useUpdateStore.getState().phase).toBe("install");
  });

  it("installs nothing when the backup fails", async () => {
    const {
      checkForUpdate,
      installUpdate,
      UpdateBackupFailedError,
      useUpdateStore,
    } = await load();
    const update = fakeUpdate("2.1.0");
    plugin.check.mockResolvedValue(update);
    await checkForUpdate({ manual: true });
    plugin.runBackup.mockRejectedValue(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(installUpdate()).rejects.toBeInstanceOf(
      UpdateBackupFailedError
    );
    expect(update.install).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().phase).toBe("failed");
  });

  it("retries without downloading again after a failed backup", async () => {
    const { checkForUpdate, installUpdate } = await load();
    const update = fakeUpdate("2.1.0");
    plugin.check.mockResolvedValue(update);
    await checkForUpdate({ manual: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    plugin.runBackup.mockRejectedValueOnce(new Error("disk full"));
    await expect(installUpdate()).rejects.toThrow();

    await installUpdate();

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("downloads again when the restart failed after an install", async () => {
    const { checkForUpdate, installUpdate } = await load();
    const update = fakeUpdate("2.1.0");
    plugin.check.mockResolvedValue(update);
    await checkForUpdate({ manual: true });
    plugin.relaunch.mockRejectedValueOnce(new Error("no restart"));
    await expect(installUpdate()).rejects.toThrow("no restart");

    await installUpdate();

    expect(update.download).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledTimes(2);
  });

  it("downloads the new update found after a failed install", async () => {
    const { checkForUpdate, installUpdate } = await load();
    const first = fakeUpdate("2.1.0");
    first.install.mockRejectedValueOnce(new Error("read-only"));
    plugin.check.mockResolvedValueOnce(first);
    await checkForUpdate({ manual: true });
    await expect(installUpdate()).rejects.toThrow("read-only");
    const second = fakeUpdate("2.1.1");
    plugin.check.mockResolvedValueOnce(second);
    await checkForUpdate({ manual: false });

    await installUpdate();

    expect(second.download).toHaveBeenCalledTimes(1);
    expect(second.install).toHaveBeenCalledTimes(1);
  });

  it("runs once on a double click", async () => {
    const { checkForUpdate, installUpdate } = await load();
    const update = fakeUpdate("2.1.0");
    plugin.check.mockResolvedValue(update);
    await checkForUpdate({ manual: true });

    await Promise.all([installUpdate(), installUpdate()]);

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(plugin.runBackup).toHaveBeenCalledTimes(1);
  });

  it("waits for a background check, then installs what it found", async () => {
    const { checkForUpdate, installUpdate } = await load();
    plugin.check.mockResolvedValueOnce(fakeUpdate("2.1.0"));
    await checkForUpdate({ manual: true });
    const answer = deferred<ReturnType<typeof fakeUpdate>>();
    plugin.check.mockReturnValueOnce(answer.promise);
    const background = checkForUpdate({ manual: false });

    const install = installUpdate();
    answer.resolve(fakeUpdate("2.1.1"));
    await Promise.all([background, install]);

    expect(plugin.steps[0]).toBe("download 2.1.1");
    expect(plugin.steps).toContain("install 2.1.1");
  });

  it("is not replaced by a background check during the download", async () => {
    const { checkForUpdate, installUpdate, useUpdateStore } = await load();
    const update = fakeUpdate("2.1.0");
    const download = deferred<void>();
    update.download.mockReturnValueOnce(download.promise);
    plugin.check.mockResolvedValue(update);
    await checkForUpdate({ manual: true });

    const install = installUpdate();
    expect(await checkForUpdate({ manual: false })).toBe(true);
    expect(useUpdateStore.getState().phase).toBe("download");
    download.resolve();
    await install;

    expect(plugin.check).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });
});

describe("checkForUpdate", () => {
  it("asks again after a background check when asked by hand", async () => {
    const { checkForUpdate } = await load();
    const background = deferred<null>();
    plugin.check.mockReturnValueOnce(background.promise);
    plugin.check.mockResolvedValueOnce(fakeUpdate("2.1.0"));

    const first = checkForUpdate({ manual: false });
    const manual = checkForUpdate({ manual: true });
    background.resolve(null);

    expect(await first).toBe(false);
    expect(await manual).toBe(true);
    expect(plugin.check).toHaveBeenCalledTimes(2);
  });

  it("queues manual checks behind each other", async () => {
    const { checkForUpdate } = await load();
    const background = deferred<null>();
    plugin.check.mockReturnValueOnce(background.promise);
    plugin.check.mockResolvedValue(null);

    const first = checkForUpdate({ manual: false });
    const second = checkForUpdate({ manual: true });
    const third = checkForUpdate({ manual: true });
    background.resolve(null);
    await Promise.all([first, second, third]);

    expect(plugin.check).toHaveBeenCalledTimes(3);
  });

  it("closes the dialog when the version is no longer offered", async () => {
    const { checkForUpdate, useUpdateStore } = await load();
    plugin.check.mockResolvedValueOnce(fakeUpdate("2.1.0"));
    await checkForUpdate({ manual: true });
    useUpdateStore.getState().setDialogOpen(true);

    plugin.check.mockResolvedValueOnce(null);
    await checkForUpdate({ manual: false });

    expect(useUpdateStore.getState().available).toBeNull();
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
  });

  it("only throws a failed check when asked by hand", async () => {
    const { checkForUpdate, useUpdateStore } = await load();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    plugin.check.mockRejectedValue(new Error("offline"));

    expect(await checkForUpdate({ manual: false })).toBe(false);
    await expect(checkForUpdate({ manual: true })).rejects.toThrow("offline");
    expect(useUpdateStore.getState().phase).toBe("idle");
  });
});
