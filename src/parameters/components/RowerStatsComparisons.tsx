import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { getDatabase } from "../../_common/database/database";
import { DBSessionOnRowers, DBSessions } from "../../_common/database/schema";
import { eq } from "drizzle-orm";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import Loading from "../../_common/components/Loading";
import { StatsTable } from "../../_common/components/StatsTable";

export const RowerStatsComparisons = () => {
  const stats = useGetRowersStats();

  return (
    <div>
      {stats.length === 0 && <Loading />}

      {stats.length > 0 && (
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

const useGetRowersStats = () => {
  const [stats, setStats] = useState(
    [] as { count: number; totalDuration: number; rowerId: string }[]
  );

  const { getAllRowers } = useClubOverviewStore();

  useEffect(() => {
    getRowersStats()
      .then((stats) => {
        stats.map((stat) => {
          const rower = getAllRowers().find(
            (rower) => rower.id === stat.rowerId
          );

          stat.rowerId = rower?.name || stat.rowerId;
        });

        setStats(stats);
      })
      .catch((e) => toast.error(getErrorMessage(e)));
  }, []);

  return stats;
};

const getRowersStats = async (): Promise<
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
    .leftJoin(DBSessions, eq(DBSessions.id, DBSessionOnRowers.sessionId));

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
