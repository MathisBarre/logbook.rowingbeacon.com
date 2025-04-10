import { BarChartStackItem } from "../components/StackedBarChart";
import { useState } from "react";
import { useEffect } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { Boat } from "../../_common/business/boat.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { getSessionsInPeriod } from "./getSessionByPeriod";

export const getOneEmptyBarChartStackItemByMonth = () => {
  const result: BarChartStackItem[] = [];
  for (let i = 0; i < 12; i++) {
    result.push({
      month: i,
      stackAmount: 0,
      stackLabel: "OTHER",
    });
  }
  return result;
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
      data.boats.find((boat) => boat.id === session.boatId)?.type || "OTHER";

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

  return [...getOneEmptyBarChartStackItemByMonth(), ...result];
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
