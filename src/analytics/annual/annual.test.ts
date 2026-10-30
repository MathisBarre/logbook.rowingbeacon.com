import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import i18n from "../../_common/i18n/config";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import {
  FIXTURE_NOW,
  FIXTURE_ROWERS,
  insertFixtureClub,
} from "../reports/testing/fixtureClub";
import { ANNUAL_REPORT_SECTIONS } from "../reports/annual";
import { resolveParams } from "../params/resolveParams";
import type { EngineObjects, QueryResult, SqlValue } from "../types";
import { planAnnualReport } from "./AnnualReportPage";
import {
  AnnualSectionInput,
  annualTable,
  buildAnnualDocument,
  buildAnnualXlsxInput,
  isAnnualEmpty,
  prepareAnnualReport,
  PreparedAnnualReport,
} from "./annualDocument";
import {
  buildAnnualHtml,
  escapeCssString,
  escapeHtml,
  sanitizeSvg,
} from "./annualHtml";
import { annualSheets, buildAnnualWorkbook } from "./annualXlsx";

const ALL_MODULES = [
  "distances",
  "outingTypes",
  "memberProfile",
  "guests",
  "damages",
];
const SEASON = 2025;

let testDb: AnalyticsTestDb;
let objects: EngineObjects;
let inputs: AnnualSectionInput[];

const ctx = () => ({
  t: i18n.t.bind(i18n),
  locale: "fr-FR",
  seasonStartMonth: 8,
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#2a78d6"/></svg>`;

const result = (columns: string[], rows: SqlValue[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, declType: null })),
  rows,
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
});

/** Intl's narrow and no-break spaces as plain ones. */
const plainSpaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

const prepare = (list = inputs, season = SEASON) =>
  prepareAnnualReport(list, ctx(), season);

/** The inputs with one section's result replaced. */
const withResult = (
  id: string,
  value: QueryResult | null
): AnnualSectionInput[] =>
  inputs.map((input) =>
    input.id === id
      ? { ...input, result: value, status: value ? "success" : "error" }
      : input
  );

const svgsOf = (report: PreparedAnnualReport) =>
  Object.fromEntries(
    report.sections
      .filter((section) => section.kind === "chart")
      .map((section) => [section.key, SVG])
  );

beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
  await insertFixtureClub(testDb.db, { withDamages: true });
  const engine = testDb.engine({ now: FIXTURE_NOW });
  objects = await engine.objects();
  await i18n.changeLanguage("fr-FR");
  const plan = planAnnualReport(SEASON, objects, ALL_MODULES);
  inputs = [];
  for (const [index, entry] of plan.entries()) {
    const resolved = resolveParams(entry.report.params, entry.paramValues, {
      now: FIXTURE_NOW,
      seasonStartMonth: 8,
    });
    const run = await engine.run({
      requestId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sql: entry.report.sql,
      params: resolved.values,
      maxRows: 5000,
      timeoutMs: 20_000,
      privacy: "nominative",
      now: FIXTURE_NOW,
      useCache: false,
    });
    inputs.push({
      key: entry.key,
      id: entry.section.id,
      spec: entry.spec,
      params: resolved.values,
      status: "success",
      result: run,
    });
  }
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await i18n.changeLanguage("fr-FR");
});

