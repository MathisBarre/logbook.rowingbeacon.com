import type { EngineObjects, QueryResult, RunQueryRequest } from "../types";
import { tauriEngine } from "./tauriEngine";

/**
 * The read-only analytics engine (ADR 0008). In the app it is the Rust
 * engine behind Tauri commands (`tauriEngine`); tests set their own with
 * `setEngineForTests` (usually `createNodeEngine` from `nodeEngine.ts`, or
 * a fake). Only `queue.ts` calls it: components go through
 * `useAnalyticsQuery` or `runQuery`.
 */
export interface AnalyticsEngine {
  /** Rejects with an AnalyticsError. */
  run(request: RunQueryRequest): Promise<QueryResult>;
  cancel(requestId: string): Promise<void>;
  objects(): Promise<EngineObjects>;
}

let engineForTests: AnalyticsEngine | null = null;

export const getEngine = (): AnalyticsEngine => engineForTests ?? tauriEngine;

export const setEngineForTests = (engine: AnalyticsEngine | null): void => {
  engineForTests = engine;
};
