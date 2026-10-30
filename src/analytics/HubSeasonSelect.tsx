import { useTranslation } from "react-i18next";
import { useAnalyticsQuery } from "./engine/useAnalyticsQuery";
import { useAnalyticsHubStore, useHubSeason } from "./store/analyticsHub.store";
import { useAnalyticsSettingsStore } from "./store/analyticsSettings.store";
import { currentSeason, formatSeason, localNow } from "./params/season";

const SEASONS_SQL =
  "SELECT season, is_current FROM v_seasons ORDER BY season DESC";

/**
 * The season shared by every tab (plan 1.2). Choosing the current season
 * stores null, so the hub follows it when a new season starts; its option
 * says "(en cours)".
 */
export const HubSeasonSelect = () => {
  const { t } = useTranslation();
  const setSeason = useAnalyticsHubStore((state) => state.setSeason);
  const selected = useHubSeason();
  const startMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const current = currentSeason(localNow(), startMonth);
  const { result } = useAnalyticsQuery({
    sql: SEASONS_SQL,
    params: {},
    priority: "high",
  });

  const seasons = new Set<number>([current, selected]);
  for (const row of result?.rows ?? []) {
    if (typeof row[0] === "number") seasons.add(row[0]);
  }
  const options = [...seasons].sort((a, b) => b - a);

  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <span className="sr-only">{t("analytics.common.season.label")}</span>
      <select
        className="min-h-11 rounded border border-gray-300 bg-white pl-3 pr-10 text-sm font-medium text-gray-900 focus:border-steel-blue-500 focus:ring-2 focus:ring-steel-blue-500"
        value={selected}
        onChange={(event) => {
          const season = Number(event.target.value);
          setSeason(season === current ? null : season);
        }}
      >
        {options.map((season) => (
          <option key={season} value={season}>
            {t(
              season === current
                ? "analytics.common.season.valueCurrent"
                : "analytics.common.season.value",
              { label: formatSeason(season, startMonth) }
            )}
          </option>
        ))}
      </select>
    </label>
  );
};
