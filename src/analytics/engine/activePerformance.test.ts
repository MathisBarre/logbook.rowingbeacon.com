import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../_common/i18n/config";
import "../i18n";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type { QueryResult, RunQueryRequest } from "../types";
import {
  getActivePerformance,
  getEditorMaxRows,
  getQueryTimeoutMs,
  useMachineStore,
} from "./activePerformance";
import { AnalyticsEngine, setEngineForTests } from "./engine";
import { AnalyticsError, formatAnalyticsError } from "./errors";
import type { MachineInfo } from "./performance";
import { createRequest, resetQueueForTests, runQuery } from "./queue";

const GIB = 1024 * 1024 * 1024;
const laptop: MachineInfo = {
  totalMemoryBytes: 16 * GIB,
  logicalCpus: 8,
  arch: "x86_64",
  os: "windows",
  raspberryPi: false,
  recommended: "powerful",
};

beforeEach(async () => {
  useAnalyticsSettingsStore.getState().reset();
  useMachineStore.setState({ machine: null, status: "idle" });
  resetQueueForTests();
  await i18n.changeLanguage("fr-FR");
});
afterEach(() => {
  setEngineForTests(null);
  useMachineStore.setState({ machine: null, status: "idle" });
});

describe("the performance profile in use", () => {
  it("is Économe until the machine is known", () => {
    expect(getActivePerformance().profile).toBe("economy");
    expect(getQueryTimeoutMs()).toBe(10_000);
    expect(getEditorMaxRows()).toBe(1000);
    expect(createRequest({ sql: "SELECT 1" }).timeoutMs).toBe(20_000);
  });

  it("follows the machine on Auto, and the club's choice otherwise", () => {
    useMachineStore.getState().setMachine(laptop);
    expect(getActivePerformance().profile).toBe("powerful");
    expect(getQueryTimeoutMs()).toBe(60_000);
    expect(getEditorMaxRows()).toBe(10_000);
    expect(createRequest({ sql: "SELECT 1" }).timeoutMs).toBe(120_000);

    const settings = useAnalyticsSettingsStore.getState();
    settings.setPerformanceProfile("economy");
    expect(getQueryTimeoutMs()).toBe(10_000);
    settings.setQueryTimeoutSeconds(90);
    // Clamped to Économe's 30 s.
    expect(getQueryTimeoutMs()).toBe(30_000);
    settings.setPerformanceProfile("standard");
    expect(getQueryTimeoutMs()).toBe(90_000);
  });

  it("runs two queries at once on Puissant, one on Économe", async () => {
    const started: string[] = [];
    const finish: (() => void)[] = [];
    const engine: AnalyticsEngine = {
      run: (request: RunQueryRequest) =>
        new Promise<QueryResult>((resolve) => {
          started.push(request.sql);
          finish.push(() =>
            resolve({
              columns: [],
              rows: [],
              truncated: false,
              elapsedMs: 1,
              ignoredColumns: [],
              cached: false,
            })
          );
        }),
      cancel: () => Promise.resolve(),
      objects: () =>
        Promise.resolve({ views: [], tables: [], missingViews: [] }),
    };
    setEngineForTests(engine);
    const run = (sql: string) => void runQuery(createRequest({ sql }));

    run("a");
    run("b");
    expect(started).toEqual(["a"]);
    finish.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b"]);
    finish.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    useMachineStore.getState().setMachine(laptop);
    run("c");
    run("d");
    run("e");
    expect(started).toEqual(["a", "b", "c", "d"]);
    finish.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
  });

  // Review D, M1: SQLite counts the memory of the whole process, so free
  // SQL and heavy reports never share it with another query.
  it("runs an exclusive query alone, even on Puissant", async () => {
    useMachineStore.getState().setMachine(laptop);
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    setEngineForTests({
      run: (request: RunQueryRequest) =>
        new Promise<QueryResult>((resolve) => {
          started.push(request.sql);
          finish.set(request.sql, () =>
            resolve({
              columns: [],
              rows: [],
              truncated: false,
              elapsedMs: 1,
              ignoredColumns: [],
              cached: false,
            })
          );
        }),
      cancel: () => Promise.resolve(),
      objects: () =>
        Promise.resolve({ views: [], tables: [], missingViews: [] }),
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const done = async (sql: string) => {
      finish.get(sql)?.();
      await tick();
    };
    const run = (sql: string, exclusive = false) =>
      void runQuery(createRequest({ sql }), { exclusive });

    run("card");
    run("explorer", true);
    run("other card");
    // The exclusive job waits for the card, and nothing overtakes it.
    expect(started).toEqual(["card"]);
    await done("card");
    expect(started).toEqual(["card", "explorer"]);
    await done("explorer");
    expect(started).toEqual(["card", "explorer", "other card"]);
    run("last card");
    expect(started).toEqual(["card", "explorer", "other card", "last card"]);
  });

  it("suggests a heavier profile on a timeout when the machine allows it", () => {
    const timeout = new AnalyticsError(
      { code: "timeout", message: "stopped" },
      { timeoutMs: 10_000 }
    );
    const syntax = new AnalyticsError({ code: "cancelled", message: "x" });
    // No machine: no hint.
    expect(formatAnalyticsError(timeout, i18n.t)).not.toContain("Puissant");

    useMachineStore.getState().setMachine(laptop);
    useAnalyticsSettingsStore.getState().setPerformanceProfile("economy");
    const message = formatAnalyticsError(timeout, i18n.t);
    expect(message).toContain("10 s");
    expect(message).toContain(
      "Cet ordinateur peut aller plus loin : choisissez le profil Puissant"
    );
    expect(
      formatAnalyticsError(
        new AnalyticsError({ code: "too_large", message: "big" }),
        i18n.t
      )
    ).toContain("profil Puissant");
    expect(formatAnalyticsError(syntax, i18n.t)).not.toContain("Puissant");

    // Already on the recommended profile: no hint.
    useAnalyticsSettingsStore.getState().setPerformanceProfile("auto");
    expect(formatAnalyticsError(timeout, i18n.t)).not.toContain("Puissant");
  });
});
