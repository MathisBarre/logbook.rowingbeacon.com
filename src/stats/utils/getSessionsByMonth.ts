import { and, gte, lte } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { BarChartStackItem } from "../components/StackedBarChart";
import { useState } from "react";
import { useEffect } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { Boat } from "../../_common/business/boat.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
export const getSessionsInPeriod = async ({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}) => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessions)
    .where(
      and(
        gte(DBSessions.startDateTime, startDate.toISOString()),
        lte(DBSessions.endDateTime, endDate.toISOString())
      )
    );

  return sessions;
};

export const getSessionsByMonthStackedByBoatType = async (
  {
    startDate,
    endDate,
  }: {
    startDate: Date;
    endDate: Date;
  },
  data: { boats: Boat[] }
): Promise<BarChartStackItem[]> => {
  const sessions = await getSessionsInPeriod({ startDate, endDate });

  const sessionsByMonthAndType = sessions.reduce((acc, session) => {
    const month = new Date(session.startDateTime).getMonth();
    const boatType =
      data.boats.find((boat) => boat.id === session.boatId)?.type || "UNKNOWN";

    if (!acc[month]) {
      acc[month] = {};
    }
    acc[month][boatType] = (acc[month][boatType] || 0) + 1;

    return acc;
  }, {} as Record<number, Record<string, number>>);

  const result: BarChartStackItem[] = [];

  Object.entries(sessionsByMonthAndType).forEach(([month, typeCount]) => {
    Object.entries(typeCount).forEach(([boatType, count]) => {
      result.push({
        month: parseInt(month),
        stackAmount: count,
        stackLabel: boatType,
      });
    });
  });

  return result;
};

export const useSessionsByMonthStackedByBoatType = ({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}) => {
  const [data, setData] = useState<BarChartStackItem[]>([]);
  const { getAllBoats } = useClubOverviewStore();

  useEffect(() => {
    const boats = getAllBoats();
    getSessionsByMonthStackedByBoatType({ startDate, endDate }, { boats })
      .then(setData)
      .catch((e) => console.error(getErrorMessage(e)));
  }, [startDate, endDate]);

  return data;
};
