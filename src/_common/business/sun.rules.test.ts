import { describe, expect, it } from "vitest";
import {
  getSunTimes,
  isDark,
  isPolarNight,
  parseCoordinate,
} from "./sun.rules";

const minutesUtc = (date: Date) =>
  date.getUTCHours() * 60 + date.getUTCMinutes();

describe("sun rules", () => {
  it("computes sunrise and sunset in Paris at the summer solstice", () => {
    const sun = getSunTimes(new Date(2026, 5, 21), 48.8566, 2.3522);

    // 05:47 and 21:58 CEST, i.e. 03:47 and 19:58 UTC
    expect(
      Math.abs(minutesUtc(sun!.sunrise) - (3 * 60 + 47))
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(minutesUtc(sun!.sunset) - (19 * 60 + 58))
    ).toBeLessThanOrEqual(3);
  });

  it("computes a short winter day in Paris", () => {
    const sun = getSunTimes(new Date(2026, 11, 21), 48.8566, 2.3522);

    // about 08:42 and 16:57 local (UTC+1)
    expect(
      Math.abs(minutesUtc(sun!.sunrise) - (7 * 60 + 42))
    ).toBeLessThanOrEqual(4);
    expect(
      Math.abs(minutesUtc(sun!.sunset) - (15 * 60 + 57))
    ).toBeLessThanOrEqual(4);
  });

  it("gives about twelve hours of daylight at the equator at an equinox", () => {
    const sun = getSunTimes(new Date(2026, 2, 20), 0, 0)!;
    const hours = (sun.sunset.getTime() - sun.sunrise.getTime()) / 3600000;

    expect(hours).toBeGreaterThan(12);
    expect(hours).toBeLessThan(12.2);
  });

  it("handles the southern hemisphere and the date line side", () => {
    // Sydney, winter solstice: about 07:00 and 16:54 AEST (UTC+10)
    const sun = getSunTimes(new Date(2026, 5, 21), -33.8688, 151.2093)!;

    expect(sun.sunrise.getTime()).toBeLessThan(sun.sunset.getTime());
    expect(
      Math.abs(minutesUtc(sun.sunrise) - (21 * 60 + 0))
    ).toBeLessThanOrEqual(5);
    expect(
      Math.abs(minutesUtc(sun.sunset) - (6 * 60 + 54))
    ).toBeLessThanOrEqual(5);
  });

  it("keeps the local day where the clock is far from solar time", () => {
    // Samoa is UTC+13 at longitude -172: solar noon is on the previous UTC day
    const previousTz = process.env.TZ;
    process.env.TZ = "Pacific/Apia";
    try {
      const today = new Date(2026, 9, 28, 14);
      const sun = getSunTimes(today, -13.83, -171.76)!;

      expect(sun.sunrise.getDate()).toBe(28);
      expect(sun.sunset.getDate()).toBe(28);
      expect(isDark(today, sun)).toBe(false);
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it("returns null during polar day and polar night", () => {
    expect(getSunTimes(new Date(2026, 5, 21), 69.6492, 18.9553)).toBeNull();
    expect(getSunTimes(new Date(2026, 11, 21), 69.6492, 18.9553)).toBeNull();
  });

  it("tells polar night from polar day", () => {
    expect(isPolarNight(new Date(2026, 11, 21), 69.6492, 18.9553)).toBe(true);
    expect(isPolarNight(new Date(2026, 5, 21), 69.6492, 18.9553)).toBe(false);
    expect(isPolarNight(new Date(2026, 5, 21), -77.85, 166.67)).toBe(true);
    expect(isPolarNight(new Date(2026, 11, 21), 48.8566, 2.3522)).toBe(false);
    expect(isDark(new Date(), null, true)).toBe(true);
  });

  it("counts the first day without sun as polar night, far from UTC", () => {
    // Utqiagvik (UTC-9): the sun no longer rises from 19 November 2026
    const previousTz = process.env.TZ;
    process.env.TZ = "America/Anchorage";
    try {
      for (let day = 1; day <= 30; day++) {
        const date = new Date(2026, 10, day);
        const sun = getSunTimes(date, 71.29, -156.79);
        const polarNight = isPolarNight(date, 71.29, -156.79);

        // Every day has either sun times or polar night, never neither
        expect(sun !== null || polarNight).toBe(true);
      }
      const firstNight = new Date(2026, 10, 19);
      expect(getSunTimes(firstNight, 71.29, -156.79)).toBeNull();
      expect(isPolarNight(firstNight, 71.29, -156.79)).toBe(true);
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it("returns null for an impossible place", () => {
    expect(getSunTimes(new Date(2026, 5, 21), 120, 0)).toBeNull();
    expect(getSunTimes(new Date(2026, 5, 21), Number.NaN, 0)).toBeNull();
  });

  it("knows when it is dark", () => {
    const sun = getSunTimes(new Date(2026, 5, 21), 48.8566, 2.3522)!;

    expect(isDark(new Date(sun.sunset.getTime() + 60000), sun)).toBe(true);
    expect(isDark(new Date(sun.sunset.getTime() - 60000), sun)).toBe(false);
    expect(isDark(new Date(sun.sunrise.getTime() + 60000), sun)).toBe(false);
    expect(isDark(new Date(), null)).toBe(false);
  });

  it("is still dark after midnight, before sunrise", () => {
    const sun = getSunTimes(new Date(2026, 5, 21), 48.8566, 2.3522)!;

    expect(isDark(new Date(sun.sunrise.getTime() - 60000), sun)).toBe(true);
  });

  it("parses typed coordinates", () => {
    expect(parseCoordinate(" 48,8566 ", 90)).toBe(48.8566);
    expect(parseCoordinate("-2.35", 180)).toBe(-2.35);
    expect(parseCoordinate("", 90)).toBeNull();
    expect(parseCoordinate("abc", 90)).toBeNull();
    expect(parseCoordinate("95", 90)).toBeNull();
    expect(parseCoordinate("-", 90)).toBeNull();
    expect(parseCoordinate("0x10", 90)).toBeNull();
    expect(parseCoordinate("1e1", 90)).toBeNull();
    expect(parseCoordinate("0", 90)).toBe(0);
    expect(parseCoordinate("48.", 90)).toBe(48);
    expect(parseCoordinate(".5", 90)).toBe(0.5);
    expect(parseCoordinate("\u22122,35", 180)).toBe(-2.35);
    expect(parseCoordinate(".", 90)).toBeNull();
  });
});
