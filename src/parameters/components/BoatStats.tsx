import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBOutings } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import useIncidentStore from "../../_common/store/incident.store";
import { formatDate } from "../../_common/utils/date.utils";
import Loading from "../../_common/components/Loading";
import { StatsCard } from "../../_common/components/StatsCard";
import {
  ChartBarIcon,
  ClockIcon,
  CalculatorIcon,
} from "@heroicons/react/16/solid";
import { SeasonSelector } from "../../stats/components/SeasonSelector";
import { getSeasonDate, Season } from "../../_common/utils/seasons";
import { useGetFirstAndLastRegisteredSessionDate } from "../../stats/utils/getFirstAndLastRegisteredSessionDate";
import { useModule } from "../../_common/store/modules.store";
import { useDamageStore } from "../../_common/store/damage.store";
import { sortDamagesChronologically } from "../../_common/business/damage.rules";
import { DamageSeverityBadge } from "../../_common/components/damages/DamageSeverityBadge";
import { DamageDescription } from "../../_common/components/damages/DamageFields";

export const BoatStats = ({ boatId }: { boatId: string }) => {
  const { t } = useTranslation();
  const {
    firstSession,
    lastSession,
    isLoading: isLoadingDates,
  } = useGetFirstAndLastRegisteredSessionDate();
  const [selectedSeason, setSelectedSeason] = useState<Season>(
    getSeasonDate(new Date())
  );
  const { count, totalDuration } = useGetBoatStats(boatId, selectedSeason);
  const { getIncidentsByBoatId } = useIncidentStore();
  const incidents = getIncidentsByBoatId(boatId);
  const hasDamages = useModule("damages");
  const allDamages = useDamageStore((state) => state.damages);
  const damages = sortDamagesChronologically(
    allDamages.filter((damage) => damage.boatId === boatId)
  );

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

      <div className="grid grid-cols-3 gap-2">
        <StatsCard
          icon={<ChartBarIcon className="w-6 h-6 text-steel-blue-600" />}
          title={t("stats.numberOfSessions")}
          value={count}
        />

        <StatsCard
          icon={<ClockIcon className="w-6 h-6 text-steel-blue-600" />}
          title={t("stats.timeOnWater")}
          value={millisecondToDayHourMinutes(
            totalDuration,
            t("common.dayShort")
          )}
        />

        <StatsCard
          icon={<CalculatorIcon className="w-6 h-6 text-steel-blue-600" />}
          title={t("stats.averagePerSession")}
          value={millisecondToDayHourMinutes(
            totalDuration / count || 0,
            t("common.dayShort")
          )}
        />
      </div>

      {hasDamages && (
        <div className="mt-6">
          <h1 className="font-medium text-lg mb-4">{t("damages.title")}</h1>

          {damages.length === 0 ? (
            <p className="text-gray-500">{t("damages.noneOnBoat")}</p>
          ) : (
            <ul className="space-y-2">
              {damages.map((damage) => (
                <li
                  key={damage.id}
                  className="bg-white rounded-lg shadow-sm border p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">
                      {formatDate(damage.reportedAt)}
                    </span>
                    <DamageSeverityBadge severity={damage.severity} />
                    {damage.fixedAt && (
                      <span className="text-xs text-gray-500">
                        {t(
                          damage.kind === "unavailable"
                            ? "damages.unavailable.fixed"
                            : "damages.fixed"
                        )}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600 mt-1">
                    <DamageDescription damage={damage} />
                  </p>
                  {damage.fixedAt && (
                    <p className="text-sm text-gray-500 mt-1">
                      {t(
                        damage.kind === "unavailable"
                          ? "damages.unavailable.fixedOn"
                          : "damages.fixedOn",
                        { date: formatDate(damage.fixedAt) }
                      )}
                      {damage.repairNote && ` · ${damage.repairNote}`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6">
        <h1 className="font-medium text-lg mb-4">{t("stats.incidents")}</h1>

        {incidents.length === 0 ? (
          <p className="text-gray-500">{t("stats.noIncidents")}</p>
        ) : (
          <ul className="space-y-2">
            {incidents.map((incident) => (
              <li
                key={incident.id}
                className="bg-white rounded-lg shadow-sm border p-4"
              >
                <span className="font-bold text-gray-900">
                  {formatDate(incident.datetime)}
                </span>
                <p className="text-gray-600 mt-1">{incident.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const useGetBoatStats = (boatId: string, season: Season) => {
  const [stats, setStats] = useState({ count: 0, totalDuration: 0 });

  useEffect(() => {
    getBoatStats(boatId, season)
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [boatId, season]);

  return stats;
};

const getBoatStats = async (
  boatId: string,
  season: Season
): Promise<{
  count: number;
  totalDuration: number;
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBOutings)
    .where(
      and(
        isNotNull(DBOutings.endDateTime),
        eq(DBOutings.boatId, boatId),
        gte(DBOutings.startDateTime, season.startDate.toISOString()),
        lte(DBOutings.startDateTime, season.endDate.toISOString())
      )
    );

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
