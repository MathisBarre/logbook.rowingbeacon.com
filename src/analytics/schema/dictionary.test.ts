import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import {
  codeValues,
  columnClass,
  getDictionary,
  getObject,
  isPersonalClass,
} from "./dictionary";
import { VIEW_BLOCKS } from "./views";

const DENIED = [
  "setting",
  "efa_record",
  "change_log",
  "session",
  "session_rowers",
  "migration",
  "analytics_query",
  "analytics_dashboard_item",
  "boat_level_config",
  // Holder names, contacts and reasons are not classified yet: reservation
  // statistics are a later step (A-FAIRE-PLUS-TARD.md, Statistiques).
  "boat_reservation",
  "sqlite_master",
];

let testDb: AnalyticsTestDb;
beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
});
afterAll(async () => {
  await testDb.cleanup();
});

describe("dictionary.json", () => {
  it("parses and has unique object and column names", () => {
    const names = getDictionary().objects.map((object) => object.name);
    expect(new Set(names).size).toBe(names.length);
    for (const object of getDictionary().objects) {
      const columns = object.columns.map((column) => column.name);
      expect(new Set(columns).size, object.name).toBe(columns.length);
    }
  });

  it("lists no denied table", () => {
    for (const name of DENIED) {
      expect(getObject(name), name).toBeUndefined();
    }
  });

  it("documents every view of views.sql, with the same requirements", () => {
    const views = getDictionary().objects.filter((o) => o.kind === "view");
    expect(views.map((view) => view.name).sort()).toEqual(
      VIEW_BLOCKS.map((block) => block.name).sort()
    );
    for (const block of VIEW_BLOCKS) {
      expect(getObject(block.name)?.requires, block.name).toEqual(
        block.requires
      );
      expect(getObject(block.name)?.level).toBe("simple");
    }
  });

  it("classifies every migrated column of every base table it lists", async () => {
    const tables = getDictionary().objects.filter((o) => o.kind === "table");
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.level, table.name).toBe("advanced");
      const migrated = await testDb.db.select<{ name: string; type: string }[]>(
        `SELECT name, type FROM pragma_table_info('${table.name}')`
      );
      expect(migrated.length, `${table.name} exists`).toBeGreaterThan(0);
      expect(
        table.columns.map((column) => column.name).sort(),
        table.name
      ).toEqual(migrated.map((column) => column.name).sort());
    }
  });

  it("lists every migrated club table that is not denied", async () => {
    const rows = await testDb.db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    for (const { name } of rows) {
      if (!DENIED.includes(name)) {
        expect(getObject(name)?.kind, name).toBe("table");
      }
    }
  });

  it("classifies the privacy columns of plan 2.4", () => {
    for (const column of [
      "email",
      "phone",
      "address",
      "license_number",
      "note",
    ]) {
      expect(columnClass("rower", column)).toBe("contact");
    }
    for (const column of ["first_name", "last_name", "birth_date"]) {
      expect(columnClass("rower", column)).toBe("personal");
    }
    expect(columnClass("outing", "comment")).toBe("freeText");
    expect(columnClass("incident", "message")).toBe("freeText");
    expect(columnClass("boat_damage", "description")).toBe("freeText");
    expect(columnClass("boat_damage", "repair_note")).toBe("freeText");
    expect(columnClass("boat", "note")).toBe("freeText");
    expect(columnClass("route", "note")).toBe("freeText");
    expect(columnClass("outing", "boat_id")).toBe("public");
    expect(columnClass("rower", "unknown_column")).toBeNull();
    expect(columnClass("setting", "value")).toBeNull();
    expect(isPersonalClass(columnClass("v_rowers", "display_name"))).toBe(true);
  });

  it("gives code values", () => {
    expect(codeValues("gender")).toEqual(["female", "male", "other"]);
    expect(codeValues("severity", "v_damages")).toEqual([
      "usable",
      "limited",
      "unusable",
    ]);
    expect(codeValues("boat_name")).toEqual([]);
  });
});