describe("annual report plan", () => {
  it("keeps the order of plan 1.3 with every section available", () => {
    const plan = planAnnualReport(SEASON, objects, ALL_MODULES);
    expect(plan.map((entry) => entry.section)).toEqual(ANNUAL_REPORT_SECTIONS);
    expect(plan.every((entry) => entry.report.visibility === "public")).toBe(
      true
    );
    // The two month-by-month sections are told apart.
    expect(new Set(plan.map((entry) => entry.key)).size).toBe(plan.length);
  });

  it("omits sections whose module is off or whose data is missing", () => {
    const plan = planAnnualReport(
      SEASON,
      { ...objects, tables: objects.tables.filter((t) => t !== "incident") },
      []
    );
    const ids = plan.map((entry) => entry.section.reportId);
    expect(ids).not.toContain("outing-types");
    expect(ids).not.toContain("incidents-per-boat");
    expect(ids).toContain("season-overview");
  });

  it("waits for the engine's object list", () => {
    expect(planAnnualReport(SEASON, undefined, ALL_MODULES)).toEqual([]);
    expect(planAnnualReport(SEASON, null, ALL_MODULES).length).toBeGreaterThan(
      0
    );
  });

  it("limits the top sections to 10 rows and their charts too", () => {
    const plan = planAnnualReport(SEASON, objects, ALL_MODULES);
    const top = plan.find((e) => e.section.reportId === "boat-usage-ranking");
    expect(top?.spec).toMatchObject({ type: "bar", limit: 10 });
  });
});

