import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SqlClient } from "../../_common/database/sqlClient";
import {
  deleteDashboardItem,
  getQuery,
  listDashboardItems,
  MAIN_DASHBOARD,
  moveDashboardItem,
  readAnalytics,
  saveDashboardItem,
  writeAnalytics,
} from "../repository/analytics.repository";
import type { DashboardItemInput } from "../repository/analytics.repository";
import { resolveParams, ParamContext } from "../params/resolveParams";
import type {
  DashboardItem,
  DashboardItemSize,
  ParamDef,
  ParamValue,
  SavedQuery,
} from "../types";

/**
 * The dashboard's items (plan 1.3, 1.4). `createDashboardController` is
 * framework free (tests drive it on node:sqlite); `useDashboard` binds it
 * to React with the app's read and write queue (ADR 0003). Changes show at
 * once and are written in the background, then the list is read again so
 * the screen always ends up as SQLite holds it.
 */

export interface DashboardEntry {
  item: DashboardItem;
  /** The saved query of a query item; null when it is gone. */
  query: SavedQuery | null;
}

interface DashboardState {
  status: "loading" | "ready" | "error";
  entries: DashboardEntry[];
}

export interface DashboardRepository {
  read: <T>(read: (db: SqlClient) => Promise<T>) => Promise<T>;
  /** Resolves with false when the write failed. */
  write: (
    label: string,
    write: (db: SqlClient) => Promise<unknown>
  ) => Promise<boolean>;
}

const appDashboardRepository: DashboardRepository = {
  read: readAnalytics,
  write: writeAnalytics,
};

/** Items in order, with the saved query of each query item. */
const loadDashboard = async (
  db: SqlClient,
  dashboardId: string = MAIN_DASHBOARD
): Promise<DashboardEntry[]> => {
  const items = await listDashboardItems(db, dashboardId);
  const entries: DashboardEntry[] = [];
  for (const item of items) {
    const query =
      item.source.kind === "query"
        ? await getQuery(db, item.source.queryId)
        : null;
    // An archived query's items are already left out by the repository.
    if (item.source.kind === "query" && query?.archivedAt) continue;
    entries.push({ item, query });
  }
  return entries;
};

interface DashboardController {
  getState: () => DashboardState;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
  /** Adds an item at the end; resolves with false when it failed. */
  pin: (
    input: Omit<DashboardItemInput, "id" | "position" | "dashboardId">
  ) => Promise<boolean>;
  move: (id: string, direction: "up" | "down") => Promise<boolean>;
  resize: (id: string, size: DashboardItemSize) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Puts a removed item back where it was ("Annuler" after Retirer). */
  restore: (entry: DashboardEntry) => Promise<boolean>;
}

export const createDashboardController = (
  repository: DashboardRepository,
  dashboardId: string = MAIN_DASHBOARD
): DashboardController => {
  const listeners = new Set<() => void>();
  let state: DashboardState = { status: "loading", entries: [] };
  let loadGeneration = 0;

  const setState = (next: DashboardState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const load = async () => {
    const generation = ++loadGeneration;
    try {
      const entries = await repository.read((db) =>
        loadDashboard(db, dashboardId)
      );
      if (generation === loadGeneration) {
        setState({ status: "ready", entries });
      }
    } catch (error) {
      console.error("❌ Failed to load the analytics dashboard", error);
      if (generation === loadGeneration) {
        setState({ status: "error", entries: state.entries });
      }
    }
  };

  /** Shows `optimistic` at once, writes, then reads the truth back. */
  const change = async (
    label: string,
    optimistic: DashboardEntry[] | null,
    write: (db: SqlClient) => Promise<unknown>
  ) => {
    if (optimistic) setState({ status: "ready", entries: optimistic });
    const ok = await repository.write(`dashboard ${label}`, write);
    await load();
    return ok;
  };

  const withItem = (
    id: string,
    update: (item: DashboardItem) => DashboardItem
  ): DashboardEntry[] =>
    state.entries.map((entry) =>
      entry.item.id === id ? { ...entry, item: update(entry.item) } : entry
    );

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    pin(input) {
      return change("pin", null, (db) =>
        saveDashboardItem(db, { ...input, dashboardId })
      );
    },
    move(id, direction) {
      const index = state.entries.findIndex((entry) => entry.item.id === id);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || target < 0 || target >= state.entries.length) {
        return Promise.resolve(true);
      }
      const entries = [...state.entries];
      [entries[index], entries[target]] = [entries[target], entries[index]];
      return change("move", entries, (db) =>
        moveDashboardItem(db, id, direction)
      );
    },
    resize(id, size) {
      const entry = state.entries.find((e) => e.item.id === id);
      if (!entry || entry.item.size === size) return Promise.resolve(true);
      const { item } = entry;
      return change(
        "resize",
        withItem(id, (current) => ({ ...current, size })),
        (db) =>
          saveDashboardItem(db, {
            id,
            dashboardId: item.dashboardId,
            source: item.source,
            size,
            paramValues: item.paramValues,
            chartOverride: item.chartOverride,
          })
      );
    },
    remove(id) {
      return change(
        "remove",
        state.entries.filter((entry) => entry.item.id !== id),
        (db) => deleteDashboardItem(db, id)
      );
    },
    restore(entry) {
      const { item } = entry;
      if (state.entries.some((e) => e.item.id === item.id)) {
        return Promise.resolve(true);
      }
      const entries = [...state.entries, entry].sort(
        (a, b) =>
          a.item.position - b.item.position ||
          a.item.createdAt.localeCompare(b.item.createdAt)
      );
      return change("restore", entries, (db) =>
        saveDashboardItem(db, {
          id: item.id,
          dashboardId: item.dashboardId,
          position: item.position,
          source: item.source,
          size: item.size,
          paramValues: item.paramValues,
          chartOverride: item.chartOverride,
        })
      );
    },
  };
};

/** The main dashboard, loaded on mount. */
export const useDashboard = (
  repository: DashboardRepository = appDashboardRepository
) => {
  const controllerRef = useRef<DashboardController | null>(null);
  controllerRef.current ??= createDashboardController(repository);
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  );
  return { ...state, controller };
};

/** Loads the dashboard once `ready` (after the default one is written). */
export const useLoadDashboardWhen = (
  controller: DashboardController,
  ready: boolean
) => {
  useEffect(() => {
    if (ready) void controller.load();
  }, [controller, ready]);
};

/**
 * Values a card runs with (plan 1.4, 2.7): the pinned values checked
 * against the definitions, the hub season for a season parameter that was
 * not fixed. `invalid` is true when a pinned value no longer fits (the
 * default is used and the card shows a warning).
 */
export const resolveCardParams = (
  defs: ParamDef[],
  pinned: Record<string, ParamValue>,
  hubSeason: number,
  ctx: ParamContext
): { values: Record<string, ParamValue>; invalid: boolean } => {
  const values: Record<string, ParamValue> = {};
  for (const def of defs) {
    if (pinned[def.name] !== undefined) {
      values[def.name] = pinned[def.name];
    } else if (def.type === "season") {
      values[def.name] = hubSeason;
    }
  }
  const resolved = resolveParams(defs, values, ctx);
  return {
    values: resolved.values,
    invalid: resolved.errors.some((error) => error.code !== "required"),
  };
};
