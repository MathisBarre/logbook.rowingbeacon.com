import { describe, expect, test } from "vitest";
import { millisecondToDayHourMinutes } from "./time.utils";

const ONE_SECOND = 1000;
const ONE_MINUTE = ONE_SECOND * 60;
const ONE_HOUR = ONE_MINUTE * 60;
const ONE_DAY = ONE_HOUR * 24;

describe("millisecondToDayHourMinutes", () => {
  describe("when 0ms", () => {
    test("should return 0min", () => {
      expect(millisecondToDayHourMinutes(0)).toBe("0min");
    });
  });

  describe("when 1 minute", () => {
    test("should return 1min", () => {
      expect(millisecondToDayHourMinutes(ONE_MINUTE)).toBe("1min");
    });
  });

  describe("when 1 hour", () => {
    test("should return 1h", () => {
      expect(millisecondToDayHourMinutes(ONE_HOUR)).toBe("1h 0min");
    });
  });

  describe("when 1 day", () => {
    test("should return 1j", () => {
      expect(millisecondToDayHourMinutes(ONE_DAY)).toBe("1j 0h 0min");
    });
  });

  describe("when 1 day, 1 hour, 1 minute", () => {
    test("should return 1j 1h 1min", () => {
      expect(millisecondToDayHourMinutes(ONE_DAY + ONE_HOUR + ONE_MINUTE)).toBe(
        "1j 1h 1min"
      );
    });
  });
});
