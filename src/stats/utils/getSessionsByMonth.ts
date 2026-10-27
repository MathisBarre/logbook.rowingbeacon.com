import { BarChartStackItem } from "../components/StackedBarChart";
import { useState } from "react";
import { useEffect } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { Boat } from "../../_common/business/boat.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { getSessionsInPeriod } from "./getSessionByPeriod";
import { getDatabase } from "../../_common/database/database";
import { getLegacyTypeFromConfiguration } from "../../_common/business/boatConfiguration.rules";

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
  const { db } = await getDatabase();
  // Archived configurations included: an outing keeps the rigging it used.
  const configurations = new Map(
    (
      await db.select<{ id: string; seats: number | null; coxed: number }[]>(
        "SELECT id, seats, coxed FROM boat_configuration"
      )
    ).map((c) => [c.id, { seats: c.seats, coxed: c.coxed === 1 }])
  );

  const sessionsByMonthAndType = sessions.reduce(
    (acc, session) => {
      const month = new Date(session.startDateTime).getMonth();
      const configuration = session.boatConfigurationId
        ? configurations.get(session.boatConfigurationId)
        : undefined;
      const boatType = configuration
        ? getLegacyTypeFromConfiguration(configuration)
        : data.boats.find((boat) => boat.id === session.boatId)?.type ||
          "OTHER";

      if (!acc[month]) {
        acc[month] = {};
      }
      acc[month][boatType] = (acc[month][boatType] || 0) + 1;

      return acc;
    },
    {} as Record<number, Record<string, number>>
  );

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
  useEffect(() => {
    // Archived boats included, so their outings keep their boat type.
    const boats = useClubOverviewStore.getState().clubOverview.boats;
    getSessionsByMonthStackedByBoatType({ startDate, endDate }, { boats })
      .then(setData)
      .catch((e) => console.error(getErrorMessage(e)));
  }, [startDate, endDate]);

  return data;
};
