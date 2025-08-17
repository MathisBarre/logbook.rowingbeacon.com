import { useEffect, useState } from "react";
import { getErrorMessage } from "../../../_common/utils/error";
import { toast } from "sonner";
import { between, inArray, not, and, eq } from "drizzle-orm";
import { DBSessions } from "../../../_common/database/schema";
import { getDatabase } from "../../../_common/database/database";
import { DBSessionOnRowers } from "../../../_common/database/schema";

export const useGetRowerStats = (
  rowerId: string,
  season: { startDate: Date; endDate: Date }
) => {
  const [stats, setStats] = useState<RowerStats>({
    count: 0,
    totalDuration: 0,
    mostUsedBoats: [],
    mostFrequentPartners: [],
    coachedSessionsCount: 0,
    coachedSessionsPercentage: 0,
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
): Promise<RowerStats> => {
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

  const totalDuration = calculateTotalDuration(sessions);
  const { coachedSessionsCount, coachedSessionsPercentage } =
    calculateCoachedSessionsStats(sessions);
  const { firstSessionDate, lastSessionDate } =
    calculateSessionDateRange(sessions);
  const mostUsedBoats = calculateMostUsedBoats(sessions);
  const sessionIds = getSessionIds(sessions);

  const sessionsOnRower = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .where(
      and(
        inArray(DBSessionOnRowers.sessionId, sessionIds),
        not(eq(DBSessionOnRowers.rowerId, rowerId))
      )
    );

  const mostFrequentPartners = calculateMostFrequentPartners(sessionsOnRower);

  return {
    count: sessions.length,
    totalDuration,
    mostUsedBoats,
    mostFrequentPartners,
    firstSessionDate,
    lastSessionDate,
    coachedSessionsCount,
    coachedSessionsPercentage,
  };
};

type SessionWithRower = {
  session: {
    id: string;
    startDateTime: string;
    endDateTime: string | null;
    boatId: string | null;
    hasBeenCoached: string | null;
  } | null;
};

type SessionOnRower = {
  rowerId: string;
  sessionId: string;
};

type RowerStats = {
  count: number;
  totalDuration: number;
  mostUsedBoats: { id: string; count: number }[];
  mostFrequentPartners: { id: string; count: number }[];
  firstSessionDate?: Date;
  lastSessionDate?: Date;
  coachedSessionsCount: number;
  coachedSessionsPercentage: number;
};

/**
 * Calculate the total duration of all sessions
 */
export const calculateTotalDuration = (
  sessions: SessionWithRower[]
): number => {
  return sessions.reduce((acc: number, session) => {
    if (!session.session?.startDateTime || !session.session?.endDateTime) {
      return acc;
    }

    const start = new Date(session.session.startDateTime);
    const end = new Date(session.session.endDateTime);
    const duration = end.getTime() - start.getTime();
    return acc + duration;
  }, 0);
};

/**
 * Calculate the number of coached sessions and the percentage of coached sessions
 */
const getCoachedSessionsCount = (sessions: SessionWithRower[]): number => {
  return sessions.filter(
    (session) => session.session?.hasBeenCoached === "true"
  ).length;
};

const getNbOfSessionsWithCoachedInfo = (
  sessions: SessionWithRower[]
): number => {
  return sessions.filter(
    (session) =>
      session.session?.hasBeenCoached !== null &&
      session.session?.hasBeenCoached !== undefined
  ).length;
};

export const getPercentage = ({
  totalNumber,
  partNumber,
}: {
  totalNumber: number;
  partNumber: number;
}): number => {
  if (totalNumber <= 0) {
    return 0;
  }

  return (partNumber / totalNumber) * 100;
};

export const calculateCoachedSessionsStats = (
  sessions: SessionWithRower[]
): {
  coachedSessionsCount: number;
  coachedSessionsPercentage: number;
} => {
  const coachedSessionsCount = getCoachedSessionsCount(sessions);
  const nbOfSessionWithCoachedInfos = getNbOfSessionsWithCoachedInfo(sessions);

  const coachedSessionsPercentage = getPercentage({
    totalNumber: nbOfSessionWithCoachedInfos,
    partNumber: coachedSessionsCount,
  });

  return {
    coachedSessionsCount,
    coachedSessionsPercentage,
  };
};

const getValidSessions = (sessions: SessionWithRower[]): SessionWithRower[] => {
  return sessions.filter(
    (s) => s.session?.startDateTime && s.session?.endDateTime
  );
};

const getFirstSessionDate = (
  validSessions: SessionWithRower[]
): Date | undefined => {
  if (validSessions.length === 0) {
    return undefined;
  }

  return new Date(
    Math.min(
      ...validSessions.map((s) => new Date(s.session!.startDateTime).getTime())
    )
  );
};

const getLastSessionDate = (
  validSessions: SessionWithRower[]
): Date | undefined => {
  if (validSessions.length === 0) {
    return undefined;
  }

  return new Date(
    Math.max(
      ...validSessions.map((s) => new Date(s.session!.endDateTime!).getTime())
    )
  );
};

export const calculateSessionDateRange = (
  sessions: SessionWithRower[]
): {
  firstSessionDate?: Date;
  lastSessionDate?: Date;
} => {
  const validSessions = getValidSessions(sessions);

  if (validSessions.length === 0) {
    return {
      firstSessionDate: undefined,
      lastSessionDate: undefined,
    };
  }

  const firstSessionDate = getFirstSessionDate(validSessions);
  const lastSessionDate = getLastSessionDate(validSessions);

  return {
    firstSessionDate,
    lastSessionDate,
  };
};

export const calculateMostUsedBoats = (
  sessions: SessionWithRower[],
  limit: number = 5
): { id: string; count: number }[] => {
  return sessions
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
    .slice(0, limit);
};

export const calculateMostFrequentPartners = (
  sessionsOnRower: SessionOnRower[],
  limit: number = 5
): { id: string; count: number }[] => {
  return sessionsOnRower
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
    .slice(0, limit);
};

export const getSessionIds = (sessions: SessionWithRower[]): string[] => {
  return sessions
    .map((s) => s.session?.id)
    .filter((id): id is string => id !== undefined);
};
