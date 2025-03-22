export const NEW_SEASON_START_BEGINNING_OF_MONTH = 8;

export interface Season {
  startDate: Date;
  endDate: Date;
}

export const getSeasonDate = (date: Date = new Date()): Season => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const seasonStartMonth = NEW_SEASON_START_BEGINNING_OF_MONTH;

  const startYear = month >= seasonStartMonth ? year : year - 1;
  const endYear = month >= seasonStartMonth ? year : year;

  return {
    startDate: new Date(startYear, seasonStartMonth - 1, 1),
    endDate: new Date(
      endYear,
      month >= seasonStartMonth ? 11 : 6,
      month >= seasonStartMonth ? 31 : 31
    ),
  };
};
