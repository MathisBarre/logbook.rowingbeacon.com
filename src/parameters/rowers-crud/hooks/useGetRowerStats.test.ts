import { describe, test, expect } from "vitest";
import {
  calculateTotalDuration,
  calculateCoachedSessionsStats,
  calculateSessionDateRange,
  calculateMostUsedBoats,
  calculateMostFrequentPartners,
  getSessionIds,
  getPercentage,
} from "./useGetRowerStats";

// Mock data
const createMockSession = (
  id: string,
  startDateTime: string,
  endDateTime: string | null = null,
  boatId: string | null = null,
  hasBeenCoached: string | null = null
) => ({
  session: {
    id,
    startDateTime,
    endDateTime,
    boatId,
    hasBeenCoached,
  },
});

const createMockSessionOnRower = (rowerId: string, sessionId: string) => ({
  rowerId,
  sessionId,
});

describe("calculateTotalDuration", () => {
  test("calculates total duration correctly for valid sessions", () => {
    const sessions = [
      createMockSession("1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z"),
      createMockSession("2", "2024-01-02T10:00:00Z", "2024-01-02T11:30:00Z"),
    ];

    const result = calculateTotalDuration(sessions);
    // 2 hours + 1.5 hours = 3.5 hours = 12,600,000 milliseconds
    expect(result).toBe(12600000);
  });

  test("ignores sessions without start or end time", () => {
    const sessions = [
      createMockSession("1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z"),
      createMockSession("2", "2024-01-02T10:00:00Z", null),
      createMockSession("3", "", "2024-01-03T12:00:00Z"),
    ];

    const result = calculateTotalDuration(sessions);
    // Only first session: 2 hours = 7,200,000 milliseconds
    expect(result).toBe(7200000);
  });

  test("returns 0 for empty sessions array", () => {
    const result = calculateTotalDuration([]);
    expect(result).toBe(0);
  });

  test("handles sessions with null session data", () => {
    const sessions = [
      { session: null },
      createMockSession("1", "2024-01-01T10:00:00Z", "2024-01-01T11:00:00Z"),
    ];

    const result = calculateTotalDuration(sessions);
    // Only valid session: 1 hour = 3,600,000 milliseconds
    expect(result).toBe(3600000);
  });
});

describe("calculateCoachedSessionsStats", () => {
  test("calculates coached sessions correctly", () => {
    const sessions = [
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1",
        "true"
      ),
      createMockSession(
        "2",
        "2024-01-02T10:00:00Z",
        "2024-01-02T11:30:00Z",
        "boat2",
        "false"
      ),
      createMockSession(
        "3",
        "2024-01-03T10:00:00Z",
        "2024-01-03T11:30:00Z",
        "boat3",
        "true"
      ),
      createMockSession(
        "4",
        "2024-01-04T10:00:00Z",
        "2024-01-04T11:30:00Z",
        "boat4",
        null
      ),
    ];

    const result = calculateCoachedSessionsStats(sessions);

    expect(result.coachedSessionsCount).toBe(2);
    // 2 coached out of 3 sessions with coaching info = 66.67%
    expect(result.coachedSessionsPercentage).toBeCloseTo(66.67, 2);
  });

  test("handles all sessions without coaching info", () => {
    const sessions = [
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1",
        null
      ),
      createMockSession(
        "2",
        "2024-01-02T10:00:00Z",
        "2024-01-02T11:30:00Z",
        "boat2",
        null
      ),
    ];

    const result = calculateCoachedSessionsStats(sessions);

    expect(result.coachedSessionsCount).toBe(0);
    expect(result.coachedSessionsPercentage).toBe(0);
  });

  test("handles empty sessions array", () => {
    const result = calculateCoachedSessionsStats([]);

    expect(result.coachedSessionsCount).toBe(0);
    expect(result.coachedSessionsPercentage).toBe(0);
  });

  test("handles sessions with null session data", () => {
    const sessions = [
      { session: null },
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1",
        "true"
      ),
    ];

    const result = calculateCoachedSessionsStats(sessions);

    expect(result.coachedSessionsCount).toBe(1);
    expect(result.coachedSessionsPercentage).toBe(100);
  });
});

