import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../_common/i18n/config";
import { ChartSpec } from "./chartSpec";
import type { AiDraft, ParamValue, QueryResult } from "./types";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "./testing/analyticsTestDb";
import { seedAnalyticsClub } from "./reports/testing/seedAnalyticsClub";
import { runReport } from "./reports/testing/runReport";
import { getReport, getReports } from "./reports/catalog";
import { resolveParams } from "./params/resolveParams";
import { ChartView } from "./charts/ChartView";
import { convertSpec } from "./charts/ChartBuilder";
import { fittingChartTypes } from "./charts/chartFits";
import { buildCsv } from "./charts/export/csv";
import { ResultBody } from "./reportsUi/ResultBody";
import { useAnalyticsHubStore } from "./store/analyticsHub.store";
import {
  resetExplorerStoreForTests,
  useExplorerStore,
} from "./explorer/explorer.store";
import { QueryDb, saveDoc } from "./explorer/queryActions";
import {
  getQuery,
  listDashboardItems,
  saveDashboardItem,
} from "./repository/analytics.repository";
import { createAiAssistantController } from "./ai/useAiAssistant";
import type { AiAskResponse } from "./engine/ipc";
import answerBar from "./ai/fixtures/answer-bar.json";
import answerKpi from "./ai/fixtures/answer-kpi.json";
import answerYouth from "./ai/fixtures/answer-youth.json";

/**
 * End-to-end checks across the work packages, with the real pieces in
 * place of the stubs each package was built against: the 29 reports
 * (WP3) on a seeded club through the node engine, drawn by the chart kit
 * (WP4) inside the report body (WP5); a report opened in the Explorer
 * (WP5 → WP6); an AI answer (WP7) run, previewed, saved and pinned.
 */

const NOW = "2026-06-20T09:47";
const CTX = { now: NOW, seasonStartMonth: 8 };
const MISMATCH = "Le graphique ne correspond plus aux colonnes";

let testDb: AnalyticsTestDb;
let counter = 0;

const run = (sql: string, params: Record<string, ParamValue>) => {
  counter += 1;
  return testDb.engine().run({
    requestId: `00000000-0000-4000-a000-${String(counter).padStart(12, "0")}`,
    sql,
    params,
    maxRows: 5000,
    timeoutMs: 20_000,
    privacy: "nominative",
    now: NOW,
    useCache: false,
  });
};

const queryDb = (): QueryDb => ({
  read: (read) => read(testDb.db),
  write: async (_label, write) => {
    await write(testDb.db);
    return true;
  },
});

const draw = (
  spec: ChartSpec,
  result: QueryResult,
  params: Record<string, ParamValue>,
  mode: "chart" | "table" = "chart"
) =>
  renderToStaticMarkup(
    <ChartView spec={spec} result={result} params={params} mode={mode} />
  );

const DRAWN = new Set(["bar", "line", "area", "pie", "heatmap", "calendar"]);

beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
  seedAnalyticsClub(testDb.path, { outingsPerDay: 2, now: NOW });
  await i18n.changeLanguage("fr-FR");
}, 60_000);
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(() => {
  resetExplorerStoreForTests();
});

describe("reports drawn by the chart kit", () => {
  it.each(getReports().map((report) => report.id))(
    "%s: its chart fits its real result, in every type the builder offers",
    async (id) => {
      const report = getReport(id);
      if (!report) throw new Error(id);
      const values = resolveParams(report.params, {}, CTX).values;
      const { result } = await runReport(testDb.engine(), id, {}, CTX);

      // The report page: the catalogue chart inside the result body.
      const body = renderToStaticMarkup(
        <ResultBody
          query={{
            status: "success",
            result,
            error: null,
            isSlow: false,
            cancel: () => undefined,
            rerun: () => undefined,
          }}
          spec={report.chart}
          params={values}
          mode="chart"
        />
      );
      expect(body).not.toContain(MISMATCH);
      if (DRAWN.has(report.chart.type) && result.rows.length > 1) {
        expect(body).toContain("data-chart-root");
      }
      if (result.rows.length > 0) {
        expect(draw(report.chart, result, values, "table")).toContain("<table");
      }

      // "Personnaliser": every type offered converts to a valid spec that
      // still fits the result.
      for (const type of fittingChartTypes(result.columns, result.rows)) {
        const converted = ChartSpec.parse(
          convertSpec(report.chart, type, result)
        );
        expect(converted.type).toBe(type);
        expect(
          draw(converted, result, values),
          `${id} → ${type}`
        ).not.toContain(MISMATCH);
      }

      // Exports read the same result.
      const csv = buildCsv(
        { result, spec: report.chart, params: values },
        { t: i18n.t.bind(i18n), locale: "fr-FR", seasonStartMonth: 8 }
      );
      expect(csv.split("\r\n")).toHaveLength(result.rows.length + 2);
      expect(csv).not.toContain("analytics.");
    }
  );
});

