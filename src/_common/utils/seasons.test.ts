import { describe, it, expect } from "vitest";
import { getSeasonDate } from "./seasons";

describe("getCurrentSeasonDate", () => {
  it("should return correct dates when current date is in season (September or later)", () => {
    const testDate = new Date(2024, 8, 15); // September 15, 2024
    const result = getSeasonDate(testDate);

    expect(result.startDate).toEqual(new Date(2024, 7, 1)); // August 1, 2024
    expect(result.endDate).toEqual(new Date(2024, 11, 31)); // December 31, 2024
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
    expect(result.endDate).toEqual(new Date(2024, 11, 31)); // December 31, 2024
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
