import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { ChartSpec } from "../chartSpec";
import type { QueryResult } from "../types";
import { CHART_FIXTURES } from "./chartFixtures";
import { ChartView } from "./ChartView";
import { ResultTable } from "./ResultTable";
import { ChartBuilder, convertSpec } from "./ChartBuilder";
import { fittingChartTypes } from "./chartFits";

const result = (names: string[], rows: QueryResult["rows"]): QueryResult => ({
  columns: names.map((name) => ({ name, declType: null })),
  rows,
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
});

beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});

const render = (spec: ChartSpec, res: QueryResult, params = {}) =>
  renderToStaticMarkup(<ChartView spec={spec} result={res} params={params} />);

describe("ChartView", () => {
  it.each(CHART_FIXTURES.map((f) => [f.id, f] as const))(
    "renders %s",
    (_, fixture) => {
      const html = render(fixture.spec, fixture.result, fixture.params);
      if (fixture.spec.type === "kpi" || fixture.spec.type === "table") {
        expect(html).not.toContain("data-chart-root");
      } else {
        expect(html).toContain("data-chart-root");
        // Every chart offers its table view.
        expect(html).toContain("Voir le tableau");
      }
    }
  );

  it("shows the empty state for no rows or only nulls", () => {
    const bar: ChartSpec = {
      type: "bar",
      x: "month",
      y: ["outings"],
      orientation: "vertical",
      stacked: false,
      sort: "none",
    };
    expect(render(bar, result(["month", "outings"], []))).toContain(
      "Aucune donnée pour ces critères."
    );
    expect(
      render(
        bar,
        result(
          ["month", "outings"],
          [
            [8, null],
            [9, null],
          ]
        )
      )
    ).toContain("Aucune donnée pour ces critères.");
  });

  it("falls back to the table when the columns changed", () => {
    const html = render(
      { type: "pie", label: "boat_name", value: "outings" },
      result(["boat", "n"], [["A", 1]])
    );
    expect(html).toContain(
      "Le graphique ne correspond plus aux colonnes de la requête."
    );
    expect(html).toContain("<table");
  });

  it("shows one-row bars and lines as key figures", () => {
    const html = render(
      {
        type: "bar",
        x: "month",
        y: ["outings", "km"],
        orientation: "vertical",
        stacked: false,
        sort: "none",
      },
      result(["month", "outings", "km"], [[8, 12, 30.5]])
    );
    expect(html).toContain("data-kpi");
    expect(html).toContain("août");
    expect(html).not.toContain("data-chart-root");
  });

  it("draws a pie of more than 6 slices as horizontal bars", () => {
    const rows = Array.from({ length: 9 }, (_, i) => [`Parcours ${i}`, 10 - i]);
    const html = render(
      { type: "pie", label: "route_name", value: "outings" },
      result(["route_name", "outings"], rows)
    );
    // Bars: the slices become rows, with their ranks.
    expect(html).toContain('aria-label="Sorties par parcours, 9 valeurs');
    expect(html).toContain("Parcours 8");
  });

  it("shows a one-slice pie as a key figure", () => {
    const html = render(
      { type: "pie", label: "route_name", value: "outings" },
      result(
        ["route_name", "outings"],
        [
          ["Boucle", 12],
          ["Canal", 0],
        ]
      )
    );
    expect(html).toContain('data-kpi="true"');
    expect(html).toContain("Boucle");
  });

  it("caps huge bar charts and says the table has everything", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [`R${i}`, i % 97]);
    const html = render(
      {
        type: "bar",
        x: "rower_label",
        y: ["outings"],
        orientation: "horizontal",
        stacked: false,
        sort: "desc",
      },
      result(["rower_label", "outings"], rows)
    );
    expect(html).toContain(
      "Le graphique montre les 100 premières valeurs sur 5000"
    );
  });

  it("folds more than 8 series into Autres", () => {
    const rows = [];
    for (let s = 0; s < 12; s++)
      for (const m of [8, 9]) rows.push([m, `C${s}`, s + 1]);
    const html = render(
      {
        type: "bar",
        x: "month",
        y: ["outings"],
        series: "cls",
        orientation: "vertical",
        stacked: true,
        sort: "none",
      },
      result(["month", "cls", "outings"], rows)
    );
    expect(html).toContain("Autres");
    expect(html).not.toContain(">C0<");
  });

  it("renders the table view in table mode", () => {
    const fixture = CHART_FIXTURES[1];
    const html = renderToStaticMarkup(
      <ChartView
        spec={fixture.spec}
        result={fixture.result}
        params={fixture.params}
        mode="table"
        onModeChange={() => undefined}
      />
    );
    expect(html).toContain("<table");
    // Controlled: the parent renders the toggle.
    expect(html).not.toContain("Voir le graphique");
  });
});