describe("annual report content", () => {
  it("labels the two seasons and the coached share for a reader", () => {
    const report = prepare();
    const monthly = report.sections.find((s) => s.id === "outingsMonthly");
    expect(monthly?.spec).toMatchObject({
      labels: { value: "2025-2026", value_prev: "2024-2025" },
    });
    const overview = report.sections.find((s) => s.id === "overview");
    expect(overview?.spec).toMatchObject({
      labels: { coached_pct: "Part des sorties encadrées" },
    });
    expect(overview?.intro).toContain("même date");
  });

  it("titles a top list after the rows it shows", () => {
    const top = prepare().sections.find((s) => s.id === "topBoats");
    const shown = top?.result?.rows.length ?? 0;
    expect(shown).toBeGreaterThan(1);
    expect(shown).toBeLessThanOrEqual(10);
    expect(top?.title).toBe(`Les ${shown} bateaux les plus utilisés`);
  });

  it("draws the members' chart horizontally and explains the guests", () => {
    const overview = result(
      ["outings", "outings_prev", "active_rowers", "active_rowers_prev"],
      [[100, 90, 130, 120]]
    );
    const members = result(
      ["age_group", "gender", "active_rowers"],
      [
        ["adult", "F", 50],
        ["adult", "M", 38],
        ["youth", "F", 25],
      ]
    );
    const list = withResult("overview", overview).map((input) =>
      input.id === "demographics" ? { ...input, result: members } : input
    );
    const section = prepare(list).sections.find((s) => s.id === "demographics");
    expect(section?.spec).toMatchObject({ orientation: "horizontal" });
    expect(section?.notes).toContain(
      "113 membres du club parmi les 130 rameurs actifs ; les 17 invités ne sont pas comptés ici."
    );
  });

  it("does not compare the first season with an empty one", () => {
    const overview = result(
      ["outings", "outings_prev", "active_rowers", "active_rowers_prev"],
      [[100, 0, 30, 0]]
    );
    const monthly = result(
      ["month", "value", "value_prev"],
      [
        [8, 10, 0],
        [9, 12, null],
      ]
    );
    const list = withResult("overview", overview).map((input) =>
      input.id === "outingsMonthly" ? { ...input, result: monthly } : input
    );
    const report = prepare(list);
    expect(report.facts.firstSeason).toBe(true);
    const kpi = report.sections.find((s) => s.id === "overview");
    expect(
      kpi?.spec.type === "kpi" && kpi.spec.items.every((i) => !i.compare)
    ).toBe(true);
    expect(kpi?.notes[0]).toMatch(/^Première saison enregistrée/);
    expect(kpi?.intro).toBe("");
    const monthlySection = report.sections.find(
      (s) => s.id === "outingsMonthly"
    );
    expect(monthlySection?.spec).toMatchObject({ y: ["value"] });
    expect(monthlySection?.intro).toBe("Nombre de sorties chaque mois.");
    const html = buildAnnualHtml(
      buildAnnualDocument(ctx(), {
        season: SEASON,
        clubName: "",
        notes: "",
        generatedAt: new Date(2026, 2, 15),
        report,
      })
    );
    expect(html).not.toContain("En hausse");
    expect(html).not.toContain("Chaque chiffre est comparé");
  });

  it("notes the month in progress and the partial period", () => {
    const report = prepare();
    expect(report.facts.partialEnd).toBe("2026-03-15");
    const monthly = report.sections.find((s) => s.id === "outingsMonthly");
    expect(monthly?.notes).toContain(
      "Mars 2026 : mois en cours, données jusqu'au 15 mars 2026."
    );
    const doc = buildAnnualDocument(ctx(), {
      season: SEASON,
      clubName: "",
      notes: "",
      generatedAt: new Date(2026, 2, 15),
      report,
    });
    expect(doc.meta).toBe(
      "Période : du 1 août 2025 au 15 mars 2026 (saison en cours) · Édité le 15 mars 2026"
    );
  });

  it("keeps retention to the report's season and summarises it", () => {
    const retention = result(
      [
        "cohort",
        "seasons_after",
        "cohort_size",
        "still_active",
        "retention_pct",
      ],
      [
        [2023, 0, 20, 20, 100],
        [2023, 1, 20, 15, 75],
        [2023, 2, 20, 12, 60],
        [2024, 0, 10, 10, 100],
        [2024, 1, 10, 6, 60],
        [2025, 0, 8, 8, 100],
      ]
    );
    const list = withResult("retention", retention);
    const section = prepare(list, 2024).sections.find(
      (s) => s.id === "retention"
    );
    expect(section?.result?.rows.map((row) => [row[0], row[1]])).toEqual([
      [2023, "Arrivée"],
      [2023, "+1 saison"],
      [2024, "Arrivée"],
    ]);
    expect(section?.notes.map(plainSpaces)).toEqual([
      "10 nouveaux rameurs en 2024-2025 ; 75 % des arrivés de 2023-2024 sont revenus cette saison.",
      "La première saison de l'historique regroupe tous les membres déjà présents.",
    ]);
  });

  it("counts every incident, not only the top 10", () => {
    const incidents = result(
      ["boat_name", "incidents"],
      Array.from({ length: 12 }, (_, i) => [`Bateau ${i}`, 1])
    );
    const section = prepare(withResult("incidents", incidents)).sections.find(
      (s) => s.id === "incidents"
    );
    expect(section?.result?.rows).toHaveLength(10);
    expect(section?.notes).toEqual(["12 incidents déclarés sur 12 bateaux."]);
  });

  it("leaves out empty and failed sections, keeps good news", () => {
    const zeros = result(["boat_class", "outings_per_boat"], [["4x", 0]]);
    expect(
      isAnnualEmpty(
        {
          type: "bar",
          x: "boat_class",
          y: ["outings_per_boat"],
          orientation: "vertical",
          stacked: false,
          sort: "desc",
        },
        zeros
      )
    ).toBe(true);
    const list = withResult("fleet", zeros)
      .map((input) =>
        input.id === "incidents"
          ? { ...input, result: result(["boat_name", "incidents"], []) }
          : input
      )
      .map((input) =>
        input.id === "routes"
          ? { ...input, status: "error" as const, result: null }
          : input
      );
    const report = prepare(list);
    const kinds = Object.fromEntries(
      report.sections.map((section) => [section.id, section.kind])
    );
    expect(kinds).toMatchObject({
      fleet: "omitted",
      incidents: "goodNews",
      routes: "error",
      overview: "kpi",
      outingsMonthly: "chart",
    });
    const html = buildAnnualHtml(
      buildAnnualDocument(ctx(), {
        season: SEASON,
        clubName: "",
        notes: "",
        generatedAt: new Date(2026, 2, 15),
        report,
      })
    );
    expect(html).toContain("Aucun incident déclaré pendant la saison.");
    expect(html).not.toContain('data-section="fleet"');
    expect(html).not.toContain('data-section="routes"');
    expect(html).not.toContain("Aucune donnée");
    const sheets = annualSheets(
      buildAnnualXlsxInput(ctx(), {
        season: SEASON,
        clubName: "",
        notes: "",
        generatedAt: new Date(2026, 2, 15),
        report,
      })
    ).map((sheet) => sheet.name);
    expect(sheets).not.toContain("Flotte");
    expect(sheets).not.toContain("Parcours");
    expect(sheets).not.toContain("Incidents");
  });

  it("orders table rows like the chart and aligns labels left", () => {
    const fleet = prepare().sections.find((s) => s.id === "fleet");
    if (!fleet) throw new Error("fleet expected");
    const table = annualTable(fleet, ctx());
    const values = (table?.rows ?? []).map((row) =>
      Number(row[1].replace(/\s/g, "").replace(",", "."))
    );
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(table?.numeric).toEqual([false, true]);
  });
});

