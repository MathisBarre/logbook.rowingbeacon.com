import { describe, expect, it } from "vitest";
import {
  getExpiredV1Backups,
  getV1BackupDate,
  toV1BackupFileName,
} from "./v1Backups";

describe("v1 backups", () => {
  it("reads the date back from the file name", () => {
    const date = new Date("2026-10-19T09:11:45.123Z");
    expect(getV1BackupDate(toV1BackupFileName(date))).toEqual(date);
    expect(getV1BackupDate("efa-backup.zip")).toBeNull();
  });

  it("only expires v1 backups older than 90 days", () => {
    const now = new Date("2027-03-01T00:00:00.000Z");
    const old = toV1BackupFileName(new Date("2026-10-19T09:00:00.000Z"));
    const recent = toV1BackupFileName(new Date("2027-02-01T09:00:00.000Z"));
    expect(getExpiredV1Backups([old, recent, "other.json"], now)).toEqual([
      old,
    ]);
  });
});
