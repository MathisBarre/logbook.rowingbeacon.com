import { afterEach, describe, it, expect } from "vitest";
import { getSeasonDate } from "./seasons";
import { useAnalyticsSettingsStore } from "../../analytics/store/analyticsSettings.store";

describe("getCurrentSeasonDate", () => {
  it("should return correct dates when current date is in season (September or later)", () => {
    const testDate = new Date(2024, 8, 15); // September 15, 2024
    const result = getSeasonDate(testDate);

    expect(result.startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(result.endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025
  });

  it("should return correct dates when current date is before season (before September)", () => {
    const testDate = new Date(2024, 2, 15); // March 15, 2024
    const result = getSeasonDate(testDate);

    expect(result.startDate).toEqual(new Date(2023, 7, 1)); // August 1, 2023
    expect(result.endDate).toEqual(new Date(2024, 6, 31)); // July 31, 2024
  });

  it("should handle the transition month (September) correctly", () => {
    const testDate = new Date(2024, 8, 1); // September 1, 2024
    const result = getSeasonDate(testDate);

    expect(result.startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(result.endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025
  });

  it("should handle the transition month (August) correctly", () => {
    const testDate = new Date(2024, 7, 4); // August 4, 2024
    const result = getSeasonDate(testDate);

    expect(result.startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(result.endDate).toEqual(new Date(2025, 6, 31)); // July 31, 2025
  });

  it("should handle year transition correctly", () => {
    const testDate = new Date(2024, 0, 1); // January 1, 2024
    const result = getSeasonDate(testDate);

    expect(result.startDate).toEqual(new Date(2023, 7, 1)); // August 1, 2023
    expect(result.endDate).toEqual(new Date(2024, 6, 31)); // July 31, 2024
  });

  it("should use current date when no date is provided", () => {
    const now = new Date();
    const result = getSeasonDate();
    const resultWithDate = getSeasonDate(now);

    expect(result.startDate.getFullYear()).toBe(
      resultWithDate.startDate.getFullYear()
    );
    expect(result.startDate.getMonth()).toBe(
      resultWithDate.startDate.getMonth()
    );
    expect(result.endDate.getFullYear()).toBe(
      resultWithDate.endDate.getFullYear()
    );
    expect(result.endDate.getMonth()).toBe(resultWithDate.endDate.getMonth());
  });
});

describe("getSeasonDate with another season start", () => {
  afterEach(() => {
    useAnalyticsSettingsStore.getState().reset();
  });

  it("takes an explicit 0-based start month", () => {
    const result = getSeasonDate(new Date(2024, 7, 15), 8); // September start
    expect(result.startDate).toEqual(new Date(2023, 8, 1));
    expect(result.endDate).toEqual(new Date(2024, 7, 31));
  });

  it("follows analytics.seasonStartMonth by default", () => {
    useAnalyticsSettingsStore
      .getState()
      .hydrate({ "analytics.seasonStartMonth": 1 });
    const result = getSeasonDate(new Date(2024, 7, 15));
    expect(result.startDate).toEqual(new Date(2024, 0, 1));
    expect(result.endDate).toEqual(new Date(2024, 11, 31));
  });
});
