import { getDateTimeWithoutTimezone } from "../../_common/utils/date.utils";

/**
 * Seasons of the analytics hub (plan 2.3): a season is the integer start
 * year of a twelve-month period starting on the first day of
 * `startMonth` (analytics.seasonStartMonth, 1-12). Dates are local
 * wall-clock text: nothing here goes through `new Date(text)`.
 */

const pad = (value: number) => String(value).padStart(2, "0");

const yearMonth = (date: string): { year: number; month: number } => {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) {
    throw new Error(`Invalid local date: ${date}`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
};

/** Local wall-clock time of now, "YYYY-MM-DDTHH:mm" (for `now`). */
export const localNow = (date: Date = new Date()) =>
  getDateTimeWithoutTimezone(date);

/** Season containing `now` ("YYYY-MM-DD…"). */
export const currentSeason = (now: string, startMonth: number): number => {
  const { year, month } = yearMonth(now);
  return month < startMonth ? year - 1 : year;
};

/** First day of the season and first day of the next one (exclusive). */
export const seasonBounds = (
  season: number,
  startMonth: number
): { start: string; end: string } => ({
  start: `${season}-${pad(startMonth)}-01`,
  end: `${season + 1}-${pad(startMonth)}-01`,
});

/** "2025-2026", or "2025" when the season is the calendar year. */
export const formatSeason = (season: number, startMonth: number): string =>
  startMonth === 1 ? String(season) : `${season}-${season + 1}`;

/**
 * Seasons from the one containing `firstDate` (the first outing; null when
 * there is none) to the current one, most recent first.
 */
export const listSeasons = (
  firstDate: string | null,
  now: string,
  startMonth: number
): number[] => {
  const last = currentSeason(now, startMonth);
  const first = firstDate
    ? Math.min(currentSeason(firstDate, startMonth), last)
    : last;
  const seasons: number[] = [];
  for (let season = last; season >= first; season--) {
    seasons.push(season);
  }
  return seasons;
};
