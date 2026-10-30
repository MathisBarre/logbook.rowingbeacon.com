import { afterEach, describe, expect, it, vi } from "vitest";
import { readTab, useAnalyticsHubStore } from "./analyticsHub.store";

afterEach(() => vi.unstubAllGlobals());

describe("analytics hub store", () => {
  it("starts on the dashboard without storage", () => {
    expect(useAnalyticsHubStore.getState().tab).toBe("dashboard");
  });

  it("hands a draft to the Explorer once", () => {
    const store = useAnalyticsHubStore.getState();
    store.openInExplorer({
      title: "Classement",
      sql: "SELECT 1",
      params: [],
      basedOnReportId: "boat-usage-ranking",
    });
    expect(useAnalyticsHubStore.getState().tab).toBe("explorer");
    expect(store.takePendingDraft()?.basedOnReportId).toBe(
      "boat-usage-ranking"
    );
    expect(store.takePendingDraft()).toBeNull();
  });

  it("hands a report to Rapports once", () => {
    const store = useAnalyticsHubStore.getState();
    store.openReport("season-overview", { season: 2024 });
    expect(useAnalyticsHubStore.getState().tab).toBe("reports");
    expect(store.takePendingReport()).toEqual({
      reportId: "season-overview",
      paramValues: { season: 2024 },
      season: null,
    });
    expect(store.takePendingReport()).toBeNull();
  });

  it("hands a question to the AI panel once, without sending it", () => {
    const store = useAnalyticsHubStore.getState();
    store.setTab("reports");
    store.askAi("  sorties du mardi soir  ");
    expect(useAnalyticsHubStore.getState().tab).toBe("explorer");
    expect(store.takePendingAiQuestion()).toBe("sorties du mardi soir");
    expect(store.takePendingAiQuestion()).toBeNull();
    // An empty search still opens the assistant (empty box).
    store.askAi("");
    expect(store.takePendingAiQuestion()).toBe("");
    // Leaving the hub forgets a question nobody took.
    store.askAi("km par rameur");
    store.leaveHub();
    expect(store.takePendingAiQuestion()).toBeNull();
  });

  it("hands over the season fixed on a card without changing the hub's", () => {
    const store = useAnalyticsHubStore.getState();
    store.setSeason(null);
    store.openReport("yoy-monthly", { metric: "km" }, 2023);
    expect(store.takePendingReport()?.season).toBe(2023);
    expect(useAnalyticsHubStore.getState().season).toBeNull();
  });

  it("never brings the next member back to the locked Explorer", () => {
    const stored = (value: string) =>
      vi.stubGlobal("window", {
        localStorage: { getItem: () => value, setItem: () => undefined },
      });
    stored("explorer");
    expect(readTab()).toBe("dashboard");
    stored("annual");
    expect(readTab()).toBe("annual");
    stored("nonsense");
    expect(readTab()).toBe("dashboard");

    const store = useAnalyticsHubStore.getState();
    store.setTab("explorer");
    store.leaveHub();
    expect(useAnalyticsHubStore.getState().tab).toBe("dashboard");
    store.setTab("reports");
    store.leaveHub();
    expect(useAnalyticsHubStore.getState().tab).toBe("dashboard");
  });
});