describe("calculateSessionDateRange", () => {
  test("calculates date range correctly", () => {
    const sessions = [
      createMockSession("1", "2024-01-15T10:00:00Z", "2024-01-15T12:00:00Z"),
      createMockSession("2", "2024-01-01T10:00:00Z", "2024-01-01T11:30:00Z"),
      createMockSession("3", "2024-01-30T10:00:00Z", "2024-01-30T11:30:00Z"),
    ];

    const result = calculateSessionDateRange(sessions);

    expect(result.firstSessionDate).toEqual(new Date("2024-01-01T10:00:00Z"));
    expect(result.lastSessionDate).toEqual(new Date("2024-01-30T11:30:00Z"));
  });

  test("ignores sessions without valid dates", () => {
    const sessions = [
      createMockSession("1", "2024-01-15T10:00:00Z", "2024-01-15T12:00:00Z"),
      createMockSession("2", "", "2024-01-01T11:30:00Z"),
      createMockSession("3", "2024-01-30T10:00:00Z", null),
    ];

    const result = calculateSessionDateRange(sessions);

    expect(result.firstSessionDate).toEqual(new Date("2024-01-15T10:00:00Z"));
    expect(result.lastSessionDate).toEqual(new Date("2024-01-15T12:00:00Z"));
  });

  test("returns undefined dates for empty sessions", () => {
    const result = calculateSessionDateRange([]);

    expect(result.firstSessionDate).toBeUndefined();
    expect(result.lastSessionDate).toBeUndefined();
  });

  test("returns undefined dates for sessions without valid dates", () => {
    const sessions = [
      createMockSession("1", "", null),
      createMockSession("2", "2024-01-01T10:00:00Z", null),
    ];

    const result = calculateSessionDateRange(sessions);

    expect(result.firstSessionDate).toBeUndefined();
    expect(result.lastSessionDate).toBeUndefined();
  });
});

describe("calculateMostUsedBoats", () => {
  test("calculates most used boats correctly", () => {
    const sessions = [
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1"
      ),
      createMockSession(
        "2",
        "2024-01-02T10:00:00Z",
        "2024-01-02T11:30:00Z",
        "boat2"
      ),
      createMockSession(
        "3",
        "2024-01-03T10:00:00Z",
        "2024-01-03T11:30:00Z",
        "boat1"
      ),
      createMockSession(
        "4",
        "2024-01-04T10:00:00Z",
        "2024-01-04T11:30:00Z",
        "boat3"
      ),
      createMockSession(
        "5",
        "2024-01-05T10:00:00Z",
        "2024-01-05T11:30:00Z",
        "boat1"
      ),
    ];

    const result = calculateMostUsedBoats(sessions);

    expect(result).toEqual([
      { id: "boat1", count: 3 },
      { id: "boat2", count: 1 },
      { id: "boat3", count: 1 },
    ]);
  });

  test("respects the limit parameter", () => {
    const sessions = [
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1"
      ),
      createMockSession(
        "2",
        "2024-01-02T10:00:00Z",
        "2024-01-02T11:30:00Z",
        "boat2"
      ),
      createMockSession(
        "3",
        "2024-01-03T10:00:00Z",
        "2024-01-03T11:30:00Z",
        "boat3"
      ),
    ];

    const result = calculateMostUsedBoats(sessions, 2);

    expect(result).toHaveLength(2);
  });

  test("ignores sessions without boat IDs", () => {
    const sessions = [
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1"
      ),
      createMockSession(
        "2",
        "2024-01-02T10:00:00Z",
        "2024-01-02T11:30:00Z",
        null
      ),
      createMockSession(
        "3",
        "2024-01-03T10:00:00Z",
        "2024-01-03T11:30:00Z",
        "boat1"
      ),
    ];

    const result = calculateMostUsedBoats(sessions);

    expect(result).toEqual([{ id: "boat1", count: 2 }]);
  });

  test("handles empty sessions array", () => {
    const result = calculateMostUsedBoats([]);
    expect(result).toEqual([]);
  });

  test("handles sessions with null session data", () => {
    const sessions = [
      { session: null },
      createMockSession(
        "1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z",
        "boat1"
      ),
    ];

    const result = calculateMostUsedBoats(sessions);

    expect(result).toEqual([{ id: "boat1", count: 1 }]);
  });
});

