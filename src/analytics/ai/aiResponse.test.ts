import { describe, expect, it } from "vitest";
import { ChartSpec } from "../chartSpec";
import { AiChart, AiResponse, EMPTY_AI_CHART } from "./aiSchema";
import { parseAiText, toChartSpec, toDraft, toParamDefs } from "./aiResponse";
import answerBar from "./fixtures/answer-bar.json";
import answerKpi from "./fixtures/answer-kpi.json";
import answerYouth from "./fixtures/answer-youth.json";
import clarification from "./fixtures/clarification.json";

const parse = (value: unknown) => AiResponse.parse(value);
const chart = (overrides: Partial<AiChart>): AiChart => ({
  ...EMPTY_AI_CHART,
  ...overrides,
});

describe("parseAiText", () => {
  it("parses a fixture answer", () => {
    const result = parseAiText(JSON.stringify(answerBar));
    expect(result.ok).toBe(true);
  });

  it("tells invalid JSON from a schema mismatch", () => {
    expect(parseAiText("not json")).toEqual({ ok: false, reason: "json" });
    expect(parseAiText('{"title": "x"}')).toEqual({
      ok: false,
      reason: "schema",
    });
  });
});

describe("toDraft", () => {
  it("turns the bar fixture into a valid draft", () => {
    const draft = toDraft(parse(answerBar));
    expect(draft.title).toBe("Bateaux les plus sortis le week-end");
    expect(draft.sql).toContain("FROM v_outings");
    expect(draft.params).toEqual([
      {
        name: "season",
        type: "season",
        label: "Saison",
        required: true,
        default: "current",
      },
    ]);
    expect(draft.chart).toEqual({
      type: "bar",
      x: "boat_name",
      y: ["outings"],
      orientation: "horizontal",
      stacked: false,
      sort: "none",
      limit: 20,
    });
    expect(draft.assumptions).toHaveLength(3);
    expect(draft.clarification).toBeNull();
  });

  it("maps KPI tiles, dropping auto formats and empty labels", () => {
    const draft = toDraft(parse(answerKpi));
    expect(draft.params).toEqual([]);
    expect(draft.chart).toEqual({
      type: "kpi",
      items: [
        { value: "outings", format: "integer", higherIsBetter: true },
        { value: "km", format: "km", higherIsBetter: true },
        { value: "hours", format: "hours", higherIsBetter: true },
      ],
    });
  });

  it("maps a line chart", () => {
    expect(toDraft(parse(answerYouth)).chart).toEqual({
      type: "line",
      x: "month",
      y: ["active_rowers"],
      cumulative: false,
    });
  });

  it("keeps the clarification and no SQL", () => {
    const draft = toDraft(parse(clarification));
    expect(draft.sql).toBeNull();
    expect(draft.params).toEqual([]);
    expect(draft.clarification).toContain("Voulez-vous compter");
    expect(draft.choices).toEqual(["Les sorties", "Les rameurs présents"]);
  });

  it("keeps at most four distinct choices, and none without a question", () => {
    const many = toDraft(
      parse({
        ...clarification,
        choices: ["A", "B", "A", " ", "C", "D", "E"],
      })
    );
    expect(many.choices).toEqual(["A", "B", "C", "D"]);
    expect(
      toDraft(parse({ ...answerBar, choices: ["A", "B"] })).choices
    ).toEqual([]);
  });

  it("cuts long texts and keeps at most five assumptions", () => {
    const draft = toDraft(
      parse({
        ...answerBar,
        title: "T".repeat(300),
        explanation: "E".repeat(3000),
        assumptions: Array.from(
          { length: 9 },
          (_, i) => `${i} ${"a".repeat(400)}`
        ),
      })
    );
    expect(draft.title.length).toBeLessThanOrEqual(120);
    expect(draft.explanation.length).toBeLessThanOrEqual(1000);
    expect(draft.assumptions).toHaveLength(5);
    for (const text of draft.assumptions) {
      expect(text.length).toBeLessThanOrEqual(200);
    }
  });

  it("treats a blank SQL as none", () => {
    expect(toDraft(parse({ ...answerBar, sql: "   " })).sql).toBeNull();
  });
});

