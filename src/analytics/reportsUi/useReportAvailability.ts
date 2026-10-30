import { useCallback, useEffect, useState } from "react";
import { useModulesStore } from "../../_common/store/modules.store";
import { getEngine } from "../engine/engine";
import { getReportAvailability } from "../reports/availability";
import type {
  EngineObjects,
  ReportAvailability,
  ReportDefinition,
} from "../types";

/**
 * Which reports can run (plan 2.8): their modules are on and their tables
 * exist. The engine's object list is fetched once per app session (it only
 * changes with a migration, that is with a new version of the app) and
 * shared by every tab.
 */

/** "pending" while the object list is not known yet. */
export type AvailabilityState = ReportAvailability | "pending";

let objectsPromise: Promise<EngineObjects | null> | null = null;
let objectsValue: EngineObjects | null | undefined;

/**
 * The engine's objects; null when the engine cannot list them (then every
 * table counts as present and a missing one shows as a query error).
 */
export const loadEngineObjects = (): Promise<EngineObjects | null> => {
  objectsPromise ??= getEngine()
    .objects()
    .then(
      (objects) => {
        objectsValue = objects;
        return objects;
      },
      (error: unknown) => {
        console.error("❌ Failed to list the analytics objects", error);
        // Try again on the next mount.
        objectsPromise = null;
        return null;
      }
    );
  return objectsPromise;
};

/** undefined while loading, null when unknown (error). */
export const useEngineObjects = (): EngineObjects | null | undefined => {
  const [objects, setObjects] = useState(objectsValue);
  useEffect(() => {
    let alive = true;
    void loadEngineObjects().then((value) => {
      if (alive) setObjects(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return objects;
};

/** Availability with a possibly unknown object list. */
export const availabilityOf = (
  report: Pick<ReportDefinition, "requires">,
  objects: EngineObjects | null | undefined,
  enabledModules: readonly string[]
): AvailabilityState => {
  // Modules are known at once: only the table check waits for the engine.
  const modulesOnly = getReportAvailability(
    { requires: { tables: [], modules: report.requires.modules } },
    {
      objects: { views: [], tables: [], missingViews: [] },
      enabledModules,
    }
  );
  if (!modulesOnly.available) return modulesOnly;
  if (objects === undefined) return "pending";
  if (objects === null) return { available: true };
  return getReportAvailability(report, { objects, enabledModules });
};

/** `(report) => availability`, updated when modules or objects change. */
export const useReportAvailability = () => {
  const objects = useEngineObjects();
  const enabledModules = useModulesStore((state) => state.enabled);
  return useCallback(
    (report: Pick<ReportDefinition, "requires">) =>
      availabilityOf(report, objects, enabledModules),
    [objects, enabledModules]
  );
};
