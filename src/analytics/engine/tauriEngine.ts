import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EngineObjects, QueryResult, RunQueryRequest } from "../types";
import type { AnalyticsEngine } from "./engine";
import { AnalyticsError, toAnalyticsError } from "./errors";
import { ANALYTICS_COMMANDS } from "./ipc";

const desktopOnly = (sql: string | null = null) =>
  new AnalyticsError(
    {
      code: "desktop_only",
      message: "Analytics needs the installed application",
    },
    { sql }
  );

/** The Rust engine, through the Tauri commands of ipc.ts. */
export const tauriEngine: AnalyticsEngine = {
  async run(request: RunQueryRequest): Promise<QueryResult> {
    if (!isTauri()) {
      throw desktopOnly(request.sql);
    }
    try {
      return await invoke<QueryResult>(ANALYTICS_COMMANDS.runQuery, {
        request,
      });
    } catch (error) {
      throw toAnalyticsError(error, {
        sql: request.sql,
        timeoutMs: request.timeoutMs,
      });
    }
  },

  async cancel(requestId: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke(ANALYTICS_COMMANDS.cancelQuery, { requestId });
    } catch (error) {
      throw toAnalyticsError(error);
    }
  },

  async objects(): Promise<EngineObjects> {
    if (!isTauri()) {
      throw desktopOnly();
    }
    try {
      return await invoke<EngineObjects>(ANALYTICS_COMMANDS.listObjects);
    } catch (error) {
      throw toAnalyticsError(error);
    }
  },
};
