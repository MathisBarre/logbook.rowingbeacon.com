import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { sql, SQLite } from "@codemirror/lang-sql";
import { getDictionary } from "../schema/dictionary";
import {
  buildCompletionSchema,
  completeSql,
  CompletionSchema,
  findReferences,
  isInStringOrComment,
  sqlCompletionSource,
  tokenize,
} from "./sqlCompletion";

const schema: CompletionSchema = buildCompletionSchema(
  getDictionary().objects,
  null,
  {
    columnLabel: (column) => (column === "season" ? "Saison" : null),
    objectInfo: (object) => object.description,
    semanticLabel: (semantic) => semantic,
    functionInfo: () => undefined,
  }
);

/** Completes at the "|" of `text`. */
const at = (text: string, explicit = false) => {
  const pos = text.indexOf("|");
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  return completeSql(doc, pos, schema, explicit);
};

const labels = (text: string, explicit = false) =>
  [...(at(text, explicit)?.options ?? [])]
    .sort((a, b) => b.boost - a.boost)
    .map((option) => option.label);

describe("tokenize and references", () => {
  it("skips strings and comments", () => {
    const tokens = tokenize(
      "SELECT 'FROM x' -- FROM y\n/* JOIN z */ FROM v_boats"
    );
    expect(tokens.map((t) => t.value)).toEqual([
      "SELECT",
      "'",
      "FROM",
      "V_BOATS",
    ]);
  });

  it("finds FROM lists, JOINs, aliases and CTEs", () => {
    const refs = findReferences(
      `WITH recent AS (SELECT * FROM v_outings WHERE season = :season), x(a) AS (VALUES (1))
       SELECT * FROM recent r, v_boats AS b
       LEFT JOIN v_routes ON 1 = 1
       JOIN "v_outing_rowers" orw USING (outing_id)
       WHERE b.seats > 1`
    );
    expect(refs.ctes).toEqual(["recent", "x"]);
    expect(refs.objects).toEqual([
      { name: "v_outings", alias: null },
      { name: "recent", alias: "r" },
      { name: "v_boats", alias: "b" },
      { name: "v_routes", alias: null },
      { name: "v_outing_rowers", alias: "orw" },
    ]);
  });

  it("knows when the cursor is inside a string or a comment", () => {
    const text = "SELECT 'a' , 'b -- c' -- d\n, x /* y */";
    expect(isInStringOrComment(text, text.indexOf("a"))).toBe(true);
    expect(isInStringOrComment(text, text.indexOf(","))).toBe(false);
    expect(isInStringOrComment(text, text.indexOf("c'"))).toBe(true);
    expect(isInStringOrComment(text, text.indexOf("d"))).toBe(true);
    expect(isInStringOrComment(text, text.indexOf("x"))).toBe(false);
    expect(isInStringOrComment(text, text.indexOf("y"))).toBe(true);
  });
});