describe("a report opened in the Explorer (Voir la requête SQL)", () => {
  it.each(["yoy-monthly", "boat-usage-ranking", "underused-boats"])(
    "%s gives the same rows from the editor",
    async (id) => {
      const report = getReport(id);
      if (!report) throw new Error(id);
      const values = resolveParams(report.params, {}, CTX).values;
      const fromReport = await runReport(testDb.engine(), id, {}, CTX);

      // What ReportView hands over, through the hub store.
      useAnalyticsHubStore.getState().openInExplorer({
        title: "Rapport",
        sql: report.sql,
        params: report.params,
        chart: report.chart,
        basedOnReportId: report.id,
        paramValues: values,
      });
      expect(useAnalyticsHubStore.getState().tab).toBe("explorer");
      const draft = useAnalyticsHubStore.getState().takePendingDraft();
      expect(draft).not.toBeNull();
      if (!draft) return;
      useExplorerStore.getState().openDraft(draft);

      const { doc, paramValues } = useExplorerStore.getState();
      expect(doc).toMatchObject({
        origin: "report",
        basedOnReportId: id,
        sql: report.sql,
      });
      expect(doc.params.map((p) => p.name).sort()).toEqual(
        report.params.map((p) => p.name).sort()
      );
      const resolved = resolveParams(doc.params, paramValues, CTX);
      expect(resolved.errors).toEqual([]);
      const fromEditor = await run(doc.sql, resolved.values);
      expect(fromEditor.columns).toEqual(fromReport.result.columns);
      expect(fromEditor.rows).toEqual(fromReport.result.rows);
      expect(draw(doc.chart ?? report.chart, fromEditor, values)).not.toContain(
        MISMATCH
      );
    }
  );
});

const reply = (body: unknown): AiAskResponse => ({
  text: JSON.stringify(body),
  stopReason: "end_turn",
  model: "claude-opus-5-5",
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
});

describe("an AI answer: run, preview, save, pin, open", () => {
  it.each([
    ["answer-bar", answerBar],
    ["answer-kpi", answerKpi],
    ["answer-youth", answerYouth],
  ] as const)("%s", async (_name, fixture) => {
    const drafts: AiDraft[] = [];
    const results: QueryResult[] = [];
    const controller = createAiAssistantController({
      buildSystem: () => Promise.resolve("SYSTEM"),
      ask: () => Promise.resolve(reply(fixture)),
      run: async (sql, values) => {
        const result = await run(sql, values);
        results.push(result);
        return result;
      },
      getTarget: () => ({ provider: "anthropic", model: "claude-opus-5-5" }),
      getParamContext: () => CTX,
      onAnswer: (draft) => {
        drafts.push(draft);
        useExplorerStore.getState().openAiDraft(draft);
      },
    });
    await controller.ask("Une question du club");
    expect(controller.getState().status).toBe("answer");
    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    const result = results[results.length - 1];
    expect(result.rows.length).toBeGreaterThan(0);

    // The preview of the answer card.
    expect(draw(draft.chart, result, {})).not.toContain(MISMATCH);

    // "Enregistrer" in the Explorer, with nothing saved before.
    const { doc } = useExplorerStore.getState();
    expect(doc).toMatchObject({ origin: "ai", sql: draft.sql });
    const saved = await saveDoc(
      doc,
      { title: draft.title, description: null, asNew: true },
      queryDb()
    );
    expect(saved).not.toBeNull();
    if (!saved) return;
    const stored = await getQuery(testDb.db, saved.id);
    expect(stored).toMatchObject({
      origin: "ai",
      status: "saved",
      sql: draft.sql,
      chart: draft.chart,
    });

    // "Épingler" then the card: the stored chart still fits.
    const itemId = await saveDashboardItem(testDb.db, {
      source: { kind: "query", queryId: saved.id },
      size: "half",
      paramValues: {},
      chartOverride: null,
    });
    const items = await listDashboardItems(testDb.db);
    expect(items.find((item) => item.id === itemId)?.source).toEqual({
      kind: "query",
      queryId: saved.id,
    });
    const values = resolveParams(stored?.params ?? [], {}, CTX).values;
    const again = await run(stored?.sql ?? "", values);
    expect(draw(stored?.chart ?? draft.chart, again, values)).not.toContain(
      MISMATCH
    );

    // "Ouvrir" on that card names the saved query (types.ts queryId).
    useAnalyticsHubStore.getState().openInExplorer({
      queryId: saved.id,
      title: saved.title,
      sql: saved.sql,
      params: saved.params,
      chart: saved.chart,
      paramValues: {},
    });
    expect(useAnalyticsHubStore.getState().takePendingDraft()?.queryId).toBe(
      saved.id
    );
  });
});
