import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../../_common/utils/error";
import { getDatabase } from "../../../_common/database/database";
import {
  DBSessionOnRowers,
  DBSessions,
} from "../../../_common/database/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { millisecondToDayHourMinutes } from "../../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import Loading from "../../../_common/components/Loading";
import { StatsTable } from "../../../_common/components/StatsTable";
import { SeasonSelector } from "../../../stats/components/SeasonSelector";
import { Season, getSeasonDate } from "../../../_common/utils/seasons";
import { useGetFirstAndLastRegisteredSessionDate } from "../../../stats/utils/getFirstAndLastRegisteredSessionDate";

export const RowerStatsComparisons = () => {
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

      {!isLoadingStats && stats.length === 0 && <Loading />}

      {!isLoadingStats && stats.length > 0 && (
        <StatsTable
          headers={{
            rowerId: "Rameur",
            count: "Nombre de sessions",
            totalDuration: "Durée totale",
            averageDuration: "Durée moyenne / session",
          }}
          stats={stats.map((stat) => ({
            rowerId: stat.rowerId,
            count: stat.count.toString(),
            totalDuration: millisecondToDayHourMinutes(
              stat.totalDuration
            ).toString(),
            averageDuration: millisecondToDayHourMinutes(
              stat.totalDuration / stat.count || 0
            ).toString(),
          }))}
        />
      )}
    </div>
  );
};

const useGetRowersStats = (season: Season) => {
  const [stats, setStats] = useState(
    [] as { count: number; totalDuration: number; rowerId: string }[]
  );
  const [isLoading, setIsLoading] = useState(true);

  const { getAllRowers } = useClubOverviewStore();

  useEffect(() => {
    setIsLoading(true);
    getRowersStats(season)
      .then((stats) => {
        stats.map((stat) => {
          const rower = getAllRowers().find(
            (rower) => rower.id === stat.rowerId
          );
          stat.rowerId = rower?.name || stat.rowerId;
        });
        setStats(stats);
      })
      .catch((e) => toast.error(getErrorMessage(e)))
      .finally(() => setIsLoading(false));
  }, [season]);

  return { stats, isLoading };
};

const getRowersStats = async (
  season: Season
): Promise<
  {
    count: number;
    totalDuration: number;
    rowerId: string;
  }[]
> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .leftJoin(DBSessions, eq(DBSessions.id, DBSessionOnRowers.sessionId))
    .where(
      and(
        gte(DBSessions.startDateTime, season.startDate.toISOString()),
        lte(DBSessions.startDateTime, season.endDate.toISOString())
      )
    );

  const stats = sessions
    .reduce((acc, curr) => {
      const existingItem = acc.find(
        (stat) => stat.rowerId === curr.session_rowers.rowerId
      );

      let totalDuration = 0;

      if (curr.session?.startDateTime && curr.session?.endDateTime) {
        const start = new Date(curr.session.startDateTime);
        const end = new Date(curr.session.endDateTime);
        totalDuration = end.getTime() - start.getTime();
      }

      if (existingItem) {
        existingItem.count++;
        existingItem.totalDuration += totalDuration;
      } else {
        acc.push({
          rowerId: curr.session_rowers.rowerId,
          count: 1,
          totalDuration: totalDuration,
        });
      }

      return acc;
    }, [] as { count: number; totalDuration: number; rowerId: string }[])
    .sort((a, b) => b.totalDuration - a.totalDuration);

  return stats;
};