describe("annual HTML", () => {
  const build = (clubName = "Aviron de Test", notes = "", logo = "") => {
    const report = prepare();
    return buildAnnualHtml(
      buildAnnualDocument(ctx(), {
        season: SEASON,
        clubName,
        notes,
        logo,
        generatedAt: new Date(2026, 2, 15, 12, 0),
        report,
        svgs: svgsOf(report),
      })
    );
  };

  it("is self-contained: no script, no external resource", () => {
    const html = build();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link|<img|<iframe|@import|src=/i);
    expect(html).toContain("<style>");
    expect(html).toContain("size: A4");
    expect(html).toContain('counter(page) " / " counter(pages)');
  });

  it("shows the logo as a data image only", () => {
    const logo = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(build("Club", "", logo)).toContain(
      `<img class="logo" alt="" src="${logo}">`
    );
    expect(build("Club", "", "https://example.org/x.png")).not.toMatch(
      /<img|https?:/
    );
  });

  it("shows the cover, the chapters, every printed section and the appendix", () => {
    const html = build();
    expect(html).toContain("Aviron de Test");
    expect(html).toContain("Rapport annuel d&#39;activité");
    expect(html).toContain("Saison 2025-2026");
    expect(html).toContain("Édité le 15 mars 2026");
    expect(html).not.toMatch(/généré le/i);
    for (const chapter of ["L&#39;activité", "Les rameurs", "La flotte"]) {
      expect(html).toContain(`<h2>${chapter}</h2>`);
    }
    expect(html).toContain("<h2>Chiffres clés</h2>");
    expect(html).toContain("<h3>Sorties par mois</h3>");
    expect(html).toContain("Annexe : les chiffres détaillés");
    expect(html).toContain("<caption>Sorties par mois</caption>");
    expect(html).toContain("Définitions");
    expect(html).toContain("Généré par Rowing Beacon");
    expect(html).toContain("Pour obtenir un PDF");
    // The appendix comes after the narrative.
    expect(html.indexOf("<table")).toBeGreaterThan(html.indexOf("Définitions"));
  });

  it("shows the key figures as the app does, and the charts", () => {
    const html = build();
    expect(html).toContain('class="kpi"');
    expect(html).toMatch(/class="trend (good|bad|neutral)"/);
    expect(plainSpaces(html)).toMatch(/En (hausse|baisse) [+-]\d+ %|Stable/);
    // Last season's figure, worded by the chart kit's own string.
    const previous = i18n.t("analytics.charts.kpi.previous", { value: "@@" });
    expect(plainSpaces(html)).toContain(previous.split("@@")[0]);
    expect(html).toContain("<figure><svg");
    expect(html).toContain('class="num"');
    expect(html).not.toContain("Saison choisie");
  });

  it("never shows a member's name", () => {
    const html = build();
    for (const rower of FIXTURE_ROWERS) {
      expect(html).not.toContain(`${rower.firstName} ${rower.lastName}`);
      if (rower.lastName.length > 3) {
        expect(html).not.toContain(rower.lastName);
      }
    }
  });

  it("escapes the club name and the comment, keeping paragraphs", () => {
    const html = build(
      '<b>Club</b> & "Co"\\',
      "Une belle saison.\n\nMerci aux <bénévoles> !"
    );
    expect(html).toContain("&lt;b&gt;Club&lt;/b&gt; &amp; &quot;Co&quot;");
    expect(html).toContain(
      "<p>Une belle saison.</p><p>Merci aux &lt;bénévoles&gt; !</p>"
    );
    expect(html).toContain("Le mot du club");
    // The running footer cannot leave its CSS string nor the <style>.
    expect(html).not.toContain("<b>Club");
    expect(escapeCssString('a"b\\c\nd</style>')).toBe(
      'a\\"b\\\\c d\\3C /style\\3E '
    );
  });

  it("works without a club name", () => {
    const html = build("");
    expect(html).toContain("Période : du 1 août 2025 au 15 mars 2026");
    expect(html).not.toContain('class="club"');
  });

  it("strips scripts, handlers and links from chart SVGs", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">' +
      '<script>alert(1)</script><a href="https://evil.example"><rect fill="url(https://x/y)" onclick=\'x()\'/></a>' +
      '<use href="#ok"/><rect fill="url(#grad)"/><foreignObject><div>x</div></foreignObject></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|onclick|https?:|foreignObject/i);
    expect(clean).toContain('href="#ok"');
    expect(clean).toContain("url(#grad)");
    expect(escapeHtml("<a>")).toBe("&lt;a&gt;");
  });
});

