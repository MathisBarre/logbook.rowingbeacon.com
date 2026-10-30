import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../_common/i18n/config";
import { getReport } from "../reports/catalog";
import { analyticsResources, AnalyticsStrings } from "../i18n";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import type { QueryResult, ReportDefinition, SqlValue } from "../types";
import {
  dataHints,
  dropEmptyPrevious,
  pageResult,
  pivotDemographics,
  relevantNotes,
  reportPageChart,
  retentionAfterArrival,
  scopeLine,
  splitDescription,
} from "./reportDisplay";
import {
  openReportFrom,
  showReportsCatalog,
  useReportsSession,
} from "./reportsSession.store";

beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});

const t = i18n.t.bind(i18n);
const NNBSP = " ";

const report = (id: string): ReportDefinition => {
  const found = getReport(id);
  if (!found) throw new Error(`Missing report ${id}`);
  return found;
};

const result = (columns: string[], rows: SqlValue[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, declType: null })),
  rows,
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
});

const ctx = {
  t,
  locale: "fr-FR",
  season: 2025,
  seasonStartMonth: 9,
  now: "2026-06-20T09:47",
};

describe("report page charts", () => {
  it("answers the fleet question with the saturation table", () => {
    const spec = reportPageChart(report("fleet-by-class"));
    expect(spec.type).toBe("table");
    // The dashboard and the annual report keep the bars.
    expect(report("fleet-by-class").chart.type).toBe("bar");
  });

  it("pivots the demographics into the grant form's table", () => {
    const raw = result(
      ["age_group", "gender", "active_rowers", "outings", "km"],
      [
        ["adult", "female", 10, 50, 300],
        ["adult", "male", 12, 60, 400],
        ["adult", "unknown", 1, 2, 5],
        ["youth", "female", 4, 20, 50],
        ["youth", "male", 3, 10, 20],
      ]
    );
    const pivot = pivotDemographics(raw, t);
    expect(pivot.columns.map((c) => c.name)).toEqual([
      "age_group",
      "female",
      "male",
      "unknown_gender",
      "total",
    ]);
    expect(pivot.rows).toEqual([
      ["youth", 4, 3, 0, 7],
      ["adult", 10, 12, 1, 23],
      ["Total", 14, 15, 1, 30],
    ]);
    const spec = reportPageChart(report("active-members-demographics"));
    // Only the page's own chart gets the pivot.
    expect(
      pageResult(report("active-members-demographics"), spec, raw, t).rows
    ).toEqual(pivot.rows);
    expect(
      pageResult(
        report("active-members-demographics"),
        report("active-members-demographics").chart,
        raw,
        t
      )
    ).toBe(raw);
  });

  it("leaves the arrival season out of the retention", () => {
    const shown = retentionAfterArrival(
      result(
        ["cohort", "seasons_after", "retention_pct"],
        [
          [2023, 0, 100],
          [2023, 1, 60],
          [2023, 2, 40],
          [2024, 0, 100],
          [2024, 1, 55],
        ]
      )
    );
    expect(shown.rows).toEqual([
      [2023, 1, 60],
      [2023, 2, 40],
      [2024, 1, 55],
    ]);
  });
});

describe("season names", () => {
  const yoy = report("yoy-monthly");
  it("keeps both seasons when the previous one has data", () => {
    const spec = dropEmptyPrevious(
      yoy,
      yoy.chart,
      result(["month", "value", "value_prev"], [[9, 3, 2]])
    );
    expect(spec).toBe(yoy.chart);
    expect(spec.type === "bar" && spec.y).toEqual(["value", "value_prev"]);
  });

  it("drops a previous season without data, and says so", () => {
    const empty = result(["month", "value", "value_prev"], [[9, 3, null]]);
    const spec = dropEmptyPrevious(yoy, yoy.chart, empty);
    expect(spec.type === "bar" && spec.y).toEqual(["value"]);
    expect(dataHints(yoy, empty, ctx).join(" ")).toContain(
      "Aucune donnée pour la saison 2024-2025"
    );
  });

  it("notes the month in progress", () => {
    const hints = dataHints(
      yoy,
      result(["month", "value", "value_prev"], [[6, 3, 2]]),
      ctx
    );
    expect(hints[0]).toContain(`Juin${NNBSP}: mois en cours`);
    expect(hints[0]).toContain("20 juin 2026");
    expect(
      dataHints(yoy, result(["month", "value", "value_prev"], [[6, 3, 2]]), {
        ...ctx,
        season: 2024,
      })
    ).toEqual([]);
  });
});