describe("calculateMostFrequentPartners", () => {
  test("calculates most frequent partners correctly", () => {
    const sessionsOnRower = [
      createMockSessionOnRower("rower1", "session1"),
      createMockSessionOnRower("rower2", "session1"),
      createMockSessionOnRower("rower1", "session2"),
      createMockSessionOnRower("rower3", "session3"),
      createMockSessionOnRower("rower1", "session4"),
    ];

    const result = calculateMostFrequentPartners(sessionsOnRower);

    expect(result).toEqual([
      { id: "rower1", count: 3 },
      { id: "rower2", count: 1 },
      { id: "rower3", count: 1 },
    ]);
  });

  test("respects the limit parameter", () => {
    const sessionsOnRower = [
      createMockSessionOnRower("rower1", "session1"),
      createMockSessionOnRower("rower2", "session2"),
      createMockSessionOnRower("rower3", "session3"),
    ];

    const result = calculateMostFrequentPartners(sessionsOnRower, 2);

    expect(result).toHaveLength(2);
  });

  test("handles empty sessionsOnRower array", () => {
    const result = calculateMostFrequentPartners([]);
    expect(result).toEqual([]);
  });

  test("sorts by count in descending order", () => {
    const sessionsOnRower = [
      createMockSessionOnRower("rower1", "session1"),
      createMockSessionOnRower("rower2", "session2"),
      createMockSessionOnRower("rower2", "session3"),
      createMockSessionOnRower("rower2", "session4"),
      createMockSessionOnRower("rower3", "session5"),
      createMockSessionOnRower("rower3", "session6"),
    ];

    const result = calculateMostFrequentPartners(sessionsOnRower);

    expect(result).toEqual([
      { id: "rower2", count: 3 },
      { id: "rower3", count: 2 },
      { id: "rower1", count: 1 },
    ]);
  });
});

describe("getSessionIds", () => {
  test("extracts session IDs correctly", () => {
    const sessions = [
      createMockSession(
        "session1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z"
      ),
      createMockSession(
        "session2",
        "2024-01-02T10:00:00Z",
        "2024-01-02T11:30:00Z"
      ),
      createMockSession(
        "session3",
        "2024-01-03T10:00:00Z",
        "2024-01-03T11:30:00Z"
      ),
    ];

    const result = getSessionIds(sessions);

    expect(result).toEqual(["session1", "session2", "session3"]);
  });

  test("filters out sessions with null session data", () => {
    const sessions = [
      createMockSession(
        "session1",
        "2024-01-01T10:00:00Z",
        "2024-01-01T12:00:00Z"
      ),
      { session: null },
      createMockSession(
        "session3",
        "2024-01-03T10:00:00Z",
        "2024-01-03T11:30:00Z"
      ),
    ];

    const result = getSessionIds(sessions);

    expect(result).toEqual(["session1", "session3"]);
  });

  test("handles empty sessions array", () => {
    const result = getSessionIds([]);
    expect(result).toEqual([]);
  });

  test("handles sessions where all have null session data", () => {
    const sessions = [{ session: null }, { session: null }];

    const result = getSessionIds(sessions);
    expect(result).toEqual([]);
  });
});

describe("getPercentage", () => {
  test("calculates percentage correctly for normal values", () => {
    const result = getPercentage({
      totalNumber: 100,
      partNumber: 25,
    });

    expect(result).toBe(25);
  });

  test("calculates percentage correctly for partial numbers", () => {
    const result = getPercentage({
      totalNumber: 3,
      partNumber: 2,
    });

    expect(result).toBeCloseTo(66.67, 2);
  });

  test("returns 100 when part equals total", () => {
    const result = getPercentage({
      totalNumber: 50,
      partNumber: 50,
    });

    expect(result).toBe(100);
  });

  test("returns 0 when part is 0", () => {
    const result = getPercentage({
      totalNumber: 100,
      partNumber: 0,
    });

    expect(result).toBe(0);
  });

  test("returns 0 when total is 0", () => {
    const result = getPercentage({
      totalNumber: 0,
      partNumber: 5,
    });

    expect(result).toBe(0);
  });

  test("returns 0 when total is negative", () => {
    const result = getPercentage({
      totalNumber: -10,
      partNumber: 5,
    });

    expect(result).toBe(0);
  });

  test("handles decimal numbers correctly", () => {
    const result = getPercentage({
      totalNumber: 7.5,
      partNumber: 2.25,
    });

    expect(result).toBe(30);
  });

  test("handles very small numbers", () => {
    const result = getPercentage({
      totalNumber: 0.001,
      partNumber: 0.0005,
    });

    expect(result).toBe(50);
  });

  test("returns percentage greater than 100 when part exceeds total", () => {
    const result = getPercentage({
      totalNumber: 50,
      partNumber: 75,
    });

    expect(result).toBe(150);
  });

  test("handles negative part number", () => {
    const result = getPercentage({
      totalNumber: 100,
      partNumber: -25,
    });

    expect(result).toBe(-25);
  });
});
