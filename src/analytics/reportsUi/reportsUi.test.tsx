import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { useModulesStore } from "../../_common/store/modules.store";
import { useAdminLockStore } from "../access/useAnalyticsAdmin";
import { setEngineForTests } from "../engine/engine";
import { resetQueueForTests, runQuery } from "../engine/queue";
import { createQueryController } from "../engine/useAnalyticsQuery";
import { getReport, getReports } from "../reports/catalog";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type { QueryResult, ReportDefinition, RunQueryRequest } from "../types";
import {
  foldText,
  matchesSearch,
  paramsSummary,
  partialSeasonEnd,
  previousDay,
  reportQuerySql,
} from "./reportHelpers";
import { ReportCatalog } from "./ReportCatalog";
import { ErrorState, LockedState } from "../components/AnalyticsStates";
import { AnalyticsError } from "../engine/errors";
import { ReportView } from "./ReportView";
import { UnavailableReport } from "./UnavailableReport";
import { availabilityOf } from "./useReportAvailability";
import {
  requestParametersPage,
  takeRequestedAnalyticsSection,
  takeRequestedParametersPage,
} from "./parametersRequest";

const calls: RunQueryRequest[] = [];
const emptyResult: QueryResult = {
  columns: [{ name: "n", declType: null }],
  rows: [[1]],
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
};

beforeEach(async () => {
  calls.length = 0;
  resetQueueForTests();
  setEngineForTests({
    run: (request) => {
      calls.push(request);
      return Promise.resolve(emptyResult);
    },
    cancel: () => Promise.resolve(),
    objects: () =>
      Promise.resolve({ views: [], tables: ["outing"], missingViews: [] }),
  });
  useAdminLockStore.getState().lock();
  useAnalyticsSettingsStore.getState().reset();
  useModulesStore.setState({ enabled: [] });
  await i18n.changeLanguage("fr-FR");
});
afterEach(() => setEngineForTests(null));

const report = (id: string): ReportDefinition => {
  const found = getReport(id);
  if (!found) throw new Error(`Missing report ${id}`);
  return found;
};

const t = i18n.t.bind(i18n);

describe("visibility", () => {
  const access = (isUnlocked: boolean, publicRankings = false) => ({
    isUnlocked,
    publicRankings,
    availability: { available: true },
    missingRequired: false,
  });

  it.each([
    ["outings-per-rower", false, false, false],
    ["outings-per-rower", false, true, true],
    ["outings-per-rower", true, false, true],
    ["inactive-rowers", false, true, false],
    ["inactive-rowers", true, false, true],
    ["season-overview", false, false, true],
  ] as const)(
    "%s (unlocked %s, public rankings %s) runs: %s",
    (id, unlocked, rankings, runs) => {
      const sql = reportQuerySql(report(id), access(unlocked, rankings));
      expect(sql === null).toBe(!runs);
    }
  );

  it("issues no query for a locked report", async () => {
    for (const id of [
      "outings-per-rower",
      "inactive-rowers",
      "safety-issues",
    ]) {
      const controller = createQueryController({
        run: (request, options) => runQuery(request, options),
      });
      controller.setInput({
        sql: reportQuerySql(report(id), access(false)),
        params: { season: 2025 },
      });
      expect(controller.getState().status).toBe("idle");
    }
    // A public report does run, through the same path.
    const controller = createQueryController({
      run: (request, options) => runQuery(request, options),
    });
    controller.setInput({
      sql: reportQuerySql(report("season-overview"), access(false)),
      params: { season: 2025 },
    });
    await vi.waitFor(() =>
      expect(controller.getState().status).toBe("success")
    );
    expect(calls).toHaveLength(1);
  });

  it("waits for the availability and the required parameters", () => {
    const base = access(true);
    expect(
      reportQuerySql(report("season-overview"), {
        ...base,
        availability: "pending",
      })
    ).toBeNull();
    expect(
      reportQuerySql(report("season-overview"), {
        ...base,
        availability: { available: false },
      })
    ).toBeNull();
    expect(
      reportQuerySql(report("season-overview"), {
        ...base,
        missingRequired: true,
      })
    ).toBeNull();
  });

  it("renders the lock card for a nominative report", () => {
    const html = renderToStaticMarkup(
      <ReportView report={report("outings-per-rower")} onBack={() => {}} />
    );
    expect(html).toContain("Réservé aux responsables");
    expect(html).toContain("Déverrouiller");
    expect(html).not.toContain("Voir la requête SQL");
    expect(calls).toHaveLength(0);
  });

  it("renders the toolbar of a public report", () => {
    const html = renderToStaticMarkup(
      <ReportView report={report("boat-usage-ranking")} onBack={() => {}} />
    );
    for (const text of [
      "Rapports",
      "Graphique",
      "Tableau",
      "Exporter",
      "Épingler au tableau de bord",
      "Personnaliser",
      "Plus d&#x27;actions",
      "Comment lire ce rapport",
    ]) {
      expect(html).toContain(text);
    }
    // The scope line.
    expect(html).toMatch(/Saison \d{4}-\d{4} · en cours/);
    // In the "⋯" menu, and not in the catalogue's style.
    expect(html).not.toContain("Voir la requête SQL");
    expect(html).not.toContain("Calcul long");
    // Export stays, disabled until a result is there.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Exporter/);
  });

  it("says why a nominative report is locked and how to open it", () => {
    const html = renderToStaticMarkup(
      <ReportView report={report("km-challenge")} onBack={() => {}} />
    );
    expect(html).toContain("Gestion › Statistiques");
    expect(html).toContain("Déverrouiller");
  });

  it("names the dashboard on the back button of a report opened from it", () => {
    const html = renderToStaticMarkup(
      <ReportView
        report={report("guests")}
        origin="dashboard"
        onBack={() => {}}
      />
    );
    expect(html).toContain("Tableau de bord");
  });
});

