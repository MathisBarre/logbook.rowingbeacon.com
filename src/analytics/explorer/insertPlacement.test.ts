import { describe, expect, it } from "vitest";
import { planInsert } from "./insertPlacement";

const apply = (sql: string, plan: ReturnType<typeof planInsert>) =>
  sql.slice(0, plan.from) + plan.insert + sql.slice(plan.to);

/** Inserts at the "|" of `text` (no "|": cursor not placed). */
const insertAt = (
  text: string,
  value: string,
  kind: "column" | "object" | "filter"
) => {
  const pos = text.indexOf("|");
  const sql = pos === -1 ? text : text.slice(0, pos) + text.slice(pos + 1);
  const plan = planInsert(
    sql,
    pos === -1 ? null : { from: pos, to: pos },
    value,
    kind
  );
  const result = apply(sql, plan);
  expect(result.slice(plan.mark.from, plan.mark.to)).toBe(value);
  return result;
};

const QUERY =
  "SELECT route_name, COUNT(*) AS n\nFROM v_routes\nGROUP BY route_name\nORDER BY n";

describe("planInsert", () => {
  it("adds a column to the end of the SELECT list while the cursor is not placed (review 11)", () => {
    expect(insertAt(QUERY, "distance_km", "column")).toBe(
      "SELECT route_name, COUNT(*) AS n, distance_km\nFROM v_routes\nGROUP BY route_name\nORDER BY n"
    );
  });

  it("adds the comma a column needs inside the SELECT list", () => {
    expect(insertAt("SELECT boat_name| FROM v_boats", "seats", "column")).toBe(
      "SELECT boat_name, seats FROM v_boats"
    );
    expect(insertAt("SELECT | FROM v_boats", "seats", "column")).toBe(
      "SELECT seats FROM v_boats"
    );
    // Elsewhere, no comma, but a space between words.
    expect(insertAt("SELECT * FROM v_boats WHERE|", "seats", "column")).toBe(
      "SELECT * FROM v_boats WHERE seats"
    );
  });

  it("puts a filter in the WHERE, before GROUP BY, when the cursor is not placed (review 50)", () => {
    expect(
      insertAt(
        "SELECT season, COUNT(*) FROM v_outings\nWHERE is_rowing = 1\nGROUP BY season",
        "counts_in_stats = 1",
        "filter"
      )
    ).toBe(
      "SELECT season, COUNT(*) FROM v_outings\nWHERE is_rowing = 1\nAND counts_in_stats = 1\nGROUP BY season"
    );
    expect(
      insertAt("SELECT * FROM v_outings", "season = :season", "filter")
    ).toBe("SELECT * FROM v_outings\nWHERE season = :season");
  });

  it("adds AND after a condition at the cursor, nothing after WHERE", () => {
    expect(
      insertAt(
        "SELECT * FROM v_outings WHERE season = 2025|",
        "is_rowing = 1",
        "filter"
      )
    ).toBe("SELECT * FROM v_outings WHERE season = 2025 AND is_rowing = 1");
    expect(
      insertAt("SELECT * FROM v_outings WHERE |", "is_rowing = 1", "filter")
    ).toBe("SELECT * FROM v_outings WHERE is_rowing = 1");
  });

  it("appends an object name on a new line when the cursor is not placed", () => {
    expect(insertAt("SELECT *\nFROM", "v_boats", "object")).toBe(
      "SELECT *\nFROM\nv_boats"
    );
    expect(insertAt("SELECT * FROM |", "v_boats", "object")).toBe(
      "SELECT * FROM v_boats"
    );
  });
});
