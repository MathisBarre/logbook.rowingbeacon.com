const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = ONE_SECOND_MS * 60;
const ONE_HOUR_MS = ONE_MINUTE_MS * 60;
const ONE_DAY_MS = ONE_HOUR_MS * 24;

export const millisecondToDayHourMinutes = (millisecond: number) => {
  const day = Math.floor(millisecond / ONE_DAY_MS);
  const hour = Math.floor((millisecond % ONE_DAY_MS) / ONE_HOUR_MS);
  const minutes = Math.floor((millisecond % ONE_HOUR_MS) / ONE_MINUTE_MS);

  const dayString = day > 0 ? `${day}j ` : "";
  const hourString = hour > 0 || dayString ? `${hour}h ` : "";
  const minutesString = `${minutes}min`;

  return `${dayString}${hourString}${minutesString}`;
};