describe("availability", () => {
  it("checks modules at once and tables once the engine answered", () => {
    const km = report("km-challenge");
    expect(availabilityOf(km, undefined, [])).toEqual({
      available: false,
      reason: "module",
      module: "distances",
    });
    expect(availabilityOf(km, undefined, ["distances"])).toBe("pending");
    expect(
      availabilityOf(
        km,
        { views: [], tables: ["outing", "rower"], missingViews: [] },
        ["distances"]
      )
    ).toEqual({ available: true });
    // The engine could not list its objects: let the query say.
    expect(availabilityOf(report("damages-per-boat"), null, [])).toEqual({
      available: false,
      reason: "module",
      module: "damages",
    });
    expect(availabilityOf(report("incidents-per-boat"), null, [])).toEqual({
      available: true,
    });
  });

  it("offers to turn a known module on, and explains an unknown one", () => {
    const module = renderToStaticMarkup(
      <UnavailableReport
        availability={{
          available: false,
          reason: "module",
          module: "distances",
        }}
      />
    );
    expect(module).toContain("Nécessite le module « Distances »");
    expect(module).toContain("Activer le module Distances");
    // What the module adds, before turning it on.
    expect(module).toContain(i18n.t("modules.distances.adds"));
    const unknown = renderToStaticMarkup(
      <UnavailableReport
        availability={{ available: false, reason: "module", module: "weather" }}
      />
    );
    expect(unknown).toContain(
      "Ce rapport utilise des données que cette version de RowingBeacon n&#x27;enregistre pas encore."
    );
    expect(unknown).not.toContain("Activer");
  });

  it("hands a Gestion page and an analytics section over once", () => {
    requestParametersPage("modules");
    expect(takeRequestedParametersPage()).toBe("modules");
    expect(takeRequestedParametersPage()).toBeNull();
    expect(takeRequestedAnalyticsSection()).toBeNull();
    requestParametersPage("analytics", "mcp");
    expect(takeRequestedParametersPage()).toBe("analytics");
    expect(takeRequestedAnalyticsSection()).toBe("mcp");
    expect(takeRequestedAnalyticsSection()).toBeNull();
    // A section only goes with the analytics page.
    requestParametersPage("data");
    expect(takeRequestedParametersPage()).toBe("data");
    expect(takeRequestedAnalyticsSection()).toBeNull();
  });
});

