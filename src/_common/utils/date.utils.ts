export function formatDate(date: string | Date) {
  return new Date(date).toLocaleString("fr-FR", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getTime(date: string | Date) {
  return new Date(date).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const getDateTimeWithoutTimezone = (date: string | Date) => {
  const dateObject = new Date(date);
  const year = dateObject.getFullYear();
  const month = (dateObject.getMonth() + 1).toString().padStart(2, "0");
  const day = dateObject.getDate().toString().padStart(2, "0");
  const hour = dateObject.getHours().toString().padStart(2, "0");
  const minute = dateObject.getMinutes().toString().padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

export const getDateTime = (date: string | Date) => {
  const dateObject = new Date(date);
  const year = dateObject.getFullYear();
  const month = (dateObject.getMonth() + 1).toString().padStart(2, "0");
  const day = dateObject.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getCurrentDateTime = () => {
  const currentDate = new Date();
  return getDateTimeWithoutTimezone(currentDate);
};

export const isToday = (date: string | Date) => {
  const currentDate = new Date();
  const givenDate = new Date(date);
  return (
    currentDate.getDate() === givenDate.getDate() &&
    currentDate.getMonth() === givenDate.getMonth() &&
    currentDate.getFullYear() === givenDate.getFullYear()
  );
};

export const isTomorrow = (date: string | Date) => {
  const currentDate = new Date();
  const givenDate = new Date(date);
  const tomorrow = new Date(currentDate);
  tomorrow.setDate(currentDate.getDate() + 1);
  return (
    tomorrow.getDate() === givenDate.getDate() &&
    tomorrow.getMonth() === givenDate.getMonth() &&
    tomorrow.getFullYear() === givenDate.getFullYear()
  );
};

export const SECOND_IN_MS = 1000;
export const MINUTE_IN_MS = 60 * SECOND_IN_MS;
export const HOUR_IN_MS = 60 * MINUTE_IN_MS;
export const DAY_IN_MS = 24 * HOUR_IN_MS;
export const WEEK_IN_MS = 7 * DAY_IN_MS;

// transform string like 2024-07-20T18:09 to as string in ISO format (2024-07-20T20:09:00.000+02:00) depending on the timezone
export const toISODateFormat = (dateTime: string | Date): string => {
  const date = new Date(dateTime);
  return date.toISOString();
};

export const addHours = (date: Date, hours: number) => {
  return new Date(date.getTime() + hours * HOUR_IN_MS);
};

export const isAfter = (date: Date, otherDate: Date) => {
  return date.getTime() > otherDate.getTime();
};

export const addDays = (date: Date, addDays: number) => {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() + addDays);
  return newDate;
};

export const addMonths = (date: Date, addMonths: number) => {
  const newDate = new Date(date);
  newDate.setMonth(newDate.getMonth() + addMonths);
  return newDate;
};
