import { useEffect, useState } from "react";
import { asc } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { DBSessions } from "../../_common/database/schema";
import { getDatabase } from "../../_common/database/database";

const getFirstRegisteredSessionDate = async () => {
  const { drizzle } = await getDatabase();
  const firstSession = await drizzle
    .select()
    .from(DBSessions)
    .orderBy(asc(DBSessions.startDateTime))
    .limit(1);
  return firstSession[0].startDateTime;
};

const getLastRegisteredSessionDate = async () => {
  const { drizzle } = await getDatabase();
  const lastSession = await drizzle
    .select()
    .from(DBSessions)
    .orderBy(desc(DBSessions.startDateTime))
    .limit(1);
  return lastSession[0].startDateTime;
};

export const useGetFirstAndLastRegisteredSessionDate = () => {
  const [firstSession, setFirstSession] = useState<Date | null>(null);
  const [lastSession, setLastSession] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDates = async () => {
      try {
        const first = await getFirstRegisteredSessionDate();
        const last = await getLastRegisteredSessionDate();
        setFirstSession(new Date(first));
        setLastSession(new Date(last));
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDates().catch(() => setIsLoading(false));
  }, []);

  return { firstSession, lastSession, isLoading };
};
