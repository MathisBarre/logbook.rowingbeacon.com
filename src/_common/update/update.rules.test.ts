import { describe, expect, it } from "vitest";
import {
  getChangelogUrl,
  getDownloadPercent,
  getReleaseNotes,
} from "./update.rules";

describe("getChangelogUrl", () => {
  it("opens the download page in the app language", () => {
    expect(getChangelogUrl("fr-FR")).toBe(
      "https://rowingbeacon.com/fr-FR/download"
    );
  });

  it("falls back to English before a language is chosen", () => {
    expect(getChangelogUrl(null)).toBe(
      "https://rowingbeacon.com/en-US/download"
    );
  });
});

describe("getDownloadPercent", () => {
  it("rounds down so that 100 % means downloaded", () => {
    expect(getDownloadPercent(999, 1000)).toBe(99);
    expect(getDownloadPercent(1000, 1000)).toBe(100);
  });

  it("is unknown without a size", () => {
    expect(getDownloadPercent(500)).toBeNull();
    expect(getDownloadPercent(500, 0)).toBeNull();
  });
});

describe("getReleaseNotes", () => {
  it("keeps the notes written for the release", () => {
    expect(getReleaseNotes("  Fixes the return form\n", "2.0.2")).toBe(
      "Fixes the return form"
    );
  });

  it("hides empty notes and the default release title", () => {
    expect(getReleaseNotes(undefined, "2.0.2")).toBeNull();
    expect(getReleaseNotes("  ", "2.0.2")).toBeNull();
    expect(getReleaseNotes("Rowing Beacon v2.0.2", "2.0.2")).toBeNull();
  });
});
