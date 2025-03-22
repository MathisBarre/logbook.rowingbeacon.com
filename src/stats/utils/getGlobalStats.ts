import { useEffect, useState } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { toast } from "sonner";
import { getSessionsInPeriod } from "./getSessionByPeriod";

export const useGlobalStats = ({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}) => {
  const [stats, setStats] = useState({ count: 0, totalDuration: 0 });

  useEffect(() => {
    getGlobalStats({ startDate, endDate })
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [startDate, endDate]);

  return stats;
};

const getGlobalStats = async ({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}): Promise<{
  count: number;
  totalDuration: number;
}> => {
  const sessions = await getSessionsInPeriod({
    startDate,
    endDate,
  });

  const totalDuration = sessions.reduce((acc: number, session) => {
    if (!session?.startDateTime || !session?.endDateTime) {
      return acc;
    }

    const start = new Date(session.startDateTime);
    const end = new Date(session.endDateTime);
    const duration = end.getTime() - start.getTime();
    return acc + duration;
  }, 0);

  return { count: sessions.length, totalDuration };
};
