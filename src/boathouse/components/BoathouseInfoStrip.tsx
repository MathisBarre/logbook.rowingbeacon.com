import { useEffect, useMemo, useState } from "react";
import {
  CalendarIcon,
  ClockIcon,
  SunriseIcon,
  SunsetIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getSunTimes,
  isDark,
  isPolarNight,
} from "../../_common/business/sun.rules";
import { useBoathouseSettingsStore } from "../../_common/store/boathouseSettings.store";
import { useLocaleStore } from "../../_common/store/locale.store";
import { useSessionsStore } from "../../_common/store/sessions.store";
import { getTime } from "../../_common/utils/date.utils";

const MINUTE_IN_MS = 60 * 1000;

/** Slim strip: current time and date, today's sun times and a night warning. */
export const BoathouseInfoStrip = () => {
  const { t } = useTranslation();
  const locale = useLocaleStore((state) => state.locale);
  const latitude = useBoathouseSettingsStore((state) => state.clubLatitude);
  const longitude = useBoathouseSettingsStore((state) => state.clubLongitude);
  const ongoingCount = useSessionsStore(
    (state) => state.session.filter((session) => !session.endDateTime).length
  );
  const [now, setNow] = useState(() => new Date());

  // Ticks just after each minute starts, so the clock is never a minute late
  useEffect(() => {
    let timeout: number;
    const schedule = () => {
      const delay = MINUTE_IN_MS - (Date.now() % MINUTE_IN_MS) + 50;
      timeout = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, []);

  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();
  const { sun, polarNight } = useMemo(() => {
    if (latitude === null || longitude === null) {
      return { sun: null, polarNight: false };
    }
    const day = new Date(year, month, date);
    return {
      sun: getSunTimes(day, latitude, longitude),
      polarNight: isPolarNight(day, latitude, longitude),
    };
  }, [year, month, date, latitude, longitude]);
  // Also after midnight: an outing still out at 01:00 is out in the dark
  const isNightWithOutings = ongoingCount > 0 && isDark(now, sun, polarNight);

  return (
    <div className="h-7 px-2 mb-1 flex items-center gap-4 text-sm text-gray-700 bg-white rounded shadow-sm overflow-hidden whitespace-nowrap">
      <span className="shrink-0 flex items-center gap-1 font-semibold">
        <ClockIcon className="w-4 h-4" />
        {getTime(now)}
      </span>
      {isNightWithOutings && (
        <span
          role="status"
          className="shrink-0 flex items-center gap-1 text-yellow-800 font-medium"
        >
          <TriangleAlertIcon className="w-4 h-4" />
          {t("boathouse.outingsAfterSunset", { count: ongoingCount })}
        </span>
      )}
      <span className="min-w-0 flex items-center gap-1">
        <CalendarIcon className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {now.toLocaleDateString(locale ?? "en-US", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
      </span>
      {sun && (
        <>
          <span
            className="shrink-0 flex items-center gap-1"
            title={t("boathouse.sunrise")}
          >
            <SunriseIcon className="w-4 h-4 text-yellow-600" />
            <span className="sr-only">{t("boathouse.sunrise")}</span>
            {getTime(sun.sunrise)}
          </span>
          <span
            className="shrink-0 flex items-center gap-1"
            title={t("boathouse.sunset")}
          >
            <SunsetIcon className="w-4 h-4 text-rose-600" />
            <span className="sr-only">{t("boathouse.sunset")}</span>
            {getTime(sun.sunset)}
          </span>
        </>
      )}
    </div>
  );
};
