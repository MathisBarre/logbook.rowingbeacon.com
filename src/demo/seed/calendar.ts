// Civil dates without time zones: days are "YYYY-MM-DD" keys, times are
// minutes after local midnight, stored values are local wall-clock
// "YYYY-MM-DDTHH:mm" strings as the logbook stores them. UTC arithmetic
// only, so the seed is the same whatever the machine's time zone.

const DAY_MS = 86_400_000;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const toUtc = (dayKey: string) => {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const addDays = (dayKey: string, days: number) =>
  fromUtc(toUtc(dayKey) + days * DAY_MS);

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (dayKey: string) =>
  new Date(toUtc(dayKey)).getUTCDay();

/** 1 = January … 12 = December. */
export const monthOf = (dayKey: string) => Number(dayKey.slice(5, 7));

export const yearOf = (dayKey: string) => Number(dayKey.slice(0, 4));

export const daysBetween = (from: string, to: string) =>
  Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/** Every day from `from` to `to`, both included. */
export const eachDay = (from: string, to: string): string[] => {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
};

/** "2026-06-20T09:47" for a day and minutes after its midnight (may run past it). */
export const toLocalDateTime = (dayKey: string, minutes: number) => {
  const extraDays = Math.floor(minutes / 1440);
  const rest = minutes - extraDays * 1440;
  return `${addDays(dayKey, extraDays)}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
};

/** Splits "2026-06-20T09:47[:00]" into its day and minutes after midnight. */
export const parseLocalDateTime = (value: string) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match)
    throw new Error(
      `Expected a local date-time like 2026-06-20T09:47, got "${value}"`
    );
  return { day: match[1], minutes: Number(match[2]) * 60 + Number(match[3]) };
};

/** Season of the stats screen: 1 August to 31 July, named by its first year. */
export const seasonOf = (dayKey: string) => {
  const year = yearOf(dayKey);
  return monthOf(dayKey) >= 8 ? year : year - 1;
};
