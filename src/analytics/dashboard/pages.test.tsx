import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { useAdminLockStore } from "../access/useAnalyticsAdmin";
import { setEngineForTests } from "../engine/engine";
import { resetQueueForTests } from "../engine/queue";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import { AnnualReportPage } from "../annual/AnnualReportPage";
import { ReportsPage } from "../reportsUi/ReportsPage";
import type { DashboardItem, SavedQuery } from "../types";
import { canSeeReport } from "../access/canSee";
import { getReport } from "../reports/catalog";
import { reportQuerySql } from "../reportsUi/reportHelpers";
import { ReportView } from "../reportsUi/ReportView";
import { cardVisibility, DashboardCard } from "./DashboardCard";
import { AudienceNote, pinnedInfo } from "./PinDialog";
import { DashboardPage } from "./DashboardPage";
import { PinButton } from "./PinButton";

/** Static renders of the WP5 pages (no DOM: effects do not run). */

beforeEach(async () => {
  resetQueueForTests();
  setEngineForTests({
    run: () => new Promise(() => undefined),
    cancel: () => Promise.resolve(),
    objects: () => Promise.resolve({ views: [], tables: [], missingViews: [] }),
  });
  useAdminLockStore.getState().lock();
  useAnalyticsSettingsStore.getState().reset();
  await i18n.changeLanguage("fr-FR");
});
afterEach(() => setEngineForTests(null));