describe("ResultTable", () => {
  it("windows long results and keeps 44 px header targets", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [`Rameur ${i}`, i]);
    const html = renderToStaticMarkup(
      <ResultTable result={result(["rower_label", "outings"], rows)} />
    );
    const rendered =
      (html.match(/<tr /g) ?? []).length + (html.match(/<tr>/g) ?? []).length;
    expect(rendered).toBeLessThan(80);
    expect(html).toContain("5000 lignes");
    expect(html).toContain("min-h-11");
    expect(html).toContain("text-right tabular-nums");
  });

  it("formats values with the spec's formats", () => {
    const html = renderToStaticMarkup(
      <ResultTable
        result={result(["month", "value"], [[8, 12.5]])}
        spec={{ type: "table", formats: { value: "km" } }}
      />
    ).replace(/[\u202f\u00a0]/g, " ");
    expect(html).toContain("août");
    // The unit once, in the header; bare numbers in the cells.
    expect(html).toContain("Valeur (km)");
    expect(html).toContain(">12,5<");
    expect(html).not.toContain("12,5 km");
  });

  it("marks columns masked for privacy", () => {
    const html = renderToStaticMarkup(
      <ResultTable
        result={{
          ...result(
            ["display_name", "email"],
            [
              ["Ana", null],
              ["Bo", null],
            ]
          ),
          ignoredColumns: ["rower.email"],
        }}
      />
    );
    expect(html).toContain("masqué");
    expect(html).toContain("Colonne masquée");
  });
});

describe("ChartBuilder", () => {
  it("converts every fixture to every fitting type as a valid spec", () => {
    for (const fixture of CHART_FIXTURES) {
      for (const type of fittingChartTypes(
        fixture.result.columns,
        fixture.result.rows
      )) {
        const spec = convertSpec(fixture.spec, type, fixture.result);
        const parsed = ChartSpec.safeParse(spec);
        expect(parsed.success, `${fixture.id} → ${type}`).toBe(true);
        expect(spec.type).toBe(type);
      }
    }
  });

  it("keeps labels when converting", () => {
    const fixture = CHART_FIXTURES[1];
    const spec = convertSpec(fixture.spec, "line", fixture.result);
    expect(spec.labelKeys).toEqual(fixture.spec.labelKeys);
  });

  it("offers only fitting types, with touch-size controls", () => {
    const fixture = CHART_FIXTURES[2];
    const spec = fixture.spec;
    if (spec.type !== "bar") throw new Error("bar fixture expected");
    const html = renderToStaticMarkup(
      <ChartBuilder
        result={fixture.result}
        value={spec}
        onChange={() => undefined}
        original={{ ...spec, stacked: false }}
      />
    );
    expect(html).toContain("Barres");
    // Unfit types stay visible, disabled, with the reason.
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*title="Il faut une colonne de dates"/
    );
    expect(html).toContain("Revenir au graphique d&#x27;origine");
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) expect(button).toContain("min-h-11");
  });
});
