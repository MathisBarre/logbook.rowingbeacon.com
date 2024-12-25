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

export const BoatStats = ({ boatId }: { boatId: string }) => {
  const { count, totalDuration } = useGetBoatStats(boatId);
  const { getIncidentsByBoatId } = useIncidentStore();
  const incidents = getIncidentsByBoatId(boatId);

  if (count === undefined) return <Loading />;

  return (
    <div>
      <h1 className="font-medium text-lg mb-2">Statistiques</h1>

      <p>
        <span>Nombre de sessions : </span> <strong>{count}</strong>
      </p>
      <p>
        <span>Temps passé sur l&apos;eau : </span>{" "}
        <strong>{millisecondToDayHourMinutes(totalDuration)}</strong>
      </p>
      <p>
        <span>Moyenne temps / sessions : </span>{" "}
        <strong>
          {millisecondToDayHourMinutes(totalDuration / count || 0)}
        </strong>
      </p>
      <h1 className="font-medium text-lg mt-4 mb-2">Incidents</h1>

      {incidents.length === 0 && <p>Aucun incident</p>}

      <ul className="list-disc pl-4">
        {incidents.map((incident) => (
          <li key={incident.id}>
            <span className="font-bold">{formatDate(incident.datetime)}</span> -{" "}
            {incident.message}
          </li>
        ))}
      </ul>
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
