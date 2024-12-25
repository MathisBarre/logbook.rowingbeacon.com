import { eq } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessionOnRowers, DBSessions } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";

export const RowerStats = ({ rowerId }: { rowerId: string }) => {
  const { count, totalDuration, mostUsedBoats } = useGetRowerStats(rowerId);
  const { getBoatById } = useClubOverviewStore();

  return (
    <div>
      <h1 className="font-medium text-lg mb-2">Statistiques générales</h1>
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
      <h1 className="font-medium text-lg mb-2 mt-4">
        Bateaux les plus utilisés
      </h1>

      {mostUsedBoats.length === 0 && <p>Aucun bateau utilisé</p>}

      <ul>
        {mostUsedBoats.map((boat) => (
          <li key={boat.id}>
            <span>{getBoatById(boat.id)?.name || "NAME_NOT_FOUND"}</span>{" "}
            <span className="font-bold"> - {boat.count} utilisations</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const useGetRowerStats = (rowerId: string) => {
  const [stats, setStats] = useState<{
    count: number;
    totalDuration: number;
    mostUsedBoats: { id: string; count: number }[];
  }>({ count: 0, totalDuration: 0, mostUsedBoats: [] });

  useEffect(() => {
    getRowerStats(rowerId)
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [rowerId]);

  return stats;
};

const getRowerStats = async (
  rowerId: string
): Promise<{
  count: number;
  totalDuration: number;
  mostUsedBoats: { id: string; count: number }[];
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .leftJoin(DBSessions, eq(DBSessions.id, DBSessionOnRowers.session_id))
    .where(eq(DBSessionOnRowers.rower_id, rowerId));

  const count = sessions.length;
  const totalDuration = sessions.reduce((acc: number, session) => {
    if (!session.session?.startDateTime || !session.session?.endDateTime) {
      return acc;
    }

    const start = new Date(session.session.startDateTime);
    const end = new Date(session.session.endDateTime);
    const duration = end.getTime() - start.getTime();
    return acc + duration;
  }, 0);

  // get most used boats
  const boats = sessions
    .reduce((acc: { id: string; count: number }[], session) => {
      const boatId = session.session?.boatId;
      if (!boatId) {
        return acc;
      }

      const existing = acc.find((b) => b.id === boatId);
      if (existing) {
        existing.count++;
      } else {
        acc.push({ id: boatId, count: 1 });
      }

      return acc;
    }, [] as { id: string; count: number }[])
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return { count, totalDuration, mostUsedBoats: boats };
};