describe("annual Excel", () => {
  const input = () =>
    buildAnnualXlsxInput(ctx(), {
      season: SEASON,
      clubName: "Aviron de Test",
      notes: "Bilan",
      generatedAt: new Date(2026, 2, 15),
      report: prepare(),
    });

  it("puts the summary first, then one short-named sheet per chart", () => {
    const sheets = annualSheets(input());
    expect(sheets[0].name).toBe("Synthèse");
    const names = sheets.slice(1).map((sheet) => sheet.name);
    expect(names).not.toContain("Chiffres clés");
    expect(names.slice(0, 2)).toEqual(["Sorties par mois", "Types de sortie"]);
    const summary = sheets[0];
    if (!("header" in summary)) throw new Error("summary sheet expected");
    expect(summary.header[0]).toBe("Rapport annuel d'activité");
    expect(summary.rows.slice(0, 5)).toEqual([
      ["Club", "Aviron de Test"],
      ["Saison", "2025-2026"],
      ["Période", "du 1 août 2025 au 15 mars 2026 (saison en cours)"],
      ["Édité le", "15 mars 2026"],
      ["Le mot du club", "Bilan"],
    ]);
    expect(summary.rows).toContainEqual([
      "Indicateur",
      "2025-2026",
      "2024-2025",
      "Évolution (%)",
    ]);
    // Key figures keep their numbers, with the change.
    const outings = summary.rows.find((row) => row[0] === "Sorties");
    expect(typeof outings?.[1]).toBe("number");
    expect(typeof outings?.[3] === "number" || outings?.[3] === null).toBe(
      true
    );
    const coached = summary.rows.find(
      (row) => row[0] === "Part des sorties encadrées"
    );
    if (coached) expect(coached[3]).toBeNull();
    expect(summary.rows).toContainEqual(["Contenu"]);
  });

  it("writes a workbook Excel can read, with the seasons as headers", () => {
    const data = buildAnnualWorkbook(input(), ctx());
    const workbook = XLSX.read(data, { type: "array" });
    expect(workbook.SheetNames[0]).toBe("Synthèse");
    expect(new Set(workbook.SheetNames).size).toBe(workbook.SheetNames.length);
    expect(workbook.SheetNames.every((name) => name.length <= 31)).toBe(true);
    const monthly = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets["Sorties par mois"],
      { header: 1 }
    );
    expect(monthly[0]).toEqual(["Mois", "2025-2026", "2024-2025"]);
  });
});
