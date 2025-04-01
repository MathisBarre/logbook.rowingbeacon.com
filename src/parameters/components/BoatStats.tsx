import { eq } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import useIncidentStore from "../../_common/store/incident.store";
import { formatDate } from "../../_common/utils/date.utils";
import Loading from "../../_common/components/Loading";
import { StatsCard } from "../../_common/components/StatsCard";
import {
  ChartBarIcon,
  ClockIcon,
  CalculatorIcon,
} from "@heroicons/react/16/solid";

export const BoatStats = ({ boatId }: { boatId: string }) => {
  const { count, totalDuration } = useGetBoatStats(boatId);
  const { getIncidentsByBoatId } = useIncidentStore();
  const incidents = getIncidentsByBoatId(boatId);

  if (count === undefined) return <Loading />;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <StatsCard
          icon={<ChartBarIcon className="w-6 h-6 text-steel-blue-600" />}
          title="Nombre de sessions"
          value={count}
        />

        <StatsCard
          icon={<ClockIcon className="w-6 h-6 text-steel-blue-600" />}
          title="Temps sur l'eau"
          value={millisecondToDayHourMinutes(totalDuration)}
        />

        <StatsCard
          icon={<CalculatorIcon className="w-6 h-6 text-steel-blue-600" />}
          title="Moyenne par session"
          value={millisecondToDayHourMinutes(totalDuration / count || 0)}
        />
      </div>

      <div className="mt-6">
        <h1 className="font-medium text-lg mb-4">Incidents</h1>

        {incidents.length === 0 ? (
          <p className="text-gray-500">Aucun incident</p>
        ) : (
          <ul className="space-y-2">
            {incidents.map((incident) => (
              <li
                key={incident.id}
                className="bg-white rounded-lg shadow-sm border p-4"
              >
                <span className="font-bold text-gray-900">
                  {formatDate(incident.datetime)}
                </span>
                <p className="text-gray-600 mt-1">{incident.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const useGetBoatStats = (rowerId: string) => {
  const [stats, setStats] = useState({ count: 0, totalDuration: 0 });

  useEffect(() => {
    getBoatStats(rowerId)
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [rowerId]);

  return stats;
};

const getBoatStats = async (
  boatId: string
): Promise<{
  count: number;
  totalDuration: number;
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessions)
    .where(eq(DBSessions.boatId, boatId));

  const count = sessions.length;
  const totalDuration = sessions.reduce((acc: number, session) => {
    if (!session?.startDateTime || !session?.endDateTime) {
      return acc;
    }

    const start = new Date(session.startDateTime);
    const end = new Date(session.endDateTime);
    const duration = end.getTime() - start.getTime();
    return acc + duration;
  }, 0);

  return { count, totalDuration };
};