describe("toParamDefs", () => {
  const sql =
    "SELECT 1 FROM v_outings WHERE season = :season AND (:boat_id IS NULL OR boat_id = :boat_id) AND x = :mystery";

  it("follows the SQL: drops unused params, adds missing ones as text", () => {
    const defs = toParamDefs(sql, [
      ...parse(answerBar).params,
      {
        name: "unused",
        type: "integer",
        label: "",
        required: false,
        default: null,
        options: [],
        min: null,
        max: null,
      },
      {
        name: "boat_id",
        type: "boat",
        label: "Bateau",
        required: false,
        default: null,
        options: [],
        min: null,
        max: null,
      },
    ]);
    expect(defs.map((d) => [d.name, d.type])).toEqual([
      ["season", "season"],
      ["boat_id", "boat"],
      ["mystery", "text"],
    ]);
  });

  it("rejects invalid names and gives a season the current default", () => {
    const defs = toParamDefs("SELECT :season, :Bad", [
      {
        name: "season",
        type: "season",
        label: "",
        required: true,
        default: null,
        options: [],
        min: null,
        max: null,
      },
      {
        name: "Bad",
        type: "text",
        label: "",
        required: false,
        default: null,
        options: [],
        min: null,
        max: null,
      },
    ]);
    expect(defs).toEqual([
      { name: "season", type: "season", required: true, default: "current" },
    ]);
  });

  it("keeps options, min and max when given", () => {
    const [def] = toParamDefs("SELECT :metric, :n", [
      {
        name: "metric",
        type: "choice",
        label: "Mesure",
        required: true,
        default: "outings",
        options: [
          { value: "outings", label: "Sorties" },
          { value: "km", label: "" },
        ],
        min: null,
        max: null,
      },
    ]);
    expect(def.options).toEqual([
      { value: "outings", label: "Sorties" },
      { value: "km" },
    ]);
  });
});

describe("toChartSpec", () => {
  it.each<[string, Partial<AiChart>]>([
    ["pie", { type: "pie", label: "gender", value: "rowers" }],
    [
      "heatmap",
      { type: "heatmap", x: "hour", y: ["weekday"], value: "outings" },
    ],
    ["calendar", { type: "calendar", date: "date", value: "outings" }],
    ["table", { type: "table", columns: ["a", "b"] }],
    ["area", { type: "area", x: "month", y: ["km"], cumulative: true }],
  ])("builds a valid %s spec", (_type, overrides) => {
    const spec = toChartSpec(chart(overrides));
    expect(spec).not.toBeNull();
    expect(ChartSpec.safeParse(spec).success).toBe(true);
  });

  it("maps the heatmap y list to its first column", () => {
    expect(
      toChartSpec(
        chart({ type: "heatmap", x: "hour", y: ["weekday"], value: "n" })
      )
    ).toEqual({ type: "heatmap", x: "hour", y: "weekday", value: "n" });
  });

  it("returns null for charts missing their columns", () => {
    expect(toChartSpec(chart({ type: "bar", x: "", y: ["a"] }))).toBeNull();
    expect(toChartSpec(chart({ type: "bar", x: "a", y: [] }))).toBeNull();
    expect(toChartSpec(chart({ type: "pie", label: "a" }))).toBeNull();
    expect(toChartSpec(chart({ type: "kpi" }))).toBeNull();
    expect(
      toChartSpec(chart({ type: "bar", x: "bad name", y: ["a"] }))
    ).toBeNull();
  });

  it("keeps one y with a series, at most 8 y otherwise, clamps limit", () => {
    expect(
      toChartSpec(
        chart({ type: "bar", x: "m", y: ["a", "b"], series: "s", limit: 500 })
      )
    ).toMatchObject({ y: ["a"], series: "s", limit: 100 });
    const many = toChartSpec(
      chart({
        type: "line",
        x: "m",
        y: Array.from({ length: 12 }, (_, i) => `c${i}`),
      })
    );
    expect(many && "y" in many && many.y).toHaveLength(8);
  });

  it("maps column labels and formats", () => {
    expect(
      toChartSpec(
        chart({
          type: "table",
          column_labels: [
            { column: "n", label: "Nombre" },
            { column: "bad col", label: "x" },
          ],
          column_formats: [
            { column: "n", format: "integer" },
            { column: "m", format: "auto" },
          ],
        })
      )
    ).toEqual({
      type: "table",
      labels: { n: "Nombre" },
      formats: { n: "integer" },
    });
  });
});