describe("scope line", () => {
  it("tells the season, running or fixed", () => {
    expect(
      scopeLine(report("guests"), {}, { ...ctx, fixedSeason: false })
    ).toBe("Saison 2025-2026 · en cours, données jusqu'au 20 juin 2026");
    expect(
      scopeLine(
        report("guests"),
        {},
        { ...ctx, season: 2023, fixedSeason: true }
      )
    ).toBe("Saison 2023-2024 · fixée sur la carte du tableau de bord");
  });

  it("tells when the season does not apply", () => {
    expect(
      scopeLine(
        report("underused-boats"),
        { days: 365 },
        { ...ctx, fixedSeason: false }
      )
    ).toBe("Sur les 365 derniers jours · la saison choisie ne s'applique pas");
    expect(
      scopeLine(report("retention-cohorts"), {}, { ...ctx, fixedSeason: false })
    ).toBe("Tout l'historique du club · la saison choisie ne s'applique pas");
  });
});

describe("texts around the chart", () => {
  it("keeps the footnotes about what is shown", () => {
    const shown = result(["age_group", "female", "total"], []);
    expect(
      relevantNotes(["km", "membersOnly"], shown, { type: "table" }, {})
    ).toEqual(["membersOnly"]);
    expect(
      relevantNotes(
        ["km", "multiDay"],
        result(["month", "value"], []),
        { type: "table" },
        { metric: "km" }
      )
    ).toEqual(["km"]);
  });

  it("splits a description into its question and the rest", () => {
    expect(splitDescription("Qui rame ? Sorties et km.")).toEqual({
      question: "Qui rame ?",
      rest: "Sorties et km.",
    });
    expect(splitDescription("Pas de question. Suite.")).toEqual({
      question: "Pas de question.",
      rest: "Suite.",
    });
  });
});

describe("reports session", () => {
  beforeEach(() => {
    showReportsCatalog();
    useReportsSession.setState({ pendingOrigin: null, customCharts: {} });
  });

  it("keeps the open report, its values and its origin", () => {
    const session = useReportsSession.getState();
    session.openReport({ reportId: "guests" });
    useReportsSession.getState().updateOpenReport({ values: { a: 1 } });
    expect(useReportsSession.getState().open).toMatchObject({
      reportId: "guests",
      values: { a: 1 },
      origin: "catalog",
    });
    expect(useReportsSession.getState().lastOpenedId).toBe("guests");
    showReportsCatalog();
    expect(useReportsSession.getState().open).toBeNull();
  });

  it("remembers that a report came from the dashboard", () => {
    openReportFrom("dashboard", "guests", {}, 2024);
    expect(useAnalyticsHubStore.getState().pendingReport).toMatchObject({
      reportId: "guests",
      season: 2024,
    });
    expect(useReportsSession.getState().takePendingOrigin()).toBe("dashboard");
    expect(useReportsSession.getState().takePendingOrigin()).toBeNull();
    useAnalyticsHubStore.getState().takePendingReport();
  });

  it("keeps a customised chart per report", () => {
    const { setCustomChart } = useReportsSession.getState();
    setCustomChart("guests", { type: "table" });
    expect(useReportsSession.getState().customCharts.guests).toEqual({
      type: "table",
    });
    setCustomChart("guests", null);
    expect(useReportsSession.getState().customCharts.guests).toBeUndefined();
  });
});

describe("French typography", () => {
  const flatten = (strings: AnalyticsStrings): string[] =>
    Object.values(strings).flatMap((value) =>
      typeof value === "string" ? [value] : flatten(value)
    );
  it.each(["reports", "params"])(
    "%s keeps ? ! ; : » % with their word, « with its word",
    (namespace) => {
      for (const text of flatten(analyticsResources["fr-FR"][namespace])) {
        expect(text, text).not.toMatch(/ [?!;»%]/);
        expect(text, text).not.toMatch(/ :(?![A-Za-z_])/);
        expect(text, text).not.toMatch(/« /);
      }
    }
  );
});
