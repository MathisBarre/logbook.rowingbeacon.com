import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import i18n from "../../../_common/i18n/config";
import { buildWorkbook, excelSerial, uniqueSheetName } from "./xlsx";
import type { QueryResult } from "../../types";

const result = (names: string[], rows: QueryResult["rows"]): QueryResult => ({
  columns: names.map((name) => ({ name, declType: null })),
  rows,
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
});

/** What the tests read of a cell. */
interface Cell {
  t?: string;
  v?: unknown;
  f?: string;
}

const originalTz = process.env.TZ;
beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const ctx = () => ({
  t: i18n.getFixedT("fr-FR"),
  locale: "fr-FR",
  seasonStartMonth: 8,
});

describe("uniqueSheetName", () => {
  it("cleans, cuts to 31 characters and de-duplicates", () => {
    const used = new Set<string>();
    const long = "Bateaux les plus utilisés de la saison 2025/2026 [top]";
    const a = uniqueSheetName(long, used);
    const b = uniqueSheetName(long, used);
    expect(a.length).toBeLessThanOrEqual(31);
    expect(b.length).toBeLessThanOrEqual(31);
    expect(a).not.toMatch(/[[\]:*?/\\]/);
    expect(b).not.toBe(a);
    expect(b.endsWith("(2)")).toBe(true);
    expect(uniqueSheetName("", used)).toBe("Feuille");
  });
});

describe.each(["America/Los_Angeles", "Pacific/Auckland"])(
  "buildWorkbook under TZ=%s",
  (zone) => {
    beforeAll(() => {
      process.env.TZ = zone;
    });

    it("types numbers, builds dates from local components and translates codes", () => {
      const bytes = buildWorkbook(
        [
          {
            name: "Synthèse",
            header: ["Indicateur", "Valeur"],
            rows: [
              ["Sorties", 3412],
              ["Note", null],
            ],
          },
          {
            name: "Sorties par mois",
            result: result(
              [
                "month",
                "gender",
                "start_date",
                "start_at",
                "km",
                "is_coached",
                "comment",
              ],
              [
                [
                  8,
                  "female",
                  "2025-08-04",
                  "2025-08-04T18:30",
                  12.5,
                  1,
                  "=1+1",
                ],
                [1, "unknown", "2026-01-01", null, 3, 0, null],
              ]
            ),
          },
        ],
        ctx()
      );
      const wb = XLSX.read(bytes, { type: "array" });
      expect(wb.SheetNames).toEqual(["Synthèse", "Sorties par mois"]);
      const cell = (sheet: string, ref: string) =>
        wb.Sheets[sheet][ref] as Cell | undefined;
      expect(cell("Synthèse", "B2")?.t).toBe("n");
      expect(cell("Synthèse", "B2")?.v).toBe(3412);

      const ws = (ref: string) => cell("Sorties par mois", ref);
      expect(ws("A1")?.v).toBe("Mois");
      expect(ws("A2")?.v).toBe("août");
      expect(ws("B2")?.v).toBe("Femme");
      expect(ws("B3")?.v).toBe("Non renseigné");
      expect(ws("C2")?.t).toBe("n");
      expect(ws("C2")?.v).toBe(excelSerial(2025, 8, 4));
      expect(ws("C2")?.v).toBe(45873);
      expect(ws("D2")?.t).toBe("n");
      expect(ws("D2")?.v).toBeCloseTo(45873 + 18.5 / 24, 6);
      expect(ws("D3")).toBeUndefined();
      expect(ws("E2")?.t).toBe("n");
      expect(ws("E2")?.v).toBe(12.5);
      expect(ws("F2")?.v).toBe("oui");
      expect(ws("G2")?.t).toBe("s");
      expect(ws("G2")?.v).toBe("=1+1");
      expect(ws("G2")?.f).toBeUndefined();
    });
  }
);

describe("buildWorkbook", () => {
  it("writes a valid file without sheets", () => {
    const wb = XLSX.read(buildWorkbook([], ctx()), { type: "array" });
    expect(wb.SheetNames).toHaveLength(1);
  });
});
