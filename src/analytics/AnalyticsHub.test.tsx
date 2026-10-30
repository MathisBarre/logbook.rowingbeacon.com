import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../_common/i18n/config";
import { setEngineForTests } from "./engine/engine";
import { resetQueueForTests } from "./engine/queue";
import { AnalyticsHub } from "./AnalyticsHub";
import { DashboardPage } from "./dashboard/DashboardPage";
import { ReportsPage } from "./reportsUi/ReportsPage";
import { AnnualReportPage } from "./annual/AnnualReportPage";
import { ExplorerPage } from "./explorer/ExplorerPage";
import { AnalyticsSettingsTab } from "./settings/AnalyticsSettingsTab";

beforeEach(async () => {
  resetQueueForTests();
  setEngineForTests({
    run: () => new Promise(() => undefined),
    cancel: () => Promise.resolve(),
    objects: () => Promise.resolve({ views: [], tables: [], missingViews: [] }),
  });
  await i18n.changeLanguage("fr-FR");
});
afterEach(() => setEngineForTests(null));

describe("AnalyticsHub", () => {
  it("renders the header and the four tabs in French", () => {
    const html = renderToStaticMarkup(<AnalyticsHub />);
    for (const text of [
      "Statistiques",
      "Tableau de bord",
      "Rapports",
      "Rapport annuel",
      "Explorer",
      "Déverrouiller",
      "Saison ",
    ]) {
      expect(html).toContain(text);
    }
  });

  // Each tab shows its real panel (no "À venir" placeholder left), with the
  // engine kept pending: only what renders before any query answers.
  it.each([
    ["Tableau de bord", DashboardPage, ['aria-busy="true"']],
    [
      "Rapports",
      ReportsPage,
      [
        "Vue d&#x27;ensemble",
        "Chiffres clés de la saison",
        "Flotte",
        "Classement des bateaux",
      ],
    ],
    [
      "Rapport annuel",
      AnnualReportPage,
      [
        "Rapport annuel d&#x27;activité",
        "Exporter en Excel",
        "Préparation du rapport…",
      ],
    ],
    [
      "Explorer",
      ExplorerPage,
      [
        "Requêtes",
        "Propositions",
        "Dictionnaire",
        "Demander à l&#x27;IA",
        "Exécuter",
      ],
    ],
    [
      "Statistiques et IA",
      AnalyticsSettingsTab,
      [
        "Début de la saison",
        "Clé API Anthropic",
        "Votre application d&#x27;IA (MCP)",
      ],
    ],
  ] as const)("renders the real %s panel", (_title, Page, texts) => {
    const html = renderToStaticMarkup(<Page />);
    for (const text of texts) expect(html).toContain(text);
    expect(html).not.toContain("À venir");
  });
});
