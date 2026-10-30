import { describe, expect, it } from "vitest";
import {
  currentSeason,
  formatSeason,
  listSeasons,
  localNow,
  seasonBounds,
} from "./season";

describe("season", () => {
  it.each([
    ["2025-07-31T23:59", 8, 2024],
    ["2025-08-01T00:00", 8, 2025],
    ["2025-12-31", 8, 2025],
    ["2025-08-31T10:00", 9, 2024],
    ["2025-09-01T10:00", 9, 2025],
    ["2025-01-01T00:00", 1, 2025],
    ["2025-12-31T23:59", 1, 2025],
  ])("%s with start month %i is in season %i", (now, month, season) => {
    expect(currentSeason(now, month)).toBe(season);
  });

  it("gives exclusive bounds", () => {
    expect(seasonBounds(2025, 8)).toEqual({
      start: "2025-08-01",
      end: "2026-08-01",
    });
    expect(seasonBounds(2025, 1)).toEqual({
      start: "2025-01-01",
      end: "2026-01-01",
    });
  });

  it("labels seasons", () => {
    expect(formatSeason(2025, 8)).toBe("2025-2026");
    expect(formatSeason(2025, 9)).toBe("2025-2026");
    expect(formatSeason(2025, 1)).toBe("2025");
  });

  it("lists seasons from the first outing, most recent first", () => {
    expect(listSeasons("2023-09-12T18:00", "2026-06-20T09:47", 8)).toEqual([
      2025, 2024, 2023,
    ]);
    expect(listSeasons("2023-07-12", "2026-06-20T09:47", 8)).toEqual([
      2025, 2024, 2023, 2022,
    ]);
    expect(listSeasons(null, "2026-06-20T09:47", 8)).toEqual([2025]);
    expect(listSeasons("2030-01-01", "2026-06-20T09:47", 8)).toEqual([2025]);
  });

  it("formats now as local wall-clock text", () => {
    expect(localNow(new Date(2026, 5, 20, 9, 47))).toBe("2026-06-20T09:47");
  });
});
