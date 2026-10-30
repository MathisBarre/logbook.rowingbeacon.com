import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../_common/i18n/config";
import { BOM, buildCsv, csvFormatFor } from "./csv";
import type { QueryResult } from "../../types";

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

const ctx = (locale = "en-US") => ({
  t: i18n.getFixedT("fr-FR"),
  locale,
  seasonStartMonth: 8,
});

describe("buildCsv", () => {
  it("starts with a BOM and translated headers, keeps raw values", () => {
    const csv = buildCsv(
      {
        result: result(
          ["boat_name", "gender", "start_date", "km", "is_coached"],
          [
            ["Aiguillon", "female", "2025-08-04", 12.5, 1],
            ["Belle-Île", null, "2025-08-05", 1234.25, 0],
          ]
        ),
      },
      ctx()
    );
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Bateau,Sexe,Date de début,Kilomètres,Encadrée");
    expect(lines[1]).toBe("Aiguillon,female,2025-08-04,12.5,1");
    expect(lines[2]).toBe("Belle-Île,,2025-08-05,1234.25,0");
    expect(lines[3]).toBe("");
  });

  it("guards against formulas and quotes separators", () => {
    const csv = buildCsv(
      {
        result: result(
          ["comment", "n"],
          [
            ['=HYPERLINK("x")', -3],
            ['a, "b"\nc', 2],
          ]
        ),
      },
      ctx()
    );
    const body = csv.slice(1).split("\r\n");
    expect(body[1]).toBe(`"'=HYPERLINK(""x"")",-3`);
    expect(body[2]).toBe(`"a, ""b""\nc",2`);
  });

  it("uses the spec's labels and parameters in the header", () => {
    const csv = buildCsv(
      {
        result: result(["month", "value"], [[8, 3]]),
        spec: {
          type: "bar",
          x: "month",
          y: ["value"],
          orientation: "vertical",
          stacked: false,
          sort: "none",
          labelKeys: { value: "analytics.codes.measure.{measure}" },
        },
        params: { measure: "hours" },
      },
      ctx()
    );
    expect(csv.slice(1).split("\r\n")[0]).toBe("Mois,Heures sur l'eau");
  });
});

describe("CSV in the user's language", () => {
  it("uses ; and decimal commas for French, German, Italian and Dutch", () => {
    for (const locale of ["fr-FR", "de-DE", "it-IT", "nl-NL", "fr"]) {
      expect(csvFormatFor(locale)).toEqual({ separator: ";", decimal: "," });
    }
    for (const locale of ["en-US", "en-GB"]) {
      expect(csvFormatFor(locale)).toEqual({ separator: ",", decimal: "." });
    }
  });

  it("writes a French file Excel opens in columns", () => {
    const csv = buildCsv(
      {
        result: result(
          ["boat_name", "km", "n", "comment"],
          [
            ["Aiguillon", 12.5, 3, "a; b"],
            ["Belle-Île, la grande", 1234.25, -2, "=SUM(A1)"],
            ["Ré", null, 0, 'dit "oui"'],
          ]
        ),
      },
      ctx("fr-FR")
    );
    const lines = csv.slice(1).split("\r\n");
    expect(csv.startsWith(BOM)).toBe(true);
    expect(lines[0].split(";")).toHaveLength(4);
    expect(lines[1]).toBe('Aiguillon;12,5;3;"a; b"');
    // A comma needs no quotes with ;, the formula guard stays.
    expect(lines[2]).toBe("Belle-Île, la grande;1234,25;-2;'=SUM(A1)");
    expect(lines[3]).toBe('Ré;;0;"dit ""oui"""');
  });
});
