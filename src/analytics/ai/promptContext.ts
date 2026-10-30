import type { TFunction } from "i18next";
import { BUILTIN_OUTING_TYPE_CODES } from "../../_common/business/outingType.rules";
import { getEngine } from "../engine/engine";
import { createRequest, runQuery } from "../engine/queue";
import { currentSeason, localNow } from "../params/season";
import type { QueryResult, SqlValue } from "../types";
import type { PromptAssets, PromptContext } from "./promptBuilder";

/**
 * Gathers what the system prompt needs (plan 2.11 step 1) through the
 * read-only engine: the objects of this database, the outing types and,
 * when shared, boat classes, boat names and route names. Only club assets
 * are read here: never a rower, an outing or a result.
 */

interface PromptContextInput {
  locale: string;
  seasonStartMonth: number;
  enabledModules: string[];
  shareAssetNames: boolean;
  t: TFunction;
  signal?: AbortSignal;
  /** Local wall-clock time; tests pass a fixed one. */
  now?: string;
}

const run = (sql: string, now: string, signal?: AbortSignal) =>
  runQuery(createRequest({ sql, now, maxRows: 5000, timeoutMs: 10_000 }), {
    priority: "high",
    signal,
  });

const text = (value: SqlValue | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

const rowsOf = (result: QueryResult) => {
  const index = new Map(result.columns.map((c, i) => [c.name, i]));
  return result.rows.map((row) => (name: string) => row[index.get(name) ?? -1]);
};

export const loadPromptContext = async (
  input: PromptContextInput
): Promise<PromptContext> => {
  const now = input.now ?? localNow();
  const objects = await getEngine().objects();
  const views = new Set(objects.views);

  let outingTypes: PromptContext["outingTypes"] = [];
  if (views.has("v_outing_types")) {
    const result = await run(
      "SELECT outing_type_code, custom_label, is_builtin FROM v_outing_types WHERE is_archived = 0 ORDER BY position, outing_type_code",
      now,
      input.signal
    );
    outingTypes = rowsOf(result).map((get) => {
      const code = text(get("outing_type_code")) ?? "";
      const builtin =
        get("is_builtin") === 1 &&
        (BUILTIN_OUTING_TYPE_CODES as readonly string[]).includes(code);
      return {
        code,
        label: builtin
          ? input.t(`outingTypes.${code}`)
          : (text(get("custom_label")) ?? code),
      };
    });
  }

  let assets: PromptAssets | null = null;
  if (input.shareAssetNames) {
    assets = { boatClasses: [], boats: [], routes: [] };
    if (views.has("v_boats")) {
      const boats = rowsOf(
        await run(
          "SELECT boat_name, boat_class FROM v_boats WHERE is_archived = 0 ORDER BY boat_name",
          now,
          input.signal
        )
      );
      assets.boats = boats.map((get) => ({
        name: text(get("boat_name")) ?? "",
        boatClass: text(get("boat_class")),
      }));
      assets.boatClasses = assets.boats
        .map((boat) => boat.boatClass)
        .filter((c): c is string => Boolean(c));
    }
    if (views.has("v_routes")) {
      const routes = rowsOf(
        await run(
          "SELECT route_name, distance_km FROM v_routes WHERE is_archived = 0 ORDER BY route_name",
          now,
          input.signal
        )
      );
      assets.routes = routes.map((get) => {
        const km = get("distance_km");
        return {
          name: text(get("route_name")) ?? "",
          km: typeof km === "number" ? km : null,
        };
      });
    }
  }

  return {
    locale: input.locale,
    today: now.slice(0, 10),
    currentSeason: currentSeason(now, input.seasonStartMonth),
    seasonStartMonth: input.seasonStartMonth,
    objects,
    enabledModules: input.enabledModules,
    outingTypes,
    assets,
  };
};
