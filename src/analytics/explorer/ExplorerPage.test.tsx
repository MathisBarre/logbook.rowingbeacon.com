import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { setEngineForTests } from "../engine/engine";
import { resetQueueForTests } from "../engine/queue";
import { AnalyticsError } from "../engine/errors";
import { getDictionary } from "../schema/dictionary";
import { ExplorerPage, slugOf, valuesForRun } from "./ExplorerPage";
import { resetExplorerStoreForTests, useExplorerStore } from "./explorer.store";
import { ResultsPanel } from "./ResultsPanel";
import { ParamsEditor } from "./ParamsEditor";
import { DictionaryPanel } from "./DictionaryPanel";
import { filterDictionary } from "./dictionaryModel";
import { SavedQueries } from "./SavedQueries";
import { Proposals } from "./Proposals";
import { buildCompletionSchema } from "./sqlCompletion";
import { explainSqlError } from "./sqlErrorHelp";
import type { SavedQuery } from "../types";

beforeEach(async () => {
  resetQueueForTests();
  resetExplorerStoreForTests();
  setEngineForTests({
    run: () => new Promise(() => undefined),
    cancel: () => Promise.resolve(),
    objects: () => Promise.resolve({ views: [], tables: [], missingViews: [] }),
  });
  await i18n.changeLanguage("fr-FR");
});
afterEach(() => {
  setEngineForTests(null);
  vi.unstubAllGlobals();
});

/**
 * The page embeds other packages' components (AI panel, pin button) whose
 * closed dialogs read `document` while rendering: a minimal stand-in is
 * enough for a static render.
 */
const stubDocument = () =>
  vi.stubGlobal("document", {
    getElementById: () => null,
    visibilityState: "visible",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });

const query = (overrides: Partial<SavedQuery> = {}): SavedQuery => ({
  id: "q1",
  title: "Sorties du samedi",
  description: "Par bateau",
  sql: "SELECT 1",
  params: [],
  chart: null,
  origin: "ai",
  status: "saved",
  basedOnReportId: null,
  specVersion: 1,
  createdAt: "2026-06-20T07:40:00.000Z",
  updatedAt: "2026-06-20T07:40:00.000Z",
  archivedAt: null,
  ...overrides,
});

const noop = () => undefined;

describe("ExplorerPage", () => {
  beforeEach(stubDocument);

  it("renders the side tabs, the toolbar, the editor fallback and the first steps", () => {
    const html = renderToStaticMarkup(<ExplorerPage />);
    for (const text of [
      "Requêtes",
      "Propositions",
      "Dictionnaire",
      "Nouvelle requête",
      "Requête sans titre",
      "Exemples",
      "Enregistrer",
      "Plus d&#x27;actions",
      "Chargement de l&#x27;éditeur…",
      "Exécuter",
      "Premiers pas avec l&#x27;Explorer",
      "lecture seule",
      "Sorties par mois",
      "Compter les sorties et les grouper par mois (GROUP BY).",
      "Bateaux pas sortis cette saison",
    ]) {
      expect(html).toContain(text);
    }
    // No empty sections on a new query (review 2), no separate Stop,
    // no shortcut line, "(0)" only as a pill when there are proposals.
    for (const text of [
      "Propositions (0)",
      "Paramètres",
      "Exécutez la requête pour voir le résultat.",
      "Arrêter",
      "Ctrl + Espace",
      "Enregistrer sous…",
      "Vider l&#x27;éditeur",
    ]) {
      expect(html).not.toContain(text);
    }
    // Real ARIA tabs (review 61).
    expect(html).toContain('id="explorer-tab-queries"');
    expect(html).toContain('aria-controls="explorer-panel"');
    expect(html).toContain('aria-labelledby="explorer-tab-queries"');
    // One <main> only: the Logbook's (review 60).
    expect(html).not.toContain("<main");
  });

  it("lists the parameters of a query with their guessed type", () => {
    useExplorerStore
      .getState()
      .setSql(
        "SELECT * FROM v_outings WHERE season = :season AND boat_id = :boat_id"
      );
    const { doc, paramValues } = useExplorerStore.getState();
    const html = renderToStaticMarkup(
      <ParamsEditor
        params={doc.params.map((def) =>
          def.name === "boat_id" ? { ...def, required: true } : def
        )}
        values={paramValues}
        onTypeChange={noop}
        onValuesChange={noop}
      />
    );
    expect(html).toContain(":season");
    expect(html).toContain(":boat_id");
    expect(html).toMatch(/<option value="boat" selected="">Bateau<\/option>/);
    // Shown once, under the value control (ParamsBar).
    expect(html.split("Valeur requise")).toHaveLength(2);
    expect(html).not.toContain("Liste de choix");
    // The value is labelled by the name, and findable by the AI panel.
    expect(html).toContain('id="param-boat_id"');
    expect(html).toContain('aria-labelledby="param-boat_id"');
    expect(html).toContain('data-param="boat_id"');
  });

  it("renders nothing without parameters (review 2)", () => {
    expect(
      renderToStaticMarkup(
        <ParamsEditor
          params={[]}
          values={{}}
          onTypeChange={noop}
          onValuesChange={noop}
        />
      )
    ).toBe("");
  });
});

