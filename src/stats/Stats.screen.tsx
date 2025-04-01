import { millisecondToDayHourMinutes } from "../_common/utils/time.utils";
import {
  UserGroupIcon,
  ClockIcon,
  ChartBarIcon,
  CalculatorIcon,
} from "@heroicons/react/16/solid";
import { StackedBarChart } from "./components/StackedBarChart";
import { useSessionsByMonthStackedByBoatType } from "./utils/getSessionsByMonth";
import {
  BoatTypeEnum,
  getBoatNumberOfRowers,
  getTypeLabel,
} from "../_common/business/boat.rules";
import { getSeasonDate } from "../_common/utils/seasons";
import { useGlobalStats } from "./utils/getGlobalStats";
import { SeasonSelector } from "./components/SeasonSelector";
import { useState } from "react";
import { AnimatedLoadingIcon } from "../_common/components/Loading";
import { useGetFirstAndLastRegisteredSessionDate } from "./utils/getFirstAndLastRegisteredSessionDate";

export const StatsScreen = () => {
  const { firstSession, lastSession, isLoading } =
    useGetFirstAndLastRegisteredSessionDate();

  const [selectedSeason, setSelectedSeason] = useState<{
    startDate: Date;
    endDate: Date;
  }>(getSeasonDate(new Date()));

  const { count, totalDuration } = useGlobalStats({
    startDate: selectedSeason.startDate,
    endDate: selectedSeason.endDate,
  });

  // Generate fake data for the chart
  const chartData = useSessionsByMonthStackedByBoatType({
    startDate: selectedSeason.startDate,
    endDate: selectedSeason.endDate,
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

  const formatAmount = (amount: number) =>
    `${amount} sortie${amount > 1 ? "s" : ""}`;

  return (
    <div className="p-4 gap-4 flex flex-col h-full relative">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Statistiques</h1>
        <div className="flex items-center gap-2">
          {isLoading && <AnimatedLoadingIcon />}
          <SeasonSelector
            value={selectedSeason}
            onChange={setSelectedSeason}
            firstDataAt={firstSession || new Date()}
            lastDataAt={lastSession || new Date()}
            disabled={isLoading}
          />
        </div>
      </div>

      {count === 0 && (
        <div className="flex-1 h-full bg-white z-10 backdrop-blur-sm bg-opacity-10">
          <div className="flex justify-center items-center h-full flex-col gap-4">
            <ChartBarIcon className="w-16 h-16 text-gray-900" />
            <p className="text-xl font-semibold text-gray-900 text-center max-w-sm text-balance">
              Aucune session enregistrée pour le moment
            </p>
          </div>
        </div>
      )}

      {count > 0 && (
        <>
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
              icon={CalculatorIcon}
            />
          </div>

          <div className="flex gap-4 flex-1">
            <div className="bg-white rounded-lg shadow-sm border p-4 flex-1">
              <StackedBarChart
                data={chartData}
                formatMonth={formatMonth}
                formatAmount={formatAmount}
                formatStackLabel={getTypeLabel}
                sortStacks={(a, b) => {
                  const aNbRowers = getBoatNumberOfRowers(a as BoatTypeEnum);
                  const bNbRowers = getBoatNumberOfRowers(b as BoatTypeEnum);
                  return (aNbRowers || 0) - (bNbRowers || 0);
                }}
              />
            </div>
          </div>
        </>
      )}
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
