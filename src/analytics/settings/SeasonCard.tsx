import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_SEASON_START_MONTH,
  useAnalyticsSettingsStore,
} from "../store/analyticsSettings.store";
import { currentSeason, localNow, seasonBounds } from "../params/season";
import { fieldClass, Notice, SettingsCard } from "./SettingsControls";

const capitalize = (text: string) =>
  text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** Month names in the app language, January first. */
export const monthNames = (locale: string): string[] => {
  const format = new Intl.DateTimeFormat(locale, { month: "long" });
  return Array.from({ length: 12 }, (_, i) =>
    capitalize(format.format(new Date(2024, i, 15)))
  );
};

const longDate = (year: number, month: number, day: number, locale: string) => {
  const text = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
  // French writes the first day of a month "1er" ("1er août 2025").
  return day === 1 && locale.toLowerCase().startsWith("fr")
    ? text.replace(/^1(?=\s)/, "1er")
    : text;
};

/** Months with a usual meaning: the federation season, the calendar year. */
const MONTH_HINTS = new Set([9, 1]);

/** First and last day of the current season, as long dates. */
export const currentSeasonRange = (
  startMonth: number,
  locale: string,
  now: string = localNow()
) => {
  const season = currentSeason(now, startMonth);
  const { start } = seasonBounds(season, startMonth);
  const [year, month] = start.split("-").map(Number);
  // Day 0 of the start month, one year later: the season's last day.
  const last = new Date(year + 1, month - 1, 0);
  return {
    start: longDate(year, month, 1, locale),
    end: longDate(
      last.getFullYear(),
      last.getMonth() + 1,
      last.getDate(),
      locale
    ),
  };
};

/** Card 1: when the club's season starts (plan 1.3). */
export const SeasonCard = () => {
  const { t, i18n } = useTranslation();
  const month = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const setMonth = useAnalyticsSettingsStore((s) => s.setSeasonStartMonth);
  const [changed, setChanged] = useState(false);
  const names = monthNames(i18n.language);
  const range = currentSeasonRange(month, i18n.language);
  const optionLabel = (name: string, value: number) =>
    value === DEFAULT_SEASON_START_MONTH
      ? t("analytics.settings.season.defaultMonth", { month: name })
      : MONTH_HINTS.has(value)
        ? t(`analytics.settings.season.monthHints.${value}`, { month: name })
        : name;

  return (
    <SettingsCard
      id="analytics-season"
      title={t("analytics.settings.season.title")}
      description={t("analytics.settings.season.description")}
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="analytics-season-start"
          className="font-medium text-gray-900"
        >
          {t("analytics.settings.season.startMonth")}
        </label>
        <select
          id="analytics-season-start"
          aria-describedby="analytics-season-help"
          className={fieldClass() + " max-w-xs pl-3 pr-10"}
          value={month}
          onChange={(event) => {
            setMonth(Number(event.target.value));
            setChanged(true);
          }}
        >
          {names.map((name, index) => (
            <option key={name} value={index + 1}>
              {optionLabel(name, index + 1)}
            </option>
          ))}
        </select>
        <p id="analytics-season-help" className="text-sm text-gray-600">
          {t("analytics.settings.season.help")}
        </p>
      </div>
      {changed ? (
        <Notice tone="info">
          {t("analytics.settings.season.changed", range)}
        </Notice>
      ) : (
        <p className="text-sm text-gray-700">
          {t("analytics.settings.season.example", range)}
        </p>
      )}
    </SettingsCard>
  );
};
