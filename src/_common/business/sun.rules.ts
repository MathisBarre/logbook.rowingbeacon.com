export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

const RAD = Math.PI / 180;
const MINUTE_IN_MS = 60 * 1000;

/** Sun centre 50 arcminutes below the horizon: refraction + solar radius. */
const SUNRISE_ZENITH_DEGREES = 90.833;

/** Julian century (since J2000.0) for a Julian day. */
const toJulianCentury = (julianDay: number) => (julianDay - 2451545) / 36525;

/** Julian day of a UTC instant. */
const toJulianDay = (utcMs: number) => utcMs / 86400000 + 2440587.5;

/**
 * Sun declination (degrees) and equation of time (minutes) at a given
 * Julian century, following the NOAA solar position formulas.
 */
const solarPosition = (t: number) => {
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * RAD;

  const equationOfCenter =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const trueLongitude = meanLongitude + equationOfCenter;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude =
    trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

  const declination =
    Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) /
    RAD;

  const y = Math.tan((obliquity * RAD) / 2) ** 2;
  const l0 = meanLongitude * RAD;
  const equationOfTime =
    (4 *
      (y * Math.sin(2 * l0) -
        2 * eccentricity * Math.sin(m) +
        4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
        0.5 * y * y * Math.sin(4 * l0) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * m))) /
    RAD;

  return { declination, equationOfTime };
};

/** Cosine of the hour angle at which the sun crosses the horizon. */
const horizonCosHourAngle = (latitude: number, declination: number) =>
  Math.cos(SUNRISE_ZENITH_DEGREES * RAD) /
    (Math.cos(latitude * RAD) * Math.cos(declination * RAD)) -
  Math.tan(latitude * RAD) * Math.tan(declination * RAD);

/** Minutes after 00:00 UTC of the day at which the sun is at `zenith`. */
const eventMinutesUtc = (
  dayStartUtcMs: number,
  latitude: number,
  longitude: number,
  rising: boolean,
  guessMinutes: number
) => {
  const t = toJulianCentury(
    toJulianDay(dayStartUtcMs + guessMinutes * MINUTE_IN_MS)
  );
  const { declination, equationOfTime } = solarPosition(t);
  const cosHourAngle = horizonCosHourAngle(latitude, declination);

  // The sun never reaches the horizon (polar day) or never leaves it (polar night)
  if (cosHourAngle < -1 || cosHourAngle > 1) {
    return null;
  }
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const solarNoon = 720 - 4 * longitude - equationOfTime;

  return rising ? solarNoon - 4 * hourAngle : solarNoon + 4 * hourAngle;
};

/**
 * 00:00 UTC of the day whose solar noon falls on the local calendar day of
 * `date`. Usually that same day, but solar noon of a UTC day can fall on the
 * next or previous local day (Samoa: UTC+13 with a longitude near -172).
 */
const getSolarDayStartUtcMs = (date: Date, longitude: number) => {
  const requestedDayUtcMs = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const noon = new Date(
    requestedDayUtcMs + (720 - 4 * longitude) * MINUTE_IN_MS
  );
  return (
    2 * requestedDayUtcMs -
    Date.UTC(noon.getFullYear(), noon.getMonth(), noon.getDate())
  );
};

/**
 * Sunrise and sunset of the calendar day of `date` (read in the machine's
 * local timezone) at the given place, as absolute instants. Returns null
 * during polar day or polar night, or for an invalid place.
 */
export const getSunTimes = (
  date: Date,
  latitude: number,
  longitude: number
): SunTimes | null => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  const dayStartUtcMs = getSolarDayStartUtcMs(date, longitude);

  // Two passes: the sun position is evaluated at the event, not at midnight
  let sunriseMinutes: number | null = 720 - 4 * longitude;
  let sunsetMinutes: number | null = sunriseMinutes;
  for (let pass = 0; pass < 2; pass++) {
    if (sunriseMinutes === null || sunsetMinutes === null) {
      return null;
    }
    sunriseMinutes = eventMinutesUtc(
      dayStartUtcMs,
      latitude,
      longitude,
      true,
      sunriseMinutes
    );
    sunsetMinutes = eventMinutesUtc(
      dayStartUtcMs,
      latitude,
      longitude,
      false,
      sunsetMinutes
    );
  }
  if (sunriseMinutes === null || sunsetMinutes === null) {
    return null;
  }

  return {
    sunrise: new Date(dayStartUtcMs + sunriseMinutes * MINUTE_IN_MS),
    sunset: new Date(dayStartUtcMs + sunsetMinutes * MINUTE_IN_MS),
  };
};

/**
 * True when the sun stays below the horizon all day on the calendar day of
 * `date` (polar night), where getSunTimes returns null. The sun is looked at
 * on the same solar noon as getSunTimes, so both agree on the days where
 * polar night starts and ends.
 */
export const isPolarNight = (
  date: Date,
  latitude: number,
  longitude: number
) => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return false;
  }
  const solarNoonUtcMs =
    getSolarDayStartUtcMs(date, longitude) +
    (720 - 4 * longitude) * MINUTE_IN_MS;
  const { declination } = solarPosition(
    toJulianCentury(toJulianDay(solarNoonUtcMs))
  );
  return horizonCosHourAngle(latitude, declination) > 1;
};

/**
 * True when it is dark: after today's sunset, or before today's sunrise (the
 * small hours after midnight), or all day during polar night. Without sun
 * times and outside polar night (polar day, unknown place), false.
 */
export const isDark = (now: Date, sun: SunTimes | null, polarNight = false) =>
  sun === null
    ? polarNight
    : now.getTime() > sun.sunset.getTime() ||
      now.getTime() < sun.sunrise.getTime();

// "48", "48.", ".5" and "-0.5"; no exponent or hexadecimal
const COORDINATE_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Parses a latitude/longitude typed by hand. "48,8566" and the typographic
 * minus "−2,35" (some keyboards and copied text) are accepted.
 */
export const parseCoordinate = (
  value: string,
  limit: number
): number | null => {
  const normalized = value.trim().replace(",", ".").replace("\u2212", "-");
  if (normalized === "") {
    return null;
  }
  if (!COORDINATE_PATTERN.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    return null;
  }
  return parsed;
};
