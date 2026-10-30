import { describe, expect, it } from "vitest";
import { AnalyticsError } from "../engine/errors";
import { checkSql } from "../engine/sqlGuard";
import { errorRange } from "./errorRange";

const error = (
  code: AnalyticsError["code"],
  extra: { offset?: number; object?: string } = {}
) => new AnalyticsError({ code, message: "x", ...extra });

describe("errorRange", () => {
  it("underlines the word at a syntax error offset, with line and column", () => {
    const sql = "SELECT boat_name\nFROM v_boats\nWHER seats > 1";
    const range = errorRange(
      error("syntax", { offset: sql.indexOf("WHER") }),
      sql
    );
    expect(range).toEqual({
      from: sql.indexOf("WHER"),
      to: sql.indexOf("WHER") + 4,
      line: 3,
      column: 1,
    });
  });

  it("underlines one character on a symbol and the last one at the end", () => {
    const sql = "SELECT 1 +";
    expect(errorRange(error("syntax", { offset: 9 }), sql)).toMatchObject({
      from: 9,
      to: 10,
    });
    expect(
      errorRange(error("syntax", { offset: sql.length }), sql + "  \n")
    ).toMatchObject({
      from: 9,
      to: 10,
    });
  });

  it("underlines an unterminated string to the end of its line", () => {
    const sql = "SELECT 'abc\nFROM x";
    const checked = checkSql(sql);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    const range = errorRange(new AnalyticsError(checked.error), sql);
    expect(range).toMatchObject({ from: 7, to: 11, line: 1, column: 8 });
  });

  it("finds the second statement of multiple statements", () => {
    const sql = "SELECT 1;\n  DELETE FROM outing";
    const checked = checkSql(sql);
    if (checked.ok) throw new Error("expected an error");
    expect(errorRange(new AnalyticsError(checked.error), sql)).toMatchObject({
      line: 2,
      column: 3,
      to: sql.indexOf("DELETE") + 6,
    });
  });

  it("finds a denied table or column outside strings", () => {
    const sql = "SELECT 'setting', email\nFROM rower JOIN setting";
    expect(
      errorRange(error("denied", { object: "setting" }), sql)
    ).toMatchObject({
      line: 2,
      column: 17,
    });
    expect(
      errorRange(error("denied", { object: "rower.email" }), sql)
    ).toMatchObject({
      from: sql.indexOf("email"),
    });
    expect(errorRange(error("denied", { object: "nowhere" }), sql)).toBeNull();
  });

  it("finds a parameter and the first word of a write", () => {
    const sql = "SELECT * FROM v_outings WHERE season = :season";
    expect(
      errorRange(error("missing_param", { object: "season" }), sql)
    ).toMatchObject({
      from: sql.indexOf(":season"),
      to: sql.length,
    });
    expect(errorRange(error("not_read_only"), "  PRAGMA x")).toMatchObject({
      from: 2,
      to: 8,
    });
  });

  it("has no range for errors without a place", () => {
    expect(errorRange(error("timeout"), "SELECT 1")).toBeNull();
    expect(errorRange(error("syntax", { offset: 0 }), "")).toBeNull();
  });

  it("counts columns in UTF-16 units like the engine", () => {
    const sql = "SELECT 'é🚣' AS x FRM v";
    const offset = sql.indexOf("FRM");
    expect(errorRange(error("syntax", { offset }), sql)).toMatchObject({
      column: offset + 1,
    });
  });
});
