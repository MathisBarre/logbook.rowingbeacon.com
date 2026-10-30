import { useTranslation } from "react-i18next";
import { getReports } from "../reports/catalog";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { Notice, SettingsCard, Switch } from "./SettingsControls";

/** Ids of the reports that show names (visibility "nominative"). */
const nominativeReportIds = () =>
  getReports()
    .filter((report) => report.visibility === "nominative")
    .map((report) => report.id);

/** Card 2: rankings with names at the boathouse, without a password. */
export const RankingsCard = () => {
  const { t } = useTranslation();
  const publicRankings = useAnalyticsSettingsStore((s) => s.publicRankings);
  const setPublicRankings = useAnalyticsSettingsStore(
    (s) => s.setPublicRankings
  );
  const titles = nominativeReportIds().map((id) =>
    t(`analytics.reports.items.${id}.title`, { defaultValue: id })
  );
  const reports =
    titles.length > 0
      ? titles.join(", ")
      : t("analytics.settings.rankings.noReports");

  return (
    <SettingsCard
      id="analytics-rankings"
      title={t("analytics.settings.rankings.title")}
      description={t("analytics.settings.rankings.description")}
    >
      <Switch
        id="analytics-public-rankings"
        checked={publicRankings}
        onChange={setPublicRankings}
        label={t("analytics.settings.rankings.public")}
        description={t("analytics.settings.rankings.help", { reports })}
      />
      {publicRankings && (
        <Notice tone="warning">
          {t("analytics.settings.rankings.publicWarning")}
        </Notice>
      )}
    </SettingsCard>
  );
};
