import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import Loading from "../../_common/components/Loading";
import { StatsTable } from "../../_common/components/StatsTable";

export const BoatStatsComparisons = () => {
  const stats = useGetBoatsStats();

  return (
    <div>
      {stats.length === 0 && <Loading />}

      {stats.length > 0 && (
        <StatsTable
          headers={{
            boatId: "Bateau",
            count: "Nombre de sessions",
            totalDuration: "Durée totale",
            averageDuration: "Durée moyenne / session",
          }}
          stats={stats.map((stat) => ({
            boatId: stat.boatId,
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

const useGetBoatsStats = () => {
  const [stats, setStats] = useState(
    [] as { count: number; totalDuration: number; boatId: string }[]
  );

  const { getAllBoats } = useClubOverviewStore();

  useEffect(() => {
    getBoatsStats()
      .then((stats) => {
        stats.map((stat) => {
          const boat = getAllBoats().find((boat) => boat.id === stat.boatId);

          stat.boatId = boat?.name || stat.boatId;
        });

        setStats(stats);
      })
      .catch((e) => toast.error(getErrorMessage(e)));
  }, []);

  return stats;
};

const getBoatsStats = async (): Promise<
  {
    count: number;
    totalDuration: number;
    boatId: string;
  }[]
> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle.select().from(DBSessions);

  const stats = sessions
    .reduce((acc, curr) => {
      const existingItem = acc.find((stat) => stat.boatId === curr.boatId);

      let totalDuration = 0;

      if (curr?.startDateTime && curr?.endDateTime) {
        const start = new Date(curr.startDateTime);
        const end = new Date(curr.endDateTime);
        totalDuration = end.getTime() - start.getTime();
      }

      if (existingItem) {
        existingItem.count++;
        existingItem.totalDuration += totalDuration;
      } else {
        acc.push({
          boatId: curr.boatId,
          count: 1,
          totalDuration: totalDuration,
        });
      }

      return acc;
    }, [] as { count: number; totalDuration: number; boatId: string }[])
    .sort((a, b) => b.totalDuration - a.totalDuration);

  return stats;
};