describe("ResultsPanel", () => {
  const base = {
    chart: null,
    fallbackChart: { type: "table" as const },
    onChartChange: noop,
    mode: "table" as const,
    onModeChange: noop,
    builderOpen: false,
    onBuilderOpenChange: noop,
    params: {},
    hasSql: true,
    stale: false,
    errorHelp: null,
    onGoToError: null,
    onApplyFix: noop,
    onRetry: noop,
    onChangeProfile: null,
    seasonLabel: null,
    fileSlug: "requete",
  };
  const t = i18n.getFixedT("fr-FR");
  const schema = buildCompletionSchema(getDictionary().objects, null, {
    columnLabel: () => null,
    objectInfo: () => "",
    semanticLabel: (s) => s,
    functionInfo: () => undefined,
  });
  const errorState = (error: AnalyticsError) => ({
    status: "error" as const,
    result: null,
    error,
    isSlow: false,
  });

  it("renders nothing before a query exists, one plain line after", () => {
    const idle = {
      status: "idle" as const,
      result: null,
      error: null,
      isSlow: false,
    };
    expect(
      renderToStaticMarkup(
        <ResultsPanel {...base} hasSql={false} state={idle} />
      )
    ).toBe("");
    const html = renderToStaticMarkup(<ResultsPanel {...base} state={idle} />);
    expect(html).toContain("Exécutez la requête pour voir le résultat.");
    expect(html).not.toContain("dashed");
  });

  it("explains a typo with a one-tap fix, without Réessayer (review 27, 28)", () => {
    const sql =
      "SELECT boat_name, COUNT(*) AS outings\nFROM v_outings\nGROUP BY boat_name\nLIMT 10";
    const error = new AnalyticsError(
      {
        code: "syntax",
        message: 'near "10": syntax error',
        offset: sql.indexOf("10"),
      },
      { sql }
    );
    const help = explainSqlError(error, sql, schema, t);
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        state={errorState(error)}
        errorHelp={help}
        onGoToError={noop}
      />
    );
    expect(html).toContain("vouliez-vous dire LIMIT ?");
    expect(html).toContain("Corriger en LIMIT");
    expect(html).toContain("Aller à l&#x27;erreur");
    expect(html).toContain("Détail technique");
    expect(html).not.toContain("Réessayer");
    expect(html).not.toContain("Relancer");
    expect(html).toContain('role="alert"');
  });

  it("shows a timeout as a notice with tips and Relancer, a refused write calmly", () => {
    const timeout = new AnalyticsError(
      { code: "timeout", message: "x" },
      { sql: "SELECT 1", timeoutMs: 10_000 }
    );
    const timeoutHtml = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        state={errorState(timeout)}
        errorHelp={explainSqlError(timeout, "SELECT 1", schema, t)}
      />
    );
    expect(timeoutHtml).toContain("Arrêtée au bout de");
    expect(timeoutHtml).toContain("WITH RECURSIVE");
    expect(timeoutHtml).toContain("Relancer");
    expect(timeoutHtml).toContain("bg-yellow-50");

    const denied = new AnalyticsError({ code: "not_read_only", message: "x" });
    const deniedHtml = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        state={errorState(denied)}
        errorHelp={explainSqlError(denied, "DELETE FROM outing", schema, t)}
        onGoToError={null}
      />
    );
    expect(deniedHtml).toContain("rien n&#x27;a été modifié");
    expect(deniedHtml).toContain('role="status"');
    expect(deniedHtml).not.toContain("bg-error-50");
    expect(deniedHtml).not.toContain("<button");
  });

  it("dims a result the SQL no longer matches (review 20)", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        stale
        state={{
          status: "success",
          error: null,
          isSlow: false,
          result: {
            columns: [{ name: "n", declType: null }],
            rows: [[1]],
            truncated: false,
            elapsedMs: 3,
            ignoredColumns: [],
            cached: false,
          },
        }}
      />
    );
    expect(html).toContain("La requête a changé depuis ce résultat.");
    expect(html).toContain("opacity-60");
  });

  it("says the limit once, in the status line, with the season", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        seasonLabel="Saison 2024-2025"
        state={{
          status: "success",
          error: null,
          isSlow: false,
          result: {
            columns: [{ name: "boat_name", declType: "TEXT" }],
            rows: [["Lune"], ["Soleil"]],
            truncated: true,
            elapsedMs: 12.4,
            ignoredColumns: ["rower.email"],
            cached: false,
          },
        }}
      />
    );
    expect(html).toContain(
      "2 premières lignes seulement (limite atteinte) · 12 ms · Saison 2024-2025"
    );
    expect(html).toContain("Ajoutez un filtre ou un GROUP BY");
    expect(html).not.toContain("Seules les 2 premières lignes");
    // Memoised: typing in the editor does not redraw the result.
    expect((ResultsPanel as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo")
    );
    expect(html).toContain('id="explorer-result-status"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Voir le tableau");
    expect(html).toContain("Voir le graphique");
    expect(html).toContain("Personnaliser");
    expect(html).toContain("Lune");
  });

  it("formats the row count and the run time in the app's language", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        state={{
          status: "success",
          error: null,
          isSlow: false,
          result: {
            columns: [{ name: "n", declType: null }],
            rows: Array.from({ length: 1200 }, (_, i) => [i]),
            truncated: false,
            elapsedMs: 12345,
            ignoredColumns: [],
            cached: false,
          },
        }}
      />
    );
    expect(html).toContain(
      `${(1200).toLocaleString("fr-FR")} lignes · ${(12345).toLocaleString("fr-FR")} ms`
    );
  });

  it("says when no row came back, and what to check", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...base}
        state={{
          status: "success",
          error: null,
          isSlow: false,
          result: {
            columns: [{ name: "n", declType: null }],
            rows: [],
            truncated: false,
            elapsedMs: 17,
            ignoredColumns: [],
            cached: false,
          },
        }}
      />
    );
    expect(html).toContain("Aucune ligne · 17 ms");
    expect(html).toContain("Vérifiez les conditions WHERE");
  });
});

