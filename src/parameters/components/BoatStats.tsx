import { eq } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";

export const BoatStats = ({ boatId }: { boatId: string }) => {
  const { count, totalDuration } = useGetBoatStats(boatId);

  return (
    <div>
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
