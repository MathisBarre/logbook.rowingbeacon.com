import { describe, expect, test } from "vitest";
import {
  createMachineId,
  getBackupFileName,
  isAutoBackupDue,
  isExternalAutoCopyDue,
  parseBackupFileName,
  selectBackupsToPrune,
} from "./backup.rules";

describe("backup rules", () => {
  test("file names carry the local time and the kind", () => {
    const name = getBackupFileName(
      "before-import",
      new Date(2026, 9, 19, 8, 5, 3)
    );
    expect(name).toBe("rowingbeacon-2026-10-19_08-05-03-before-import.db");
    expect(parseBackupFileName(name)).toEqual({
      fileName: name,
      kind: "before-import",
      createdAt: "2026-10-19T08:05:03",
    });
    expect(parseBackupFileName("v1-backup.json")).toBeNull();
    expect(
      parseBackupFileName("rowingbeacon-2026-10-19_08-05-03-other.db")
    ).toBeNull();
  });

  test("only automatic backups beyond the newest ones are pruned", () => {
    const backups = Array.from(
      { length: 16 },
      (_, day) =>
        parseBackupFileName(
          getBackupFileName("auto", new Date(2026, 0, day + 1))
        )!
    );
    backups.push(
      parseBackupFileName(getBackupFileName("manual", new Date(2025, 0, 1)))!
    );

    const pruned = selectBackupsToPrune(backups, 14);
    expect(pruned.map((b) => b.createdAt.slice(0, 10))).toEqual([
      "2026-01-02",
      "2026-01-01",
    ]);
  });

  test("an automatic backup is due after 24 hours", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(isAutoBackupDue(null, now)).toBe(true);
    expect(isAutoBackupDue("2026-10-19T00:00:00Z", now)).toBe(false);
    expect(isAutoBackupDue("2026-10-18T11:59:00Z", now)).toBe(true);
    // The clock was set in the future, then corrected.
    expect(isAutoBackupDue("2027-01-01T00:00:00Z", now)).toBe(true);
  });

  test("automatic backups reach the second folder once a week", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(isExternalAutoCopyDue(null, now)).toBe(true);
    expect(isExternalAutoCopyDue("2026-10-15T12:00:00Z", now)).toBe(false);
    expect(isExternalAutoCopyDue("2026-10-12T12:00:00Z", now)).toBe(true);
  });

  test("names carry the computer, which only prunes its own backups", () => {
    const machine = createMachineId(() => 0.5);
    expect(machine).toMatch(/^p[a-z0-9]{5}$/);
    const name = getBackupFileName("auto", new Date(2026, 0, 1), machine);
    expect(name).toBe(`rowingbeacon-${machine}-2026-01-01_00-00-00-auto.db`);
    expect(parseBackupFileName(name)).toMatchObject({
      kind: "auto",
      machineId: machine,
      createdAt: "2026-01-01T00:00:00",
    });

    const other = Array.from(
      { length: 3 },
      (_, day) =>
        parseBackupFileName(
          getBackupFileName("auto", new Date(2026, 0, day + 1), "pother")
        )!
    );
    const mine = Array.from(
      { length: 3 },
      (_, day) =>
        parseBackupFileName(
          getBackupFileName("auto", new Date(2026, 0, day + 1), machine)
        )!
    );
    const pruned = selectBackupsToPrune([...other, ...mine], 1, machine);
    expect(pruned.every((b) => b.machineId === machine)).toBe(true);
    expect(pruned).toHaveLength(2);
  });
});
