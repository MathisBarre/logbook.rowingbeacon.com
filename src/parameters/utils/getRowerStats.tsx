import { useEffect, useState } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { toast } from "sonner";
import { between, inArray, not } from "drizzle-orm";
import { and } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { DBSessions } from "../../_common/database/schema";
import { getDatabase } from "../../_common/database/database";
import { DBSessionOnRowers } from "../../_common/database/schema";

export const useGetRowerStats = (
  rowerId: string,
  season: { startDate: Date; endDate: Date }
) => {
  const [stats, setStats] = useState<{
    count: number;
    totalDuration: number;
    mostUsedBoats: { id: string; count: number }[];
    mostFrequentPartners: { id: string; count: number }[];
    firstSessionDate?: Date;
    lastSessionDate?: Date;
  }>({
    count: 0,
    totalDuration: 0,
    mostUsedBoats: [],
    mostFrequentPartners: [],
  });

  useEffect(() => {
    getRowerStats(rowerId, season)
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [rowerId, season]);

  return stats;
};

const getRowerStats = async (
  rowerId: string,
  season: { startDate: Date; endDate: Date }
): Promise<{
  count: number;
  totalDuration: number;
  mostUsedBoats: { id: string; count: number }[];
  mostFrequentPartners: { id: string; count: number }[];
  firstSessionDate?: Date;
  lastSessionDate?: Date;
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .leftJoin(DBSessions, eq(DBSessions.id, DBSessionOnRowers.sessionId))
    .where(
      and(
        eq(DBSessionOnRowers.rowerId, rowerId),
        between(
          DBSessions.startDateTime,
          season.startDate.toISOString(),
          season.endDate.toISOString()
        )
      )
    );

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

  // Get first and last session dates
  const validSessions = sessions.filter(
    (s) => s.session?.startDateTime && s.session?.endDateTime
  );
  const firstSessionDate =
    validSessions.length > 0
      ? new Date(
          Math.min(
            ...validSessions.map((s) =>
              new Date(s.session!.startDateTime).getTime()
            )
          )
        )
      : undefined;
  const lastSessionDate =
    validSessions.length > 0
      ? new Date(
          Math.max(
            ...validSessions.map((s) =>
              new Date(s.session!.endDateTime!).getTime()
            )
          )
        )
      : undefined;

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
    .slice(0, 5);

  const sessionsIds = sessions
    .map((s) => s.session?.id)
    .filter((id) => id !== undefined);

  const sessionsOnRower = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .where(
      and(
        inArray(DBSessionOnRowers.sessionId, sessionsIds),
        not(eq(DBSessionOnRowers.rowerId, rowerId))
      )
    );

  const mostFrequentPartners = sessionsOnRower
    .reduce((acc: { id: string; count: number }[], sessionOnRower) => {
      const existing = acc.find((rower) => rower.id === sessionOnRower.rowerId);

      if (existing) {
        existing.count++;
      } else {
        acc.push({ id: sessionOnRower.rowerId, count: 1 });
      }

      return acc;
    }, [] as { id: string; count: number }[])
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    count,
    totalDuration,
    mostUsedBoats: boats,
    mostFrequentPartners,
    firstSessionDate,
    lastSessionDate,
  };
};
