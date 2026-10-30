import { afterAll, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../_common/i18n/config";
import {
  columnLabel,
  dayNumber,
  formatValue,
  fromDayNumber,
  inferFormat,
  isoWeekday,
  parseLocalDate,
} from "./format";
import type { SqlValue } from "../types";

/** Narrow and regular no-break spaces read as spaces. */
const n = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");

const fmt = (
  locale: string,
  column: string,
  value: SqlValue,
  extra: { seasonStartMonth?: number; params?: Record<string, string> } = {}
) =>
  n(
    formatValue(column, value, {
      locale,
      seasonStartMonth: extra.seasonStartMonth ?? 8,
      params: extra.params,
      t: i18n.getFixedT(locale),
    })
  );

const ZONES = ["America/Los_Angeles", "Pacific/Auckland", "UTC"];
const originalTz = process.env.TZ;

beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe.each(ZONES)("formatValue under TZ=%s", (zone) => {
  beforeAll(() => {
    process.env.TZ = zone;
  });

  it.each([
    // [column, value, fr-FR, en-US]
    ["km", 1234.4, "1 234 km", "1,234 km"],
    ["distance_km", 12.34, "12,3 km", "12.3 km"],
    ["km_season", 99.95, "100 km", "100 km"],
    ["coached_pct", 35, "35 %", "35%"],
    ["guest_share_pct", 3.5, "3,5 %", "3.5%"],
    ["hours", 12.5, "12,5 h", "12.5 h"],
    ["hours_season", 3, "3 h", "3 h"],
    ["duration_min", 45, "45 min", "45 min"],
    ["duration_min", 75, "1 h 15", "1 h 15 min"],
    ["return_delay_min", 125, "2 h 05", "2 h 05 min"],
    ["start_date", "2025-08-04", "4 août 2025", "August 4, 2025"],
    ["date", "2026-01-01", "1 janvier 2026", "January 1, 2026"],
    ["week_start", "2025-12-31", "31 décembre 2025", "December 31, 2025"],
    [
      "start_at",
      "2025-08-04T18:30",
      "4 août 2025, 18:30",
      "August 4, 2025, 6:30 PM",
    ],
    [
      "end_at",
      "2025-08-04 00:05:00",
      "4 août 2025, 00:05",
      "August 4, 2025, 12:05 AM",
    ],
    ["month", 8, "août", "August"],
    ["start_month", 1, "janvier", "January"],
    ["month", "2025-08", "août 2025", "August 2025"],
    ["start_month_key", "2026-03", "mars 2026", "March 2026"],
    ["weekday", 1, "lundi", "Monday"],
    ["start_weekday", 7, "dimanche", "Sunday"],
    ["hour", 18, "18 h", "6 PM"],
    ["start_hour", 7, "7 h", "7 AM"],
    ["season", 2025, "2025-2026", "2025-2026"],
    ["cohort", 2023, "2023-2024", "2023-2024"],
    ["gender", "female", "Femme", "Female"],
    ["rower_status", "guest", "Invité", "Guest"],
    ["issue", "late_return", "Retour en retard", "Late return"],
    ["severity", "unusable", "Inutilisable", "Unusable"],
    ["gender", "unknown", "Non renseigné", "Not specified"],
    ["outing_type_code", "training", "Entraînement", "Training"],
    ["boat_class", "4x+", "4x+", "4x+"],
    ["boat_class", "unknown", "Non renseigné", "Not specified"],
    ["outing_type_code", "aviron_sante", "aviron_sante", "aviron_sante"],
    ["age_category", "J16", "J16", "J16"],
    ["is_coached", 1, "oui", "yes"],
    ["has_start_time", 0, "non", "no"],
    ["outings", 1234, "1 234", "1,234"],
    ["avg_per_week", 3.14159, "3,14", "3.14"],
    ["boat_name", "Aiguillon", "Aiguillon", "Aiguillon"],
    ["anything", null, "—", "—"],
  ] as const)("%s = %s", (column, value, fr, en) => {
    expect(fmt("fr-FR", column, value)).toBe(fr);
    expect(fmt("en-US", column, value)).toBe(en);
  });

  it("never shifts local dates", () => {
    for (const text of [
      "2025-01-01",
      "2025-03-30",
      "2025-10-26",
      "2025-12-31",
    ]) {
      const date = parseLocalDate(text);
      expect(date).not.toBeNull();
      if (!date) continue;
      expect(fromDayNumber(dayNumber(date))).toEqual(date);
    }
    // 2025-03-30 is a Sunday (DST change in Europe).
    expect(isoWeekday({ year: 2025, month: 3, day: 30 })).toBe(7);
    expect(fmt("fr-FR", "day", "2025-03-30")).toBe("30 mars 2025");
  });
});

describe("season labels", () => {
  it("shows one year when the season starts in January", () => {
    expect(fmt("fr-FR", "season", 2025, { seasonStartMonth: 1 })).toBe("2025");
    expect(fmt("fr-FR", "season", 2025, { seasonStartMonth: 8 })).toBe(
      "2025-2026"
    );
    expect(fmt("en-US", "current_season", 2024, { seasonStartMonth: 9 })).toBe(
      "2024-2025"
    );
  });
});

describe("code columns", () => {
  it("translates `category` with the group of the dimension parameter", () => {
    expect(
      fmt("fr-FR", "category", "female", { params: { dimension: "gender" } })
    ).toBe("Femme");
    expect(
      fmt("fr-FR", "category", "competitor", {
        params: { dimension: "seriousness" },
      })
    ).toBe("Compétiteur");
    expect(
      fmt("fr-FR", "category", "J14", { params: { dimension: "age_category" } })
    ).toBe("J14");
    expect(
      fmt("fr-FR", "category", "4x+", { params: { dimension: "boat_class" } })
    ).toBe("4x+");
    expect(
      fmt("en-US", "category", "regatta", {
        params: { dimension: "outing_type" },
      })
    ).toBe("Regatta");
    expect(fmt("fr-FR", "category", "unknown")).toBe("Non renseigné");
  });

  it("uses an explicit format before the name rules", () => {
    const value = formatValue("value", 12.5, {
      locale: "fr-FR",
      seasonStartMonth: 8,
      format: "km",
      t: i18n.getFixedT("fr-FR"),
    });
    expect(n(value)).toBe("12,5 km");
    expect(
      formatValue("x", 3, {
        locale: "fr-FR",
        seasonStartMonth: 8,
        format: "weekday",
        t: i18n.getFixedT("fr-FR"),
      })
    ).toBe("mercredi");
  });

  it("gives short labels for axes", () => {
    expect(
      formatValue("month", 9, {
        locale: "fr-FR",
        seasonStartMonth: 8,
        compact: true,
        t: i18n.getFixedT("fr-FR"),
      })
    ).toBe("sept.");
    expect(
      formatValue("week_start", "2025-08-04", {
        locale: "en-US",
        seasonStartMonth: 8,
        compact: true,
        t: i18n.getFixedT("en-US"),
      })
    ).toBe("Aug 4");
  });
});

describe("inferFormat", () => {
  it("follows the name rules, then the values", () => {
    expect(inferFormat("km_total", [12])).toBe("km");
    expect(inferFormat("month", [8, 9])).toBe("month");
    expect(inferFormat("outings", [1, 2])).toBe("integer");
    expect(inferFormat("ratio", [1.5])).toBe("decimal");
    expect(inferFormat("first_seen", ["2025-01-02"])).toBe("date");
    expect(inferFormat("label", ["a"])).toBeNull();
    expect(inferFormat("is_open", [1, 0])).toBeNull();
  });
});

describe("columnLabel", () => {
  const t = i18n.getFixedT("fr-FR");
  it("prefers literal labels, then label keys with parameters", () => {
    expect(columnLabel("outings", t, { outings: "Mes sorties" })).toBe(
      "Mes sorties"
    );
    expect(
      columnLabel(
        "value",
        t,
        undefined,
        { value: "analytics.codes.measure.{measure}" },
        { measure: "km" }
      )
    ).toBe("Kilomètres");
    expect(
      columnLabel("value", t, undefined, {
        value: "analytics.reports.labels.missing",
      })
    ).toBe("Valeur");
    expect(columnLabel("outings", t)).toBe("Sorties");
    expect(columnLabel("my_col", t)).toBe("my_col");
  });
});
