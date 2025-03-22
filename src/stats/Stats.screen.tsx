import { useEffect, useState } from "react";
import { millisecondToDayHourMinutes } from "../_common/utils/time.utils";
import { UserGroupIcon, ClockIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { getErrorMessage } from "../_common/utils/error";
import { getDatabase } from "../_common/database/database";
import { DBSessions } from "../_common/database/schema";
import { StackedBarChart } from "./components/StackedBarChart";
import { useSessionsByMonthStackedByBoatType } from "./utils/getSessionsByMonth";
import {
  BoatTypeEnum,
  getBoatNumberOfRowers,
  getTypeLabel,
} from "../_common/business/boat.rules";
export const StatsScreen = () => {
  const { count, totalDuration } = useMiscStats();

  // Generate fake data for the chart
  const chartData = useSessionsByMonthStackedByBoatType({
    startDate: new Date("2020-01-01"),
    endDate: new Date("2030-12-31"),
  });

  // Format month names
  const formatMonth = (month: number) => {
    const months = [
      "Janvier",
      "Février",
      "Mars",
      "Avril",
      "Mai",
      "Juin",
      "Juillet",
      "Août",
      "Septembre",
      "Octobre",
      "Novembre",
      "Décembre",
    ];
    return months[month];
  };

  const formatStackLabel = (label: string) => {
    return getTypeLabel(label as BoatTypeEnum);
  };

  // Format number of sessions
  const formatAmount = (amount: number) =>
    `${amount} séance${amount > 1 ? "s" : ""}`;

  return (
    <div className="p-4 gap-4 flex flex-col h-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Sessions"
          value={count.toString()}
          icon={UserGroupIcon}
        />
        <StatCard
          title="Temps total sur l'eau"
          value={millisecondToDayHourMinutes(totalDuration)}
          icon={ClockIcon}
        />
        <StatCard
          title="Moyenne temps / session"
          value={millisecondToDayHourMinutes(totalDuration / count || 0)}
          icon={ClockIcon}
        />
      </div>

      <div className="flex gap-4 flex-1">
        <div className="bg-white rounded-lg shadow-sm border p-4 flex-1">
          <StackedBarChart
            data={chartData}
            formatMonth={formatMonth}
            formatAmount={formatAmount}
            formatStackLabel={formatStackLabel}
            theme="light"
            sortStacks={(a, b) => {
              const aNbRowers = getBoatNumberOfRowers(a as BoatTypeEnum);
              const bNbRowers = getBoatNumberOfRowers(b as BoatTypeEnum);
              return (aNbRowers || 0) - (bNbRowers || 0);
            }}
          />
        </div>
      </div>
    </div>
  );
};

const StatCard = ({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
}) => {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-4">
      <div className="p-3 bg-steel-blue-50 rounded-lg">
        <Icon className="w-6 h-6 text-steel-blue-600" />
      </div>
      <div>
        <h3 className="text-sm text-gray-500 font-medium">{title}</h3>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
};

const useMiscStats = () => {
  const [stats, setStats] = useState({ count: 0, totalDuration: 0 });

  useEffect(() => {
    getMiscStats()
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, []);

  return stats;
};

const getMiscStats = async (): Promise<{
  count: number;
  totalDuration: number;
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle.select().from(DBSessions);

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