describe("completeSql", () => {
  it("suggests views first, then tables, after FROM and JOIN", () => {
    for (const text of [
      "SELECT * FROM |",
      "SELECT * FROM v_|",
      "SELECT * FROM a JOIN |",
    ]) {
      const result = labels(text, true);
      expect(result[0].startsWith("v_")).toBe(true);
      const firstTable = result.indexOf("boat");
      const lastView = Math.max(
        ...result.map((l, i) => (l.startsWith("v_") ? i : -1))
      );
      expect(firstTable).toBeGreaterThan(lastView);
      // No column after FROM.
      expect(result).not.toContain("boat_name");
    }
  });

  it("suggests objects after a comma of a FROM list only", () => {
    expect(labels("SELECT * FROM v_boats, |", true)).toContain("v_outings");
    expect(labels("SELECT a, |", true)).toContain("season");
    expect(labels("SELECT a, | FROM v_boats", true)).toContain("seats");
  });

  it("offers the columns of the objects in FROM / JOIN, then :params, never views", () => {
    const result = labels(
      "SELECT | FROM v_boats b JOIN v_routes r ON 1 = 1 WHERE season = :season",
      true
    );
    const seats = result.indexOf("seats");
    const routeName = result.indexOf("route_name");
    const param = result.indexOf(":season");
    expect(seats).toBeGreaterThanOrEqual(0);
    expect(routeName).toBeGreaterThanOrEqual(0);
    expect(param).toBeGreaterThan(Math.max(seats, routeName));
    // Columns of objects not in the query are not offered, nor objects.
    expect(result).not.toContain("start_weekday");
    expect(result.some((l) => l.startsWith("v_"))).toBe(false);
    expect(result).not.toContain("boat");
    // Aliases are offered.
    expect(result).toContain("b");
  });

  it("offers the FROM object's columns first, not the views (review 12)", () => {
    const result = labels("SELECT | FROM v_outings", true);
    expect(result[0]).not.toMatch(/^v_/);
    expect(result).toContain("boat_name");
    expect(result).not.toContain("v_boats");
    // After GROUP BY, never the raw table "boat".
    const grouped = labels("SELECT * FROM v_outings GROUP BY boat|");
    expect(grouped).toContain("boat_name");
    expect(grouped).not.toContain("boat");
  });

  it("offers every view column once when no object is named yet, v_outings first", () => {
    const result = labels("SELECT sea|", true);
    expect(result.filter((l) => l === "season")).toHaveLength(1);
    const all = at("SELECT |", true)?.options ?? [];
    const top = [...all].sort((a, b) => b.boost - a.boost)[0];
    expect(top.detail?.startsWith("v_outings")).toBe(true);
    // Views come after the columns; raw tables never.
    const sorted = labels("SELECT |", true);
    expect(sorted.indexOf("v_outings")).toBeGreaterThan(
      sorted.indexOf("boat_name")
    );
    expect(sorted).not.toContain("outing_crew");
  });

  it("offers a short list of keywords, last, from two letters", () => {
    const result = labels("SELECT * FROM v_boats WHERE seats > 1 GR|");
    expect(result).toContain("GROUP BY");
    for (const noise of ["BOOL", "BOTH", "ABORT", "BOOLEAN"]) {
      expect(result).not.toContain(noise);
    }
    const one = labels("SELECT * FROM v_boats WHERE s|");
    expect(one.some((l) => l === "SELECT")).toBe(false);
    const ordered = labels("SELECT * FROM v_boats WHERE se|");
    expect(ordered.indexOf("seats")).toBeLessThan(ordered.indexOf("SELECT"));
  });

  it("completes the columns of an alias or an object after a dot", () => {
    expect(labels("SELECT b.| FROM v_boats b")).toContain("boat_class");
    expect(labels("SELECT b.| FROM v_boats b")).not.toContain("route_name");
    expect(labels("SELECT v_routes.dis| FROM v_routes")).toContain(
      "distance_km"
    );
    expect(at("SELECT zz.| FROM v_routes")).toBeNull();
  });

  it("suggests the parameters used, then the usual ones, after ':'", () => {
    const result = at(
      "SELECT * FROM v_outings WHERE boat_id = :boat_id AND season = :|"
    );
    expect(result?.from).toBe(
      "SELECT * FROM v_outings WHERE boat_id = :boat_id AND season = ".length
    );
    const sorted = labels(
      "SELECT * FROM v_outings WHERE boat_id = :my_boat AND season = :|"
    );
    expect(sorted[0]).toBe(":my_boat");
    expect(sorted).toContain(":season");
    expect(sorted).toContain(":rower_id");
  });

  it("stays quiet in strings, in comments and on whitespace", () => {
    expect(at("SELECT 'v_|'")).toBeNull();
    expect(at("SELECT 1 -- v_|")).toBeNull();
    expect(at("SELECT |")).toBeNull();
    expect(at("SELECT |", true)).not.toBeNull();
  });

  it("replaces the whole word around the cursor", () => {
    const result = at("SELECT bo|at_na FROM v_boats");
    expect(result?.from).toBe("SELECT ".length);
    expect(result?.to).toBe("SELECT boat_na".length);
  });

  it("only offers objects that exist in this database", () => {
    const limited = buildCompletionSchema(
      getDictionary().objects,
      { views: ["v_boats"], tables: ["boat"], missingViews: ["v_damages"] },
      {
        columnLabel: () => null,
        objectInfo: () => "",
        semanticLabel: (s) => s,
        functionInfo: () => undefined,
      }
    );
    const result = completeSql("SELECT * FROM ", 14, limited, true);
    expect(result?.options.map((o) => o.label)).toEqual(["v_boats", "boat"]);
  });
});

describe("sqlCompletionSource", () => {
  it("works as a CodeMirror source", async () => {
    const state = EditorState.create({
      doc: "SELECT  FROM v_outings",
      extensions: [sql({ dialect: SQLite })],
    });
    const source = sqlCompletionSource(() => schema);
    const result = await source(new CompletionContext(state, 7, true));
    expect(
      result?.options.some((o) => o.label === "season" && o.type === "property")
    ).toBe(true);
    const fn = result?.options.find((o) => o.label === "COUNT");
    expect(fn?.type).toBe("function");
    const keyword = result?.options.find((o) => o.label === "GROUP BY");
    expect(keyword?.type).toBe("keyword");
  });
});
