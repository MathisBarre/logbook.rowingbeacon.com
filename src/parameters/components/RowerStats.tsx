import { useState } from "react";
import { useTranslation } from "react-i18next";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import Loading from "../../_common/components/Loading";
import { SeasonSelector } from "../../stats/components/SeasonSelector";
import { getSeasonDate } from "../../_common/utils/seasons";
import { useGetFirstAndLastRegisteredSessionDate } from "../../stats/utils/getFirstAndLastRegisteredSessionDate";
import { useGetRowerStats } from "../utils/getRowerStats";
import { CalculatorIcon } from "@heroicons/react/16/solid";
import { ClockIcon } from "@heroicons/react/16/solid";
import { ChartBarIcon } from "@heroicons/react/16/solid";
import { AcademicCapIcon } from "@heroicons/react/16/solid";

export const RowerStats = ({ rowerId }: { rowerId: string }) => {
  const { t } = useTranslation();
  const {
    firstSession,
    lastSession,
    isLoading: isLoadingDates,
  } = useGetFirstAndLastRegisteredSessionDate();
  const [selectedSeason, setSelectedSeason] = useState(
    getSeasonDate(new Date())
  );
  const {
    count,
    totalDuration,
    mostUsedBoats,
    mostFrequentPartners,
    coachedSessionsCount,
    coachedSessionsPercentage,
  } = useGetRowerStats(rowerId, selectedSeason);
  const { getBoatById, getRowerById } = useClubOverviewStore();

  if (count === undefined) return <Loading />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {isLoadingDates && <Loading />}
        <SeasonSelector
          className="w-full"
          value={selectedSeason}
          onChange={setSelectedSeason}
          firstDataAt={firstSession || new Date()}
          lastDataAt={lastSession || new Date()}
          disabled={isLoadingDates}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-4">
          <div className="p-3 bg-steel-blue-50 rounded-lg">
            <ChartBarIcon className="w-6 h-6 text-steel-blue-600" />
          </div>
          <div>
            <h3 className="text-sm text-gray-500 font-medium">
              {t("stats.numberOfSessions")}
            </h3>
            <p className="text-xl font-semibold text-gray-900">{count}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-4">
          <div className="p-3 bg-steel-blue-50 rounded-lg">
            <ClockIcon className="w-6 h-6 text-steel-blue-600" />
          </div>
          <div>
            <h3 className="text-sm text-gray-500 font-medium">
              {t("stats.timeOnWater")}
            </h3>
            <p className="text-xl font-semibold text-gray-900">
              {millisecondToDayHourMinutes(totalDuration)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-4">
          <div className="p-3 bg-steel-blue-50 rounded-lg">
            <CalculatorIcon className="w-6 h-6 text-steel-blue-600" />
          </div>
          <div>
            <h3 className="text-sm text-gray-500 font-medium">
              {t("stats.averagePerSession")}
            </h3>
            <p className="text-xl font-semibold text-gray-900">
              {millisecondToDayHourMinutes(totalDuration / count || 0)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-4">
          <div className="p-3 bg-steel-blue-50 rounded-lg">
            <AcademicCapIcon className="w-6 h-6 text-steel-blue-600" />
          </div>
          <div>
            <h3 className="text-sm text-gray-500 font-medium">
              {t("stats.coachedSessions")}
            </h3>
            <p className="text-xl font-semibold text-gray-900">
              {coachedSessionsCount} ({coachedSessionsPercentage.toFixed(2)}%)
            </p>
          </div>
        </div>
      </div>

      <div className="flex w-full justify-between">
        <div className="flex-1  flex flex-col items-start">
          <h1 className="font-medium text-lg mb-2 mt-4">
            {t("stats.mostUsedBoats")}
          </h1>

          {mostUsedBoats.length === 0 && <p>{t("stats.noBoatsUsed")}</p>}

          <ul className="flex flex-col justify-start">
            {mostUsedBoats.map((boat) => (
              <li key={boat.id} className="flex justify-between gap-6">
                <span>{getBoatById(boat.id)?.name || "NAME_NOT_FOUND"}</span>{" "}
                <span className="font-bold">
                  {boat.count} {t("stats.uses")}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 flex flex-col items-start">
          <h1 className="font-medium text-lg mb-2 mt-4">
            {t("stats.mostFrequentPartners")}
          </h1>

          {mostFrequentPartners.length === 0 && (
            <p>{t("stats.noPartnersFound")}</p>
          )}

          <ul className="flex flex-col justify-start">
            {mostFrequentPartners.map((partner) => (
              <li key={partner.id} className="flex justify-between gap-6">
                <span>
                  {getRowerById(partner.id)?.name || "NAME_NOT_FOUND"}
                </span>{" "}
                <span className="font-bold">
                  {partner.count} {t("stats.sessions")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
