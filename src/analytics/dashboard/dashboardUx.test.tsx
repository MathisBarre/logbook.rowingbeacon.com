import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { useAdminLockStore } from "../access/useAnalyticsAdmin";
import { tabForKey } from "../AnalyticsHub";
import type { ChartSpec } from "../chartSpec";
import { joinList, NoOutingsState } from "../components/AnalyticsStates";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { DashboardCard, effectiveSize } from "./DashboardCard";
import { DASHBOARD_SIZES, isAlreadyPinned, sizeOptions } from "./PinDialog";

/** The dashboard UX review fixes (findings 4, 8, 11, 18, 26, 28, 34). */

beforeEach(async () => {
  useAdminLockStore.getState().lock();
  useAnalyticsSettingsStore.getState().reset();
  await i18n.changeLanguage("fr-FR");
});

const horizontal: ChartSpec = {
  type: "bar",
  x: "boat_name",
  y: ["outings"],
  orientation: "horizontal",
  stacked: false,
  sort: "desc",
  limit: 25,
};

describe("dashboard cards", () => {
  it("never draws key figures at a third", () => {
    const kpi = {
      type: "kpi",
      items: [{ value: "outings" }],
    } as unknown as ChartSpec;
    expect(sizeOptions(kpi)).toEqual(["half", "full"]);
    expect(sizeOptions(horizontal)).toEqual(DASHBOARD_SIZES);
    expect(effectiveSize("third", kpi)).toBe("half");
    expect(effectiveSize("third", horizontal)).toBe("third");
  });

  it("shows a locked card as one compact line", () => {
    const html = renderToStaticMarkup(
      <DashboardCard
        entry={{
          item: {
            id: "item-1",
            dashboardId: "main",
            position: 0,
            source: { kind: "report", reportId: "outings-per-rower" },
            size: "half",
            paramValues: {},
            chartOverride: null,
            createdAt: "",
            updatedAt: "",
          },
          query: null,
        }}
        hubSeason={2025}
        editing={false}
        isFirst
        isLast
        actions={{ onMove: () => {}, onResize: () => {}, onRemove: () => {} }}
      />
    );
    expect(html).toContain("Réservé aux responsables");
    expect(html).toContain("Déverrouiller");
    expect(html).not.toContain("Voir le tableau");
    expect(html).not.toContain('aria-busy="true"');
  });
});

describe("pin dialog", () => {
  it("knows when the report or query is already on the dashboard", () => {
    const items = [
      { source: { kind: "report" as const, reportId: "boat-usage-ranking" } },
      { source: { kind: "query" as const, queryId: "q1" } },
    ];
    expect(
      isAlreadyPinned({ kind: "report", reportId: "boat-usage-ranking" }, items)
    ).toBe(true);
    expect(
      isAlreadyPinned({ kind: "report", reportId: "season-overview" }, items)
    ).toBe(false);
    expect(isAlreadyPinned({ kind: "query", queryId: "q1" }, items)).toBe(true);
    expect(
      isAlreadyPinned(
        {
          kind: "query",
          draft: { title: "x", sql: "SELECT 1", params: [], chart: null },
        },
        items
      )
    ).toBe(false);
  });
});

describe("hub", () => {
  it("moves between tabs with the arrows, Home and End, wrapping", () => {
    expect(tabForKey("dashboard", "ArrowRight")).toBe("reports");
    expect(tabForKey("explorer", "ArrowRight")).toBe("dashboard");
    expect(tabForKey("dashboard", "ArrowLeft")).toBe("explorer");
    expect(tabForKey("annual", "Home")).toBe("dashboard");
    expect(tabForKey("reports", "End")).toBe("explorer");
    expect(tabForKey("reports", "Enter")).toBeNull();
  });

  it("offers the efa2 import when the club has no outing", () => {
    const html = renderToStaticMarkup(<NoOutingsState />);
    expect(html).toContain("Importer un historique efa2");
  });

  it("joins hidden column names the French way", () => {
    expect(joinList(["a", "b", "c"], "fr-FR")).toBe("a, b et c");
    expect(joinList(["a"], "fr-FR")).toBe("a");
  });
});