const item = (
  source: DashboardItem["source"],
  paramValues: DashboardItem["paramValues"] = {}
): DashboardItem => ({
  id: "item-1",
  dashboardId: "main",
  position: 0,
  source,
  size: "half",
  paramValues,
  chartOverride: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const actions = { onMove: () => {}, onResize: () => {}, onRemove: () => {} };

describe("WP5 pages", () => {
  it("renders the dashboard skeleton while it loads", () => {
    const html = renderToStaticMarkup(<DashboardPage />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("À venir");
  });

  it("renders a dashboard card with its title and quiet footer", () => {
    const html = renderToStaticMarkup(
      <DashboardCard
        entry={{
          item: item(
            { kind: "report", reportId: "yoy-monthly" },
            { metric: "km" }
          ),
          query: null,
        }}
        hubSeason={2025}
        editing={false}
        isFirst
        isLast
        actions={actions}
      />
    );
    // The season follows the hub: said once at the top, not on the card.
    expect(html).not.toContain("Saison 2025-2026");
    expect(html).not.toContain("Toujours la saison");
    expect(html).toContain("Afficher : Kilomètres");
    expect(html).toContain("Voir le tableau");
    expect(html).toContain("Ouvrir le rapport");
    expect(html).not.toContain("Placer avant");
    expect(html).not.toContain("Plus d&#x27;actions");
    // A named region: the article is labelled by its title.
    expect(html).toMatch(/<article aria-labelledby="([^"]+)"[^]*<h2 id="\1"/);
  });

  it("shows a season pinned on the card as a chip", () => {
    const html = renderToStaticMarkup(
      <DashboardCard
        entry={{
          item: item(
            { kind: "report", reportId: "yoy-monthly" },
            { season: 2023 }
          ),
          query: null,
        }}
        hubSeason={2025}
        editing={false}
        isFirst
        isLast
        actions={actions}
      />
    );
    expect(html).toContain("Toujours la saison 2023-2024");
  });

  it("shows the edit controls and disables moves at the ends", () => {
    const html = renderToStaticMarkup(
      <DashboardCard
        entry={{
          item: item({ kind: "report", reportId: "season-overview" }),
          query: null,
        }}
        hubSeason={2025}
        editing
        isFirst
        isLast={false}
        actions={actions}
      />
    );
    for (const text of [
      "Placer avant",
      "Placer après",
      "Moitié",
      "Pleine largeur",
      "Retirer",
      'aria-label="Retirer du tableau de bord"',
      'aria-label="Modifier « Chiffres clés de la saison »"',
    ]) {
      expect(html).toContain(text);
    }
    // Key figures are never a third; edit mode drops the view footer.
    expect(html).not.toContain("Un tiers");
    expect(html).not.toContain("Voir le tableau");
    expect(html).toMatch(/disabled=""[^>]*>.{0,400}Placer avant/);
    expect(html).toContain("outline-dashed");
  });

  it("locks a nominative card and flags invalid pinned values", () => {
    const html = renderToStaticMarkup(
      <DashboardCard
        entry={{
          item: item(
            { kind: "report", reportId: "outings-per-rower" },
            { rower_status: "nobody" }
          ),
          query: null,
        }}
        hubSeason={2025}
        editing={false}
        isFirst
        isLast
        actions={actions}
      />
    );
    expect(html).toContain("Réservé aux responsables");
    expect(html).toContain("ne sont plus valides");
  });

  it("explains a card whose report or query is gone", () => {
    const gone = renderToStaticMarkup(
      <DashboardCard
        entry={{
          item: item({ kind: "report", reportId: "renamed-report" }),
          query: null,
        }}
        hubSeason={2025}
        editing={false}
        isFirst
        isLast
        actions={actions}
      />
    );
    expect(gone).toContain("Carte indisponible");
    expect(gone).toContain("Ce rapport n&#x27;existe plus.");
    expect(gone).toContain("Retirer du tableau de bord");

    const query: SavedQuery = {
      id: "q1",
      title: "Sorties du soir",
      description: null,
      sql: "SELECT 1 AS n",
      params: [],
      chart: null,
      origin: "user",
      status: "saved",
      basedOnReportId: null,
      specVersion: 1,
      createdAt: "",
      updatedAt: "",
      archivedAt: null,
    };
    const savedCard = (
      <DashboardCard
        entry={{ item: item({ kind: "query", queryId: "q1" }), query }}
        hubSeason={2025}
        editing={false}
        isFirst
        isLast
        actions={actions}
      />
    );
    // Locked (static renders read the stores' initial state): a neutral
    // title instead of its own (review C, 3).
    const saved = renderToStaticMarkup(savedCard);
    expect(saved).toContain("Requête réservée aux responsables");
    expect(saved).not.toContain("Sorties du soir");
  });

  it("renders the catalogue, or the report sent by a card", () => {
    expect(renderToStaticMarkup(<ReportsPage />)).toContain(
      "Rechercher un rapport"
    );
    // A card hands its report over through the hub store; static renders
    // read the stores' initial state, so the report view is checked alone.
    useAnalyticsHubStore.getState().openReport("fleet-class-monthly");
    expect(useAnalyticsHubStore.getState().pendingReport?.reportId).toBe(
      "fleet-class-monthly"
    );
    const report = getReport("fleet-class-monthly");
    if (!report) throw new Error("missing report");
    expect(
      renderToStaticMarkup(<ReportView report={report} onBack={() => {}} />)
    ).toContain("Personnaliser");
  });

  it("renders the annual report header and exports", () => {
    const html = renderToStaticMarkup(<AnnualReportPage />);
    for (const text of [
      "Rapport annuel d&#x27;activité",
      "Exporter en Excel",
      "Ouvrir dans le navigateur",
      "Préparation du rapport…",
    ]) {
      expect(html).toContain(text);
    }
    // "Ajouter le nom du club" until a name is set.
    expect(html).toMatch(
      /Ajouter le nom du club|Modifier le nom et le mot du club/
    );
    expect(html).toContain('aria-labelledby="annual-title"');
    expect(html).toMatch(/Saison \d{4}-\d{4}/);
  });

  it("renders the pin button", () => {
    const html = renderToStaticMarkup(
      <PinButton
        source={{ kind: "report", reportId: "season-overview" }}
        paramValues={{}}
      />
    );
    expect(html).toContain("Épingler au tableau de bord");
  });
});

const savedQuery = (overrides: Partial<SavedQuery> = {}): SavedQuery => ({
  id: "q1",
  title: "Classement maison",
  description: null,
  sql: "SELECT display_name, COUNT(*) AS n FROM v_outings GROUP BY 1",
  params: [],
  chart: null,
  origin: "ai",
  status: "saved",
  basedOnReportId: null,
  specVersion: 1,
  createdAt: "",
  updatedAt: "",
  archivedAt: null,
  ...overrides,
});

const queryCard = (query: SavedQuery) => (
  <DashboardCard
    entry={{ item: item({ kind: "query", queryId: query.id }), query }}
    hubSeason={2025}
    editing={false}
    isFirst
    isLast
    actions={actions}
  />
);

describe("saved-query cards (ADR 0008)", () => {
  const ranking = getReport("outings-per-rower");
  const overview = getReport("season-overview");
  if (!ranking || !overview) throw new Error("missing reports");

  it("locks Explorer, AI and Claude queries at the boathouse and runs nothing", () => {
    for (const origin of ["user", "ai", "mcp"] as const) {
      const query = savedQuery({ origin });
      const entry = { item: item({ kind: "query", queryId: "q1" }), query };
      expect(cardVisibility(entry)).toBe("admin");
      const sql = reportQuerySql(
        { sql: query.sql, visibility: cardVisibility(entry) },
        {
          isUnlocked: false,
          publicRankings: true,
          availability: { available: true },
          missingRequired: false,
        }
      );
      expect(sql).toBeNull();
      const html = renderToStaticMarkup(queryCard(query));
      expect(html).toContain("Réservé aux responsables");
      expect(html).not.toContain("Exporter");
    }
  });

  it("hides a locked query's title and typed values (review C, 3)", () => {
    const query = savedQuery({
      title: "Sorties d'Anouk Abgrall",
      params: [
        {
          name: "nom",
          type: "text",
          label: "Nom",
          required: false,
          default: "Anouk Abgrall",
        },
      ],
    });
    const html = renderToStaticMarkup(queryCard(query));
    expect(html).toContain("Requête réservée aux responsables");
    expect(html).not.toContain("Anouk");
  });

  it("keeps the visibility of the report a query was saved from", () => {
    const fromRanking = savedQuery({
      origin: "report",
      sql: ranking.sql,
      basedOnReportId: ranking.id,
      params: ranking.params,
    });
    const entry = {
      item: item({ kind: "query", queryId: "q1" }),
      query: fromRanking,
    };
    expect(cardVisibility(entry)).toBe("nominative");
    expect(renderToStaticMarkup(queryCard(fromRanking))).toContain(
      "Réservé aux responsables"
    );
    // The club shows named rankings: then it is shown like the report.
    // (Static renders read the stores' initial state: checked directly.)
    expect(
      canSeeReport(
        { visibility: cardVisibility(entry) },
        { isUnlocked: false, publicRankings: true }
      )
    ).toBe(true);

    const edited = { ...fromRanking, sql: `${ranking.sql}\n-- edited` };
    expect(cardVisibility({ ...entry, query: edited })).toBe("admin");
  });

  it("shows a public report's query to everyone once unlocked or not", () => {
    const fromOverview = savedQuery({
      origin: "report",
      sql: overview.sql,
      basedOnReportId: overview.id,
      params: overview.params,
    });
    expect(renderToStaticMarkup(queryCard(fromOverview))).not.toContain(
      "Réservé aux responsables"
    );
    const aiEntry = {
      item: item({ kind: "query", queryId: "q1" }),
      query: savedQuery(),
    };
    expect(
      canSeeReport(
        { visibility: cardVisibility(aiEntry) },
        { isUnlocked: true, publicRankings: false }
      )
    ).toBe(true);
  });
});

describe("pin dialog: who will see the card", () => {
  it("reads the visibility of a report, a draft or a stored query", () => {
    expect(
      pinnedInfo({ kind: "report", reportId: "season-overview" }, null)
    ).toMatchObject({ visibility: "public", queryOnly: false });
    expect(
      pinnedInfo({ kind: "report", reportId: "inactive-rowers" }, null)
    ).toMatchObject({ visibility: "admin", queryOnly: false });
    const draft = pinnedInfo(
      {
        kind: "query",
        draft: {
          title: "IA",
          sql: "SELECT 1",
          params: [],
          chart: null,
          origin: "ai",
        },
      },
      null
    );
    expect(draft).toMatchObject({ visibility: "admin", queryOnly: true });
    // A saved query is read first: no info (and no pin) until then.
    expect(pinnedInfo({ kind: "query", queryId: "q1" }, null)).toBeNull();
    const overview = getReport("season-overview");
    expect(
      pinnedInfo(
        { kind: "query", queryId: "q1" },
        {
          sql: overview?.sql ?? "",
          basedOnReportId: "season-overview",
          params: overview?.params ?? [],
        }
      )
    ).toMatchObject({ visibility: "public", defs: overview?.params });
  });

  it("says plainly who will see it", () => {
    const everyone = renderToStaticMarkup(
      <AudienceNote
        info={{ defs: [], visibility: "public", queryOnly: false }}
        publicRankings={false}
      />
    );
    expect(everyone).toContain("Visible par tous au hangar");
    const officials = renderToStaticMarkup(
      <AudienceNote
        info={{ defs: [], visibility: "admin", queryOnly: true }}
        publicRankings={true}
      />
    );
    expect(officials).toContain("Réservé aux responsables");
    expect(officials).toContain("peut afficher des noms");
    const rankings = renderToStaticMarkup(
      <AudienceNote
        info={{ defs: [], visibility: "nominative", queryOnly: false }}
        publicRankings={true}
      />
    );
    expect(rankings).toContain("Visible par tous au hangar");
    expect(rankings).toContain("classements nominatifs");
  });
});

describe("report opened from a card with a fixed season", () => {
  it("shows that season without changing the hub's", () => {
    const report = getReport("yoy-monthly");
    if (!report) throw new Error("missing report");
    useAnalyticsHubStore.getState().setSeason(null);
    const html = renderToStaticMarkup(
      <ReportView report={report} initialSeason={2019} onBack={() => {}} />
    );
    expect(html).toContain(
      "Saison 2019-2020 · fixée sur la carte du tableau de bord"
    );
    expect(html).toContain("Suivre la saison choisie");
    expect(useAnalyticsHubStore.getState().season).toBeNull();
  });
});
