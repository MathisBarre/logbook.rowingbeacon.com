import { describe, expect, it } from "vitest";
import { checkSql } from "./sqlGuard";
import cases from "./engine-cases.json";

interface EngineCase {
  sql: string;
  expect: string;
  paramNames?: string[];
  offset?: number;
  cleaned?: string;
  note?: string;
}

describe("checkSql (engine-cases.json, shared with the Rust lexer)", () => {
  it("has at least 40 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(cases as EngineCase[])("$sql → $expect", (testCase) => {
    const result = checkSql(testCase.sql);
    if (testCase.expect === "ok") {
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      if (testCase.paramNames) {
        expect(result.paramNames).toEqual(testCase.paramNames);
      }
      if (testCase.cleaned !== undefined) {
        expect(result.sql).toBe(testCase.cleaned);
      }
    } else {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(testCase.expect);
      if (testCase.offset !== undefined) {
        expect(result.error.offset).toBe(testCase.offset);
      }
    }
  });

  it("returns the text unchanged when there is no trailing semicolon", () => {
    const sql = "SELECT boat_name\nFROM v_boats -- all\n";
    expect(checkSql(sql)).toEqual({
      ok: true,
      sql: sql.trimEnd(),
      paramNames: [],
    });
  });
});
