import { describe, expect, it } from "vitest";
import { tidySql } from "./sqlFormat";

describe("tidySql", () => {
  it("puts each clause and each top-level condition on its own line", () => {
    expect(
      tidySql(
        "select boat_name, count(*) as n from v_outings where season = :season and is_rowing = 1 group by boat_name order by n desc limit 10"
      )
    ).toBe(
      [
        "SELECT boat_name, COUNT(*) AS n",
        "FROM v_outings",
        "WHERE season = :season",
        "  AND is_rowing = 1",
        "GROUP BY boat_name",
        "ORDER BY n DESC",
        "LIMIT 10",
      ].join("\n")
    );
  });

  it("keeps strings, quoted names and comments as written", () => {
    const tidy = tidySql(
      "select 'from x and y' as \"where\" -- keep me\nfrom v_boats b left join v_outings o on o.boat_id = b.boat_id"
    );
    expect(tidy).toContain("'from x and y'");
    expect(tidy).toContain('"where"');
    expect(tidy).toContain("-- keep me");
    expect(tidy).toContain("\nLEFT JOIN v_outings o ON o.boat_id = b.boat_id");
    expect(tidy.split("\n").filter((l) => l.startsWith("JOIN"))).toEqual([]);
  });

  it("does not split BETWEEN … AND, nor conditions inside parentheses", () => {
    expect(
      tidySql(
        "select * from v_outings where start_hour between 6 and 9 and (season = 2025 or season = 2024)"
      )
    ).toBe(
      [
        "SELECT *",
        "FROM v_outings",
        "WHERE start_hour BETWEEN 6 AND 9",
        "  AND (season = 2025 OR season = 2024)",
      ].join("\n")
    );
  });

  it("indents a subquery", () => {
    expect(
      tidySql(
        "select * from (select boat_id from v_outings where season = 2025) t"
      )
    ).toBe(
      [
        "SELECT *",
        "FROM (SELECT boat_id",
        "  FROM v_outings",
        "  WHERE season = 2025) t",
      ].join("\n")
    );
  });

  it("leaves an empty text alone", () => {
    expect(tidySql("")).toBe("");
  });
});