describe("catalogue", () => {
  it("lists every report under its category, in the plan's order", () => {
    const html = renderToStaticMarkup(<ReportCatalog onOpen={() => {}} />);
    const positions = [
      "Vue d&#x27;ensemble",
      "Flotte",
      "Rameurs",
      "Fidélisation",
      "Fréquentation",
      "Sécurité et encadrement",
      "Matériel",
    ].map((title) => html.indexOf(`>${title}</h2>`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const r of getReports()) {
      expect(html).toContain(`data-report="${r.id}"`);
    }
    expect(html).toContain("Nominatif");
    expect(html).toContain("Responsables");
    expect(html).toContain("Calcul long");
    // Theme chips with their counts, and the AI next to the search.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Demander à l&#x27;IA");
    // Locked reports say so to a screen reader.
    expect(html).toContain("Mot de passe admin demandé pour l&#x27;ouvrir.");
  });

  it("shows only the question on a card", () => {
    const html = renderToStaticMarkup(<ReportCatalog onOpen={() => {}} />);
    expect(html).toContain(
      "Quels chiffres présenter en assemblée générale\u202f?"
    );
    expect(html).not.toContain("comparés à la même période");
  });

  it("filters on a theme and offers to see them all", () => {
    const html = renderToStaticMarkup(
      <ReportCatalog
        search="kilomètres"
        category="attendance"
        onOpen={() => {}}
      />
    );
    expect(html).toContain("Voir tous les thèmes");
    const all = renderToStaticMarkup(
      <ReportCatalog search="zzzz" onOpen={() => {}} />
    );
    expect(all).toContain("Posez la question à l&#x27;IA");
    expect(all).toContain("Effacer la recherche");
  });

  it("greys out reports whose module is off", () => {
    const html = renderToStaticMarkup(<ReportCatalog onOpen={() => {}} />);
    const start = html.indexOf('data-report="km-challenge"');
    const card = html.slice(start, html.indexOf("</li>", start));
    expect(card).toContain("data-unavailable");
    expect(card).toContain("Activer le module Distances");
  });

  it("searches titles and descriptions without accents", () => {
    expect(foldText("  Fréquentation ÉTÉ ")).toBe("frequentation ete");
    const ranking = report("boat-usage-ranking");
    expect(matchesSearch("", ranking, t)).toBe(true);
    expect(matchesSearch("bateaux", ranking, t)).toBe(true);
    expect(matchesSearch("BATEAUX classement", ranking, t)).toBe(true);
    expect(matchesSearch("parcours introuvable", ranking, t)).toBe(false);
    const safety = report("safety-summary");
    expect(matchesSearch("securite", safety, t)).toBe(true);
  });

  it("finds reports by the words volunteers use", () => {
    const found = (query: string) =>
      getReports()
        .filter((r) => matchesSearch(query, r, t))
        .map((r) => r.id);
    expect(found("km")).toContain("km-challenge");
    expect(found("km")).toContain("boat-km");
    expect(found("entretien")).toContain("boat-km");
    expect(found("fidélité")).toContain("retention-cohorts");
    expect(found("abandon")).toContain("new-rower-survival");
    expect(found("licenciés")).toEqual(["active-members-demographics"]);
    // "AG" is a whole word: the general meeting, not "âge".
    expect(found("AG")).toEqual(["season-overview"]);
  });
});

describe("helpers", () => {
  it("gives the day before a date, across months and years", () => {
    expect(previousDay("2026-06-21")).toBe("2026-06-20");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("bad")).toBeNull();
  });

  it("reads the partial-season end from a result", () => {
    const result = (partial: number): QueryResult => ({
      ...emptyResult,
      columns: [
        { name: "outings", declType: null },
        { name: "is_partial", declType: null },
        { name: "cutoff_date", declType: null },
      ],
      rows: [[12, partial, "2026-06-21"]],
    });
    expect(partialSeasonEnd(result(1))).toBe("2026-06-20");
    expect(partialSeasonEnd(result(0))).toBeNull();
    expect(partialSeasonEnd(emptyResult)).toBeNull();
    expect(partialSeasonEnd(null)).toBeNull();
  });

  it("sums up a card's parameters, season first", () => {
    const yoy = report("yoy-monthly");
    const text = paramsSummary(
      yoy.params,
      { season: 2025, metric: "outings" },
      { t, locale: "fr-FR", seasonStartMonth: 8 }
    );
    expect(text.startsWith("Saison 2025-2026")).toBe(true);
    expect(text).toContain(" · ");
  });
});

describe("catalogue state kept by the page", () => {
  it("shows the search the page kept while a report was open", () => {
    const html = renderToStaticMarkup(
      <ReportCatalog
        search="type de bateau"
        onSearchChange={() => {}}
        onOpen={() => {}}
      />
    );
    expect(html).toContain('value="type de bateau"');
    expect(html).toContain("Sorties par type de bateau et par mois");
    expect(html).not.toContain("Chiffres clés de la saison");
  });
});

describe("hub texts", () => {
  it("tells the Explorer padlock and a dashboard read error in French", () => {
    const locked = renderToStaticMarkup(
      <LockedState
        onUnlock={() => {}}
        hint={t("analytics.common.admin.lockedExplorerHint")}
      />
    );
    expect(locked).toContain(
      t("analytics.common.admin.lockedExplorerHint").replace(/'/g, "&#x27;")
    );
    expect(locked).not.toContain("pour voir ce rapport");
    const error = renderToStaticMarkup(
      <ErrorState
        error={
          new AnalyticsError({
            code: "internal",
            message: "the dashboard could not be read",
          })
        }
        message={t("analytics.dashboard.loadError")}
      />
    );
    expect(error).toContain("Impossible de lire le tableau de bord.");
    expect(error).not.toContain("could not be read");
  });
});
