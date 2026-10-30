import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ParamValue, QueryResult, RunQueryRequest } from "../types";
import {
  ensureMachineInfo,
  getActivePerformance,
  useMachineStore,
} from "./activePerformance";
import { AnalyticsError, toAnalyticsError } from "./errors";
import {
  createRequest,
  QueryPriority,
  runQuery,
  RunQueryOptions,
} from "./queue";

/**
 * Runs a query for a component (plan 2.6), through the queue. The hook is a
 * thin wrapper over `createQueryController`, a framework-free state
 * machine (idle → loading → success | error; slow after 1.5 s; cancel;
 * rerun) that tests drive directly.
 *
 * Privacy is not an argument: the app always runs `nominative`; the UI
 * checks a report's visibility before issuing its query.
 */

interface AnalyticsQueryInput {
  /** null = idle. */
  sql: string | null;
  params: Record<string, ParamValue>;
  /** Default 5000 (reports); the editor passes its setting. */
  maxRows?: number;
  /**
   * Default: the report timeout of the performance profile (20 s on
   * Économe); the editor and the AI pass the query timeout.
   */
  timeoutMs?: number;
  /** Default true; the editor's "Exécuter" passes false. */
  useCache?: boolean;
  /** False while off screen: no query runs. */
  enabled?: boolean;
  /** "high" for what the user just asked (report opened, editor run). */
  priority?: QueryPriority;
  /** Runs alone in the queue (free SQL, heavy reports): see queue.ts. */
  exclusive?: boolean;
}

export type QueryStatus = "idle" | "loading" | "success" | "error";

export interface QueryState {
  status: QueryStatus;
  result: QueryResult | null;
  error: AnalyticsError | null;
  /** Loading for more than 1.5 s. */
  isSlow: boolean;
}

interface QueryController {
  getState: () => QueryState;
  subscribe: (listener: () => void) => () => void;
  /** Starts a run when the input changed (by value), or goes idle. */
  setInput: (input: AnalyticsQueryInput) => void;
  /** Stops the current run: the state becomes the `cancelled` error. */
  cancel: () => void;
  /** Runs the current input again. */
  rerun: () => void;
  /** Stops everything; the controller can be used again by setInput. */
  dispose: () => void;
}

type QueryRunner = (
  request: RunQueryRequest,
  options: RunQueryOptions
) => Promise<QueryResult>;

const IDLE: QueryState = {
  status: "idle",
  result: null,
  error: null,
  isSlow: false,
};

const inputKey = (input: AnalyticsQueryInput) =>
  JSON.stringify([
    input.sql,
    Object.entries(input.params).sort(([a], [b]) => (a < b ? -1 : 1)),
    input.maxRows ?? null,
    input.timeoutMs ?? null,
    input.useCache ?? true,
    input.enabled ?? true,
    input.exclusive ?? false,
  ]);

export const createQueryController = (
  options: {
    run?: QueryRunner;
    slowAfterMs?: number;
    now?: () => string;
  } = {}
): QueryController => {
  const run = options.run ?? runQuery;
  const slowAfterMs = options.slowAfterMs ?? 1500;
  const listeners = new Set<() => void>();
  let state: QueryState = IDLE;
  let input: AnalyticsQueryInput | null = null;
  let key: string | null = null;
  let abort: AbortController | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const setState = (next: QueryState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const stop = () => {
    generation++;
    abort?.abort();
    abort = null;
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = null;
  };

  const start = (keepResult: boolean) => {
    stop();
    if (!input || input.sql === null || input.enabled === false) {
      setState(keepResult && state.status === "success" ? state : IDLE);
      return;
    }
    const current = ++generation;
    const controller = new AbortController();
    abort = controller;
    const request = createRequest({
      sql: input.sql,
      params: input.params,
      maxRows: input.maxRows ?? 5000,
      timeoutMs: input.timeoutMs,
      useCache: input.useCache ?? true,
      now: options.now?.(),
    });
    setState({
      status: "loading",
      result: keepResult ? state.result : null,
      error: null,
      isSlow: false,
    });
    slowTimer = setTimeout(() => {
      if (current === generation && state.status === "loading") {
        setState({ ...state, isSlow: true });
      }
    }, slowAfterMs);

    run(request, {
      signal: controller.signal,
      priority: input.priority,
      exclusive: input.exclusive,
    })
      .then((result) => {
        if (current !== generation) return;
        if (slowTimer) clearTimeout(slowTimer);
        setState({ status: "success", result, error: null, isSlow: false });
      })
      .catch((error: unknown) => {
        if (current !== generation) return;
        if (slowTimer) clearTimeout(slowTimer);
        setState({
          status: "error",
          result: null,
          error: toAnalyticsError(error, {
            sql: request.sql,
            timeoutMs: request.timeoutMs,
          }),
          isSlow: false,
        });
      });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setInput: (next) => {
      const nextKey = inputKey(next);
      const sameQuery =
        key !== null &&
        input !== null &&
        inputKey({ ...input, enabled: true }) ===
          inputKey({ ...next, enabled: true });
      input = next;
      if (nextKey === key) return;
      key = nextKey;
      // Re-enabling the same query after it went off screen keeps its
      // result while it refreshes.
      start(sameQuery);
    },
    cancel: () => {
      if (state.status !== "loading" || !input?.sql) return;
      const sql = input.sql;
      const timeoutMs =
        input.timeoutMs ?? getActivePerformance().limits.reportTimeoutMs;
      stop();
      setState({
        status: "error",
        result: null,
        error: new AnalyticsError(
          { code: "cancelled", message: "Query cancelled" },
          { sql, timeoutMs }
        ),
        isSlow: false,
      });
    },
    rerun: () => start(true),
    dispose: () => {
      stop();
      key = null;
      input = null;
      state = IDLE;
    },
  };
};

/** False while the window is hidden: analytics never runs in background. */
const usePageVisible = () => {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden"
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
};

/**
 * True once the machine is known (or cannot be): the profile's timeouts
 * are settled. Before that, "auto" reads as Économe, and a query started
 * then would be cancelled and run again when the machine arrives, since
 * its timeout is part of its key (review D, M4). The bootstrap asks for
 * the machine at launch, so this wait is a single IPC round trip at most.
 */
const useMachineKnown = () => {
  const known = useMachineStore(
    (s) => s.status === "ready" || s.status === "unavailable"
  );
  useEffect(() => {
    if (!known) void ensureMachineInfo();
  }, [known]);
  return known;
};

export const useAnalyticsQuery = (
  input: AnalyticsQueryInput
): QueryState & { cancel: () => void; rerun: () => void } => {
  const controllerRef = useRef<QueryController | null>(null);
  controllerRef.current ??= createQueryController();
  const controller = controllerRef.current;
  const visible = usePageVisible();
  const machineKnown = useMachineKnown();

  // The server snapshot lets static render tests (react-dom/server) work.
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  );

  const effective: AnalyticsQueryInput = {
    ...input,
    enabled: (input.enabled ?? true) && visible && machineKnown,
  };
  const key = inputKey(effective);
  useEffect(() => {
    // `key` captures every field of the input by value.
    controller.setInput(effective);
  }, [controller, key, input.priority]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { ...state, cancel: controller.cancel, rerun: controller.rerun };
};
