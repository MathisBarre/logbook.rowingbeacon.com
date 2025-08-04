import { describe, it, expect } from "vitest";
import { getSeasons } from "./SeasonSelector";

describe("getSeasons", () => {
  it("should return all seasons when data spans multiple years", () => {
    const firstDataAt = new Date(2023, 7, 1); // August 1, 2023
    const lastDataAt = new Date(2025, 7, 4); // August 4, 2025

    const seasons = getSeasons(firstDataAt, lastDataAt);

    expect(seasons).toHaveLength(3);

    // Season 2023-2024
    expect(seasons[0].startDate).toEqual(new Date(2023, 7, 1)); // August 1, 2023
    expect(seasons[0].endDate).toEqual(new Date(2024, 6, 31)); // July 31, 2024

    // Season 2024-2025
    expect(seasons[1].startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(seasons[1].endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025

    // Season 2025-2026 - This should be included since data goes to August 4, 2025
    expect(seasons[2].startDate).toEqual(new Date(2025, 7, 1)); // August 1, 2025
    expect(seasons[2].endDate).toEqual(new Date(2026, 6, 31)); // July 31, 2026
  });

  it("should return single season when data is within one season", () => {
    const firstDataAt = new Date(2024, 7, 15); // August 15, 2024
    const lastDataAt = new Date(2024, 11, 10); // December 10, 2024

    const seasons = getSeasons(firstDataAt, lastDataAt);

    expect(seasons).toHaveLength(1);
    expect(seasons[0].startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(seasons[0].endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025
  });

  it("should return two seasons when data spans exactly two seasons", () => {
    const firstDataAt = new Date(2023, 7, 1); // August 1, 2023
    const lastDataAt = new Date(2024, 7, 1); // August 1, 2024

    const seasons = getSeasons(firstDataAt, lastDataAt);

    expect(seasons).toHaveLength(2);
    expect(seasons[0].startDate).toEqual(new Date(2023, 7, 1)); // August 1, 2023
    expect(seasons[1].startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
  });

  it("should handle edge case when last data is exactly at season start", () => {
    const firstDataAt = new Date(2023, 7, 1); // August 1, 2023
    const lastDataAt = new Date(2025, 7, 1); // August 1, 2025 (exactly at season start)

    const seasons = getSeasons(firstDataAt, lastDataAt);

    expect(seasons).toHaveLength(3);
    expect(seasons[2].startDate).toEqual(new Date(2025, 7, 1)); // August 1, 2025
  });

  it("should handle edge case when last data is just before season end", () => {
    const firstDataAt = new Date(2023, 7, 1); // August 1, 2023
    const lastDataAt = new Date(2025, 6, 30); // July 30, 2025 (just before season end)

    const seasons = getSeasons(firstDataAt, lastDataAt);

    // Should still include 2024-2025 season but not 2025-2026
    expect(seasons).toHaveLength(2);
    expect(seasons[1].startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(seasons[1].endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025
  });

  it("should handle when firstDataAt > lastDataAt", () => {
    const firstDataAt = new Date(2024, 7, 1); // August 1, 2024
    const lastDataAt = new Date(2023, 7, 1); // August 1, 2023 (earlier than first)

    const seasons = getSeasons(firstDataAt, lastDataAt);

    // Should use firstDataAt as lastDate since it's greater
    expect(seasons).toHaveLength(1);
    expect(seasons[0].startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
  });

  it("should reproduce the reported issue - August 4 should include 3 seasons", () => {
    // This is the specific case mentioned by the user
    const firstDataAt = new Date(2023, 7, 1); // August 1, 2023
    const lastDataAt = new Date(2025, 7, 4); // August 4, 2025

    const seasons = getSeasons(firstDataAt, lastDataAt);

    // Should return 3 seasons including 2025-2026
    expect(seasons).toHaveLength(3);

    // Verify each season
    expect(seasons[0].startDate.getFullYear()).toBe(2023);
    expect(seasons[1].startDate.getFullYear()).toBe(2024);
    expect(seasons[2].startDate.getFullYear()).toBe(2025); // This should be included
  });

  it("should handle dates in the middle of seasons correctly", () => {
    const firstDataAt = new Date(2023, 9, 15); // October 15, 2023 (middle of 2023-2024 season)
    const lastDataAt = new Date(2025, 2, 10); // March 10, 2025 (middle of 2024-2025 season)

    const seasons = getSeasons(firstDataAt, lastDataAt);

    expect(seasons).toHaveLength(2);
    // First season based on October 2023 date
    expect(seasons[0].startDate).toEqual(new Date(2023, 7, 1)); // August 1, 2023
    expect(seasons[0].endDate).toEqual(new Date(2024, 6, 31)); // July 31, 2024

    // Second season
    expect(seasons[1].startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(seasons[1].endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025
  });

  it("should reproduce the specific reported bug - November to August should include 3 seasons", () => {
    // The exact case reported by the user
    const firstDataAt = new Date(2023, 10, 18, 8, 25); // November 18, 2023 08:25
    const lastDataAt = new Date(2025, 7, 4, 14, 47); // August 4, 2025 14:47

    const seasons = getSeasons(firstDataAt, lastDataAt);

    // Should return 3 seasons:
    // 1. 2023-2024 (Nov 2023 falls in this season)
    // 2. 2024-2025
    // 3. 2025-2026 (Aug 4, 2025 falls in this season)
    expect(seasons).toHaveLength(3);

    // Verify each season
    expect(seasons[0].startDate.getFullYear()).toBe(2023);
    expect(seasons[1].startDate.getFullYear()).toBe(2024);
    expect(seasons[2].startDate.getFullYear()).toBe(2025); // This should be included
  });
});
