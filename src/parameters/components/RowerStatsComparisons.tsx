import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { getDatabase } from "../../_common/database/database";
import { DBOutingCrew, DBOutings } from "../../_common/database/schema";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import Loading from "../../_common/components/Loading";
import { StatsTable } from "../../_common/components/StatsTable";
import { SeasonSelector } from "../../stats/components/SeasonSelector";
import { Season, getSeasonDate } from "../../_common/utils/seasons";
import { useGetFirstAndLastRegisteredSessionDate } from "../../stats/utils/getFirstAndLastRegisteredSessionDate";

export const RowerStatsComparisons = () => {
  const { t } = useTranslation();
  const {
    firstSession,
    lastSession,
    isLoading: isLoadingDates,
  } = useGetFirstAndLastRegisteredSessionDate();
  const [selectedSeason, setSelectedSeason] = useState<Season>(() =>
    getSeasonDate(new Date())
  );
  const { stats, isLoading: isLoadingStats } =
    useGetRowersStats(selectedSeason);

  if (isLoadingDates) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="w-full">
        <SeasonSelector
          className="w-full"
          value={selectedSeason}
          onChange={setSelectedSeason}
          firstDataAt={firstSession || new Date(2020, 0, 1)}
          lastDataAt={lastSession || new Date()}
        />
      </div>

      {isLoadingStats && <Loading />}

      {!isLoadingStats && stats.length === 0 && (
        <p className="text-gray-500">{t("stats.noSessionsRecorded")}</p>
      )}

      {!isLoadingStats && stats.length > 0 && (
        <StatsTable
          headers={{
            name: t("stats.rower"),
            count: t("stats.numberOfSessions"),
            totalDuration: t("stats.totalDuration"),
            averageDuration: t("stats.averageDurationPerSession"),
            coxCount: t("stats.coxedSessions"),
          }}
          stats={stats.map((stat) => ({
            id: stat.rowerId,
            name: stat.name,
            count: stat.count.toString(),
            totalDuration: millisecondToDayHourMinutes(
              stat.totalDuration
            ).toString(),
            averageDuration: millisecondToDayHourMinutes(
              stat.totalDuration / stat.count || 0
            ).toString(),
            coxCount: stat.coxCount.toString(),
          }))}
        />
      )}
    </div>
  );
};

type RowerComparison = {
  rowerId: string;
  /** Outings and time as a rower; time as cox is counted apart. */
  count: number;
  totalDuration: number;
  coxCount: number;
};

const useGetRowersStats = (season: Season) => {
  const [stats, setStats] = useState([] as (RowerComparison & { name: string })[]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    getRowersStats(season)
      .then((stats) => {
        // Archived and merged members keep their name; guests are not ranked.
        const { getRowerById } = useClubOverviewStore.getState();
        setStats(
          stats
            .filter((stat) => getRowerById(stat.rowerId)?.status !== "guest")
            .map((stat) => ({
              ...stat,
              name: getRowerById(stat.rowerId)?.name || stat.rowerId,
            }))
        );
      })
      .catch((e) => toast.error(getErrorMessage(e)))
      .finally(() => setIsLoading(false));
  }, [season]);

  return { stats, isLoading };
};

const getRowersStats = async (season: Season): Promise<RowerComparison[]> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBOutingCrew)
    .leftJoin(DBOutings, eq(DBOutings.id, DBOutingCrew.outingId))
    .where(
      and(
        isNotNull(DBOutings.endDateTime),
        gte(DBOutings.startDateTime, season.startDate.toISOString()),
        lte(DBOutings.startDateTime, season.endDate.toISOString())
      )
    );

  const stats = sessions
    .reduce((acc, curr) => {
      let item = acc.find((stat) => stat.rowerId === curr.outing_crew.rowerId);
      if (!item) {
        item = {
          rowerId: curr.outing_crew.rowerId,
          count: 0,
          totalDuration: 0,
          coxCount: 0,
        };
        acc.push(item);
      }

      if (curr.outing_crew.role === "cox") {
        item.coxCount++;
        return acc;
      }

      item.count++;
      if (curr.outing?.startDateTime && curr.outing?.endDateTime) {
        const start = new Date(curr.outing.startDateTime);
        const end = new Date(curr.outing.endDateTime);
        item.totalDuration += end.getTime() - start.getTime();
      }

      return acc;
    }, [] as RowerComparison[])
    .sort((a, b) => b.totalDuration - a.totalDuration);

  return stats;
};
