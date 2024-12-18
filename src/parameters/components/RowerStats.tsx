import { eq } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessionOnRowers, DBSessions } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";

export const RowerStats = ({ rowerId }: { rowerId: string }) => {
  const { count, totalDuration } = useGetRowerStats(rowerId);

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

const useGetRowerStats = (rowerId: string) => {
  const [stats, setStats] = useState({ count: 0, totalDuration: 0 });

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

  return { count, totalDuration };
};
