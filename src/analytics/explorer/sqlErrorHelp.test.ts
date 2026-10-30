import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../_common/i18n/config";
import "../i18n";
import { AnalyticsError } from "../engine/errors";
import { getDictionary } from "../schema/dictionary";
import { buildCompletionSchema } from "./sqlCompletion";
import { editDistance, explainSqlError, nearestNames } from "./sqlErrorHelp";

const schema = buildCompletionSchema(getDictionary().objects, null, {
  columnLabel: () => null,
  objectInfo: () => "",
  semanticLabel: (s) => s,
  functionInfo: () => undefined,
});

beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});

const explain = (sql: string, message: string, offset?: number) => {
  const t = i18n.getFixedT("fr-FR");
  return explainSqlError(
    new AnalyticsError({ code: "syntax", message, offset }, { sql }),
    sql,
    schema,
    t,
    "fr-FR"
  );
};

/** The SQL once a suggestion is applied. */
const fixed = (sql: string, help: ReturnType<typeof explain>, index = 0) => {
  const { from, to, text } = help.suggestions[index].replace;
  return sql.slice(0, from) + text + sql.slice(to);
};

describe("explainSqlError", () => {
  it("measures edits and finds the nearest names", () => {
    expect(editDistance("LIMT", "LIMIT")).toBe(1);
    expect(
      nearestNames("v_outing", ["v_outings", "v_boats", "v_outing_rowers"])
    ).toEqual(["v_outings"]);
    expect(nearestNames("seat", ["seats", "seat", "sets", "x"])).toEqual([
      "seats",
      "sets",
    ]);
  });

  it("spots a keyword typo before the word SQLite names (review 27)", () => {
    const sql =
      "SELECT boat_name, COUNT(*) AS n\nFROM v_outings\nGROUP BY boat_name\nLIMT 10";
    const help = explain(sql, 'near "10": syntax error', sql.indexOf("10"));
    expect(help.message).toBe(
      "Ligne 4 : « LIMT » n'est pas un mot SQL : vouliez-vous dire LIMIT ?"
    );
    expect(help.range).toEqual({
      from: sql.indexOf("LIMT"),
      to: sql.indexOf("LIMT") + 4,
    });
    expect(help.suggestions[0].label).toBe("Corriger en LIMIT");
    expect(fixed(sql, help)).toContain("\nLIMIT 10");
    expect(help.detail).toBe('near "10": syntax error');
  });

  it("does not take a column or an alias for a typo", () => {
    const sql = "SELECT seats sets FROM v_boats WHERE";
    const help = explain(sql, "incomplete input");
    expect(help.message).toContain("s'arrête trop tôt");
    const other = explain(
      "SELECT boat_name boat FROM v_boats ORDER",
      'near "ORDER": syntax error'
    );
    expect(other.suggestions).toEqual([]);
    expect(other.message).toContain("juste avant « ORDER »");
  });

  it("offers the nearest views for an unknown table", () => {
    const sql = "SELECT * FROM v_outing_boats";
    const help = explain(sql, "no such table: v_outing_boats");
    expect(help.message).toBe(
      "La vue ou table « v_outing_boats » n'existe pas."
    );
    expect(help.suggestions.map((s) => s.label)).toContain(
      "Remplacer par v_outings"
    );
    expect(help.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("offers the FROM object's columns for an unknown column", () => {
    const sql = "SELECT boat FROM v_outings GROUP BY boat";
    const help = explain(sql, "no such column: boat");
    expect(help.message).toBe(
      "La colonne « boat » n'existe pas dans v_outings."
    );
    expect(help.range).toEqual({ from: 7, to: 11 });
    expect(help.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of help.suggestions) {
      expect(suggestion.replace.text).toMatch(/^[a-z_]+$/);
    }
  });

  it("explains ambiguous names and aggregates in WHERE", () => {
    expect(
      explain(
        "SELECT boat_id FROM v_outings o JOIN v_boats b ON 1",
        "ambiguous column name: boat_id"
      ).message
    ).toContain("par exemple o.boat_id");
    expect(
      explain(
        "SELECT boat_id FROM v_outings WHERE COUNT(*) > 2",
        "misuse of aggregate: COUNT()"
      ).message
    ).toContain("HAVING");
  });

  it("keeps SQLite's other messages as a technical detail", () => {
    const help = explain("SELECT 1", "something odd", 3);
    expect(help.message).toBe("Erreur dans la requête, ligne 1, colonne 4.");
    expect(help.detail).toBe("something odd");
  });

  it("reassures on a refused write and says where a parameter goes", () => {
    const t = i18n.getFixedT("fr-FR");
    const write = explainSqlError(
      new AnalyticsError({ code: "not_read_only", message: "x" }),
      "DELETE FROM outing",
      schema,
      t
    );
    expect(write.tone).toBe("info");
    expect(write.message).toContain("rien n'a été modifié");
    const missing = explainSqlError(
      new AnalyticsError({
        code: "missing_param",
        message: "x",
        object: "depuis",
      }),
      "SELECT 1 WHERE :depuis",
      schema,
      t
    );
    expect(missing.message).toBe(
      "Donnez une valeur à :depuis dans « Paramètres », sous l'éditeur."
    );
  });
});
