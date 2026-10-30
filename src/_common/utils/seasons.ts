import { addDays } from "./date.utils";
import { getSeasonStartMonth } from "../../analytics/store/analyticsSettings.store";

/** Default season start (0-based month: August), see analytics.seasonStartMonth. */
export const NEW_SEASON_START_BEGINNING_OF_MONTH = 7;

export interface Season {
  startDate: Date;
  endDate: Date;
}

/**
 * The season containing `date`. It starts on the first day of the month set
 * in Gestion › Statistiques et IA (`startMonth0` is 0-based; August by
 * default), so the Gestion statistics and the analytics hub agree.
 */
export const getSeasonDate = (
  date: Date = new Date(),
  startMonth0: number = getSeasonStartMonth() - 1
): Season => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const seasonStartMonth = startMonth0;

  const startYear = month >= seasonStartMonth ? year : year - 1;

  const startDate = new Date(startYear, seasonStartMonth, 1);
  const endDate = addDays(new Date(startYear + 1, seasonStartMonth, 1), -1);

  return {
    startDate,
    endDate,
  };
};
