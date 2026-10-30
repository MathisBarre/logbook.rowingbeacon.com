import { afterAll, beforeAll, describe, expect, it } from "vitest";
import reportsSql from "./reports.sql?raw";
import catalogJson from "./catalog.json";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import { FIXTURE_NOW, insertFixtureClub } from "./testing/fixtureClub";
import { runReport } from "./testing/runReport";
import {
  DEFAULT_DASHBOARD,
  getReport,
  getReports,
  getReportsByCategory,
  reportDescriptionKey,
  reportHowToReadKey,
  reportNoteKey,
  reportTitleKey,
  splitReportNotes,
} from "./catalog";
import { ANNUAL_REPORT_SECTIONS } from "./annual";
import { coverageMessageKey } from "./coverage";
import { parseBlocks } from "../schema/views";
import { checkSql } from "../engine/sqlGuard";
import { getDictionary } from "../schema/dictionary";
import {
  ANALYTICS_LOCALES,
  analyticsResources,
  AnalyticsStrings,
} from "../i18n";
import { MODULE_IDS } from "../../_common/business/modules.rules";
import type { ChartSpec } from "../chartSpec";
import { REPORT_CATEGORIES, type ReportDefinition } from "../types";

const reports = getReports();

/** `analytics.a.b.c` in one locale, or undefined. */
const lookup = (locale: (typeof ANALYTICS_LOCALES)[number], key: string) => {
  const [root, namespace, ...rest] = key.split(".");
  if (root !== "analytics") return undefined;
  let node: string | AnalyticsStrings | undefined =
    analyticsResources[locale][namespace];
  for (const part of rest) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
};

/** Every result column a chart spec refers to. */
const chartColumns = (spec: ChartSpec): string[] => {
  const columns: string[] = [];
  switch (spec.type) {
    case "table":
      columns.push(...(spec.columns ?? []));
      break;
    case "kpi":
      for (const item of spec.items) {
        columns.push(item.value, ...(item.compare ? [item.compare] : []));
      }
      break;
    case "bar":
    case "line":
    case "area":
      columns.push(spec.x, ...spec.y, ...(spec.series ? [spec.series] : []));
      break;
    case "pie":
      columns.push(spec.label, spec.value);
      break;
    case "heatmap":
      columns.push(spec.x, spec.y, spec.value);
      break;
    case "calendar":
      columns.push(spec.date, spec.value);
      break;
  }
  columns.push(
    ...Object.keys(spec.labels ?? {}),
    ...Object.keys(spec.labelKeys ?? {}),
    ...Object.keys(spec.formats ?? {})
  );
  return columns;
};

let testDb: AnalyticsTestDb;
const columnsById = new Map<string, string[]>();

beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
  await insertFixtureClub(testDb.db, { withDamages: true });
  const engine = testDb.engine();
  for (const report of reports) {
    const { result } = await runReport(
      engine,
      report.id,
      {},
      {
        now: FIXTURE_NOW,
      }
    );
    columnsById.set(
      report.id,
      result.columns.map((column) => column.name)
    );
  }
});
afterAll(async () => {
  await testDb.cleanup();
});

