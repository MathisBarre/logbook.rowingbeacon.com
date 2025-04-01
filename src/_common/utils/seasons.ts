import { addDays } from "./date.utils";

export const NEW_SEASON_START_BEGINNING_OF_MONTH = 7;

export interface Season {
  startDate: Date;
  endDate: Date;
}

export const getSeasonDate = (date: Date = new Date()): Season => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const seasonStartMonth = NEW_SEASON_START_BEGINNING_OF_MONTH;

  const startYear = month >= seasonStartMonth ? year : year - 1;

  const startDate = new Date(startYear, seasonStartMonth, 1);
  const endDate = addDays(new Date(startYear + 1, seasonStartMonth, 1), -1);

  return {
    startDate,
    endDate,
  };
};