describe("side panels", () => {
  const list = (queries: SavedQuery[] | null, error = false) => ({
    queries,
    error,
  });
  const savedProps = {
    archived: list([]),
    currentId: null,
    onOpen: noop,
    onRename: noop,
    onDuplicate: noop,
    onArchive: noop,
    onRestore: noop,
    onRetry: noop,
  };

  it("lists saved queries with their description, origin and one labelled menu", () => {
    const html = renderToStaticMarkup(
      <SavedQueries
        {...savedProps}
        list={list([
          query(),
          query({ id: "q2", title: "Km", origin: "mcp", client: "claude-ai" }),
          query({ id: "q3", title: "Mine", origin: "user" }),
        ])}
        currentId="q1"
      />
    );
    for (const text of [
      "Sorties du samedi",
      "Par bateau",
      "Assistant IA",
      "Claude Desktop",
      "Modifiée le",
      "Actions pour « Sorties du samedi »",
      'data-query-id="q1"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain(">Vous<");
    // The actions live in the menu, not on every row.
    expect(html).not.toContain("Dupliquer");
    expect(
      renderToStaticMarkup(<SavedQueries {...savedProps} list={list([])} />)
    ).toContain("ou essayez un exemple");
  });

  it("tells a failed read apart from an empty list, and lists archived queries", () => {
    const failed = renderToStaticMarkup(
      <SavedQueries {...savedProps} list={list(null, true)} />
    );
    expect(failed).toContain("Impossible de lire les requêtes du club.");
    expect(failed).toContain("Réessayer");
    expect(failed).not.toContain("Aucune requête enregistrée");
    const withArchived = renderToStaticMarkup(
      <SavedQueries
        {...savedProps}
        list={list([query()])}
        archived={list([
          query({ id: "a1", archivedAt: "2026-06-01T08:00:00.000Z" }),
        ])}
      />
    );
    expect(withArchived).toContain("Archivée (1)");
  });

  it("lists proposals and unreadable files", () => {
    const html = renderToStaticMarkup(
      <Proposals
        proposals={[
          query({
            origin: "mcp",
            status: "proposed",
            client: "codex-mcp-client",
          }),
        ]}
        invalid={[
          {
            id: "x",
            title: null,
            client: "claude-code",
            createdAt: null,
            reason: "unreadable",
            detail: "bad JSON",
          },
        ]}
        currentId={null}
        mcpEnabled
        onExamine={noop}
        onAccept={noop}
        onRefuse={noop}
        onRemoveInvalid={noop}
      />
    );
    for (const text of [
      "Proposée par Codex",
      "Examiner",
      "Accepter",
      "Refuser",
      "Proposition illisible : le fichier n&#x27;est pas lisible",
      "Détail technique",
      "bad JSON",
      "Supprimer le fichier",
      'aria-describedby="proposal-title-q1"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Aperçu");
    expect(html).not.toContain("Voir le SQL");
    const empty = (mcpEnabled: boolean) =>
      renderToStaticMarkup(
        <Proposals
          proposals={[]}
          invalid={[]}
          currentId={null}
          mcpEnabled={mcpEnabled}
          onExamine={noop}
          onAccept={noop}
          onRefuse={noop}
          onRemoveInvalid={noop}
        />
      );
    expect(empty(false)).toContain("Activez-les dans Gestion");
    expect(empty(true)).toContain("Aucune proposition");
  });

  it("shows the dictionary with French descriptions and personal badges", () => {
    const html = renderToStaticMarkup(
      <DictionaryPanel
        objects={{
          views: ["v_outings", "v_rowers"],
          tables: ["outing", "rower"],
          missingViews: [],
        }}
        onInsert={noop}
        onPreview={noop}
      />
    );
    expect(html).toContain("Vues simplifiées");
    expect(html).toContain("Tables avancées");
    expect(html).toContain("La vue la plus utile");
    expect(html).toContain("pas encore enregistrées par cette version");
    expect(html).not.toContain("il manque la table");
    // v_outings first (review 48), with its badge when it exists.
    expect(html.indexOf(">v_outings<")).toBeLessThan(
      html.indexOf(">v_settings<")
    );
    const all = renderToStaticMarkup(
      <DictionaryPanel objects={null} onInsert={noop} onPreview={noop} />
    );
    expect(all).toContain("La plus utile");
    expect(all).toContain(">Insérer</button>");
    expect(all).toContain('aria-label="Insérer v_outings dans la requête"');
  });
});

describe("filterDictionary", () => {
  const texts = {
    object: (o: { description: string }) => o.description,
    column: (c: { name: string }) =>
      c.name === "gender" ? "Sexe Femme Homme" : "",
  };

  it("is accent-insensitive and keeps only matching columns", () => {
    const result = filterDictionary(
      getDictionary().objects,
      "FÉMME",
      texts,
      null
    );
    const names = [...result.views, ...result.tables].map((e) => e.object.name);
    expect(names).toContain("v_rowers");
    const rowers = result.views.find((e) => e.object.name === "v_rowers");
    expect(rowers?.columns.map((c) => c.name)).toEqual(["gender"]);
    expect(rowers?.matched).toBe(true);
  });

  it("keeps every column when the object itself matches, views before tables", () => {
    const result = filterDictionary(
      getDictionary().objects,
      "v_routes",
      texts,
      null
    );
    expect(result.views.map((e) => e.object.name)).toEqual(["v_routes"]);
    expect(result.views[0].columns.length).toBe(
      getDictionary().objects.find((o) => o.name === "v_routes")?.columns.length
    );
    const all = filterDictionary(getDictionary().objects, "", texts, {
      views: ["v_outings"],
      tables: ["outing"],
      missingViews: ["v_damages"],
    });
    expect(all.views.every((e) => e.object.level === "simple")).toBe(true);
    expect(all.views.map((e) => e.object.name).slice(0, 3)).toEqual([
      "v_outings",
      "v_outing_rowers",
      "v_boats",
    ]);
    expect(
      all.views.find((e) => e.object.name === "v_damages")?.missingTable
    ).toBe("boat_damage");
  });
});

describe("helpers", () => {
  it("slugs titles for file names", () => {
    expect(slugOf("Sorties du samedi (été) !")).toBe("sorties-du-samedi-ete");
    expect(slugOf("!!!")).toBe("requete");
  });

  it("binds 'current' seasons to the hub season", () => {
    expect(
      valuesForRun(
        [
          {
            name: "season",
            type: "season",
            required: true,
            default: "current",
          },
          { name: "boat_id", type: "boat", required: false, default: null },
        ],
        { season: "current", boat_id: "b1" },
        2024
      )
    ).toEqual({ season: 2024, boat_id: "b1" });
    expect(
      valuesForRun(
        [
          {
            name: "season",
            type: "season",
            required: true,
            default: "current",
          },
        ],
        { season: 2022 },
        2024
      )
    ).toEqual({ season: 2022 });
  });
});