describe("report catalogue", () => {
  it("has the 29 reports of appendix C, with unique kebab-case ids", () => {
    const ids = reports.map((report) => report.id);
    expect(ids).toHaveLength(29);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("has exactly one SQL block per catalogue entry, in the same order", () => {
    const blocks = parseBlocks(reportsSql, "@report").map((b) => b.name);
    expect(blocks).toEqual(
      (catalogJson as { id: string }[]).map((entry) => entry.id)
    );
  });

  it("lists the reports grouped by category in the order of plan 1.3", () => {
    const groups = getReportsByCategory();
    expect(groups.map((group) => group.category)).toEqual([
      ...REPORT_CATEGORIES,
    ]);
    // Display order inside the catalogue follows the categories.
    expect(groups.flatMap((group) => group.reports)).toEqual(reports);
  });

  it("finds a report by id", () => {
    expect(getReport("km-challenge")?.category).toBe("people");
    expect(getReport("nope")).toBeUndefined();
  });

  describe.each(reports.map((report) => [report.id, report] as const))(
    "%s",
    (id, report: ReportDefinition) => {
      it("is one read-only statement whose parameters are all declared", () => {
        expect(report.sql.endsWith(";")).toBe(true);
        const checked = checkSql(report.sql);
        expect(checked.ok).toBe(true);
        if (!checked.ok) return;
        expect([...checked.paramNames].sort()).toEqual(
          report.params.map((param) => param.name).sort()
        );
      });

      it("has a chart that only uses result columns", () => {
        const columns = columnsById.get(id) ?? [];
        expect(columns.length).toBeGreaterThan(0);
        expect(new Set(columns).size, "duplicate column names").toBe(
          columns.length
        );
        for (const column of chartColumns(report.chart)) {
          expect(columns, `${id} chart column ${column}`).toContain(column);
        }
      });

      it("describes itself in English for Claude, with its columns", () => {
        const columns = columnsById.get(id) ?? [];
        expect(report.mcpDescription.length).toBeLessThanOrEqual(300);
        expect(report.mcpDescription).not.toMatch(/[àâçéèêëîïôûùüÿœ«»]/i);
        expect(report.mcpDescription).toContain(
          ` Columns: ${columns.join(", ")}.`
        );
        expect(report.mcpDescription.endsWith(" Shows names.")).toBe(
          report.visibility === "nominative"
        );
      });

      it("never shows names in a public report", () => {
        if (/display_name/.test(report.sql)) {
          expect(report.visibility).not.toBe("public");
        }
      });

      it("has its title, description and reading guide in every locale", () => {
        for (const locale of ANALYTICS_LOCALES) {
          for (const key of [
            reportTitleKey(id),
            reportDescriptionKey(id),
            reportHowToReadKey(id),
          ]) {
            expect(
              lookup(locale, key)?.trim(),
              `${locale} ${key}`
            ).toBeTruthy();
          }
        }
      });

      it("has labels for its parameters, choices, notes and coverage", () => {
        for (const param of report.params) {
          const labelKey = param.labelKey ?? `analytics.params.${param.name}`;
          expect(lookup("fr-FR", labelKey), labelKey).toBeTruthy();
          if (param.type === "choice" && param.name !== "age_category") {
            for (const option of param.options ?? []) {
              const key = `analytics.codes.${param.name}.${option.value}`;
              expect(lookup("fr-FR", key), key).toBeTruthy();
            }
          }
          if (!param.required) {
            expect(param.default).toBeNull();
          }
        }
        for (const note of report.notes ?? []) {
          expect(lookup("fr-FR", reportNoteKey(note)), note).toBeTruthy();
        }
        const coverageKey = coverageMessageKey(report);
        if (coverageKey) {
          expect(lookup("fr-FR", coverageKey), coverageKey).toBeTruthy();
        }
        const spec = report.chart;
        for (const key of Object.values(spec.labelKeys ?? {})) {
          const placeholder = /\{([a-z_]+)\}/.exec(key);
          const values = placeholder
            ? (report.params
                .find((param) => param.name === placeholder[1])
                ?.options?.map((option) => option.value) ?? [])
            : [""];
          expect(values.length).toBeGreaterThan(0);
          for (const value of values) {
            const resolved = placeholder
              ? key.replace(placeholder[0], value)
              : key;
            expect(lookup("fr-FR", resolved), resolved).toBeTruthy();
          }
        }
      });

      it("requires tables of the dictionary and known modules", () => {
        const tables = new Set(
          getDictionary()
            .objects.filter((object) => object.kind === "table")
            .map((object) => object.name)
        );
        for (const table of report.requires.tables) {
          expect(tables.has(table), table).toBe(true);
        }
        for (const module of report.requires.modules ?? []) {
          expect(MODULE_IDS as readonly string[], module).toContain(module);
        }
      });

      it("shows the multi-day and kilometer notes when it shows hours or km", () => {
        const columns = columnsById.get(id) ?? [];
        const options = report.params.flatMap(
          (param) => param.options?.map((option) => option.value) ?? []
        );
        const notes = report.notes ?? [];
        expect(notes.includes("multiDay")).toBe(
          columns.some((column) => column.startsWith("hours")) ||
            options.includes("hours")
        );
        expect(notes.includes("km")).toBe(
          columns.some((column) => /(^km$|^km_|_km$)/.test(column)) ||
            options.includes("km")
        );
        const { footnotes, details } = splitReportNotes(report);
        expect([...footnotes, ...details].sort()).toEqual([...notes].sort());
      });
    }
  );

  it("puts no heavy or restricted report on the default dashboard", () => {
    for (const item of DEFAULT_DASHBOARD) {
      const report = getReport(item.reportId);
      expect(report, item.reportId).toBeDefined();
      expect(report?.cost).not.toBe("heavy");
      expect(report?.visibility).toBe("public");
      for (const [name, value] of Object.entries(item.paramValues)) {
        const param = report?.params.find((p) => p.name === name);
        expect(param, name).toBeDefined();
        expect(param?.options?.map((o) => o.value)).toContain(value);
      }
    }
  });

  it("builds the annual report from public reports only", () => {
    expect(ANNUAL_REPORT_SECTIONS.map((section) => section.reportId)).toEqual([
      "season-overview",
      "yoy-monthly",
      "yoy-monthly",
      "active-members-demographics",
      "fleet-by-class",
      "boat-usage-ranking",
      "routes-usage",
      "outing-types",
      "incidents-per-boat",
      "damages-per-boat",
      "retention-cohorts",
      "safety-summary",
    ]);
    for (const section of ANNUAL_REPORT_SECTIONS) {
      const report = getReport(section.reportId);
      expect(report?.visibility, section.reportId).toBe("public");
      for (const [name, value] of Object.entries(section.params ?? {})) {
        const param = report?.params.find((p) => p.name === name);
        expect(
          param?.options?.map((o) => o.value),
          name
        ).toContain(value);
      }
      expect(section.titleKey).toMatch(/^analytics\.annual\.sections\.\w+$/);
    }
  });
});
