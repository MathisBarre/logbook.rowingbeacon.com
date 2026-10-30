import { describe, expect, test } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import { SqlClient } from "../database/sqlClient";
import {
  insertOuting,
  loadOuting,
  OutingToSave,
  saveRoute,
  updateOuting,
} from "../database/repositories/club.repository";
import { OutingDraft } from "../../logbook/business/EditOuting/outingDraft";
import { readFinishedOutingDraft } from "../../logbook/business/EditOuting/loadOutingDraft";
import { readFixtureProject } from "./__fixtures__/readFixtureProject";
import { runEfa2Import } from "./runEfa2Import";
import { buildEfa2Export } from "./buildEfa2Export";
import { deriveEfa2Id } from "./planEfa2Import";
import { EFA2_FOREVER } from "./efa2Values";
import {
  Efa2Project,
  findObject,
  findObjects,
  readEfa2ProjectFromZip,
  writeEfa2BackupZip,
} from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";

/**
 * Round-trip properties of the efa2 export of imported outings after a
 * correction of their route or date. Every case starts from a fresh import
 * of the efa TestClub fixture, corrects outings through the editor's real
 * path (readFinishedOutingDraft, then updateOuting) and compares the export
 * with the export of the untouched club.
 */

const importLabels = {
  externalBoatNote: "Bateau extérieur importé d'efa",
  statusGroupPrefix: "Statut : ",
  closedOpenOutingNote: "Restée ouverte dans efa.",
};
const exportLabels = {
  statuses: { member: "Membre", guest: "Invité", other: "Autre" },
  defaultProjectName: "Mon club",
  boathouseName: "Hangar",
};
const now = new Date("2026-10-19T12:00:00Z");
const LONG = 240_000;

const fixture = readFixtureProject();

const importProject = async (
  project: Efa2Project = fixture,
  at: Date = now
) => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  await runEfa2Import(db, structuredClone(project), {
    backup: () => Promise.resolve(),
    labels: importLabels,
    now: at,
  });
  return db;
};

const exportOf = async (db: SqlClient, at: Date = now) =>
  (await buildEfa2Export(db, { labels: exportLabels, now: at })).project;

// ----- Snapshots and diffs -----

const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : v
  );

interface Snapshot {
  /** "logbook|EntryId" -> entry */
  entries: Map<string, Efa2Fields>;
  /** "type|name" -> canonical JSON of the object's records, logbooks apart */
  objects: Map<string, string>;
  logbookNames: string[];
  projectRecords: string;
}

const snapshot = (project: Efa2Project): Snapshot => {
  const entries = new Map<string, Efa2Fields>();
  const objects = new Map<string, string>();
  const logbookNames: string[] = [];
  for (const object of project.objects) {
    if (object.type === "efa2logbook") {
      logbookNames.push(object.name);
      for (const entry of object.records) {
        entries.set(`${object.name}|${entry.EntryId}`, entry);
      }
    } else {
      objects.set(`${object.type}|${object.name}`, canon(object.records));
    }
  }
  return {
    entries,
    objects,
    logbookNames: logbookNames.sort(),
    projectRecords: canon(project.projectRecords),
  };
};

const changedFields = (a: Efa2Fields, b: Efa2Fields) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => a[key] !== b[key])
    .sort();

interface Diff {
  /** entries present on both sides under the same key, with fields that differ */
  changed: Record<string, string[]>;
  removed: string[];
  added: string[];
  /** non-logbook objects whose records differ */
  objects: string[];
  projectRecordsChanged: boolean;
}

const diff = (before: Snapshot, after: Snapshot): Diff => {
  const changed: Record<string, string[]> = {};
  for (const [key, entry] of after.entries) {
    const previous = before.entries.get(key);
    if (!previous) continue;
    const fields = changedFields(previous, entry);
    if (fields.length > 0) changed[key] = fields;
  }
  return {
    changed,
    removed: [...before.entries.keys()]
      .filter((key) => !after.entries.has(key))
      .sort(),
    added: [...after.entries.keys()]
      .filter((key) => !before.entries.has(key))
      .sort(),
    objects: [...new Set([...before.objects.keys(), ...after.objects.keys()])]
      .filter((key) => before.objects.get(key) !== after.objects.get(key))
      .sort(),
    projectRecordsChanged: before.projectRecords !== after.projectRecords,
  };
};

const NOTHING: Diff = {
  changed: {},
  removed: [],
  added: [],
  objects: [],
  projectRecordsChanged: false,
};

// ----- Invariants any export must satisfy -----

const checkInvariants = (project: Efa2Project) => {
  const problems: string[] = [];
  const logbooks = findObjects(project, "efa2logbook");
  const entryAt = new Map<string, Efa2Fields>();
  for (const logbook of logbooks) {
    const seen = new Set<string>();
    for (const entry of logbook.records) {
      if (seen.has(entry.EntryId)) {
        problems.push(`duplicate EntryId ${logbook.name}|${entry.EntryId}`);
      }
      seen.add(entry.EntryId);
      entryAt.set(`${logbook.name}|${entry.EntryId}`, entry);
    }
  }
  // Every logbook file is listed in the project file and the other way round.
  const listed = project.projectRecords
    .filter((r) => r.Type === "Logbook")
    .map((r) => r.Name)
    .sort();
  if (canon(listed) !== canon(logbooks.map((l) => l.name).sort())) {
    problems.push(
      `logbooks listed ${listed.join(",")} vs files ${logbooks
        .map((l) => l.name)
        .join(",")}`
    );
  }
  // Boat status and open entries point at each other.
  const statuses = findObject(project, "efa2boatstatus")?.records ?? [];
  const pointed = new Set<string>();
  for (const status of statuses) {
    if (status.CurrentStatus !== "ONTHEWATER") continue;
    const key = `${status.Logbook}|${status.EntryNo}`;
    const entry = entryAt.get(key);
    if (!entry) {
      problems.push(`status of ${status.BoatText} points at missing ${key}`);
      continue;
    }
    if (entry.Open !== "true") {
      problems.push(`status of ${status.BoatText} points at closed ${key}`);
    }
    const sameBoat =
      entry.BoatId === status.BoatId ||
      (!entry.BoatId && entry.BoatName === status.BoatText);
    if (!sameBoat) {
      problems.push(
        `status of ${status.BoatText} points at another boat ${key}`
      );
    }
    pointed.add(key);
  }
  for (const [key, entry] of entryAt) {
    if (entry.Open === "true" && !pointed.has(key)) {
      problems.push(`open entry ${key} has no ONTHEWATER status`);
    }
  }
  // Destinations referenced by entries exist.
  const destinationIds = new Set(
    (findObject(project, "efa2destinations")?.records ?? []).map((r) => r.Id)
  );
  for (const [key, entry] of entryAt) {
    if (entry.DestinationId && !destinationIds.has(entry.DestinationId)) {
      problems.push(`entry ${key} has an unknown destination`);
    }
  }
  return problems;
};

// ----- Corrections through the editor's path -----

const keyOf = (logbook: string, entryId: string | number) =>
  `${logbook}|${entryId}`;
const outingIdOf = (logbook: string, entryId: string | number) =>
  deriveEfa2Id(`outing:${logbook}:${entryId}`);

const draftOf = async (db: SqlClient, id: string): Promise<OutingDraft> => {
  const finished = await readFinishedOutingDraft(db, id);
  if (finished) return finished;
  // Ongoing: what the editor shows for it.
  const outing = (await loadOuting(db, id))!;
  return {
    id,
    boatId: outing.boatId,
    boatConfigurationId: outing.boatConfigurationId,
    routeId: outing.routeId,
    outingTypeCode: outing.outingTypeCode,
    rowerIds: outing.crew
      .filter((m) => m.role === "rower")
      .map((m) => m.rowerId),
    coxId: outing.crew.find((m) => m.role === "cox")?.rowerId ?? null,
    captainRowerId: outing.captainRowerId,
    startDateTime: outing.startDateTime,
    estimatedEndDateTime: outing.estimatedEndDateTime,
    endDateTime: null,
    distanceM: outing.distanceM,
    comment: outing.comment,
    hasBeenCoached: outing.hasBeenCoached,
  };
};

/** Built like SaveOutingUsecase builds the OutingToSave of a correction. */
const correct = async (
  db: SqlClient,
  id: string,
  patch: Partial<OutingDraft> | ((draft: OutingDraft) => Partial<OutingDraft>)
) => {
  const draft = await draftOf(db, id);
  const next = {
    ...draft,
    ...(typeof patch === "function" ? patch(draft) : patch),
  };
  const outing: OutingToSave = {
    id,
    boatId: next.boatId,
    boatConfigurationId: next.boatConfigurationId,
    routeId: next.routeId,
    outingTypeCode: next.outingTypeCode,
    captainRowerId: next.captainRowerId,
    startDateTime: next.startDateTime,
    estimatedEndDateTime: next.estimatedEndDateTime,
    endDateTime: next.endDateTime,
    distanceM: next.distanceM,
    comment: next.comment,
    hasBeenCoached: next.hasBeenCoached,
    crew: [
      ...next.rowerIds.map((rowerId) => ({
        rowerId,
        role: "rower" as const,
      })),
      ...(next.coxId ? [{ rowerId: next.coxId, role: "cox" as const }] : []),
    ],
  };
  const finished = draft.endDateTime !== null;
  const saved = await updateOuting(db, outing, {
    onlyIfFinished: finished,
    onlyIfOngoing: !finished,
  });
  expect(saved).toBe(true);
};

// ----- Dates -----

const shiftDays = (local: string, days: number) => {
  const date = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.toISOString().slice(0, 10)}${local.slice(10)}`;
};
const shiftYears = (local: string, years: number) =>
  `${Number(local.slice(0, 4)) + years}${local.slice(4)}`;
const shiftMinutes = (local: string, minutes: number) => {
  const date = new Date(`${local}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
};
const efaDate = (local: string) =>
  `${local.slice(8, 10)}.${local.slice(5, 7)}.${local.slice(0, 4)}`;

/** The whole outing (start and end) moved by the same delta. */
const movedBy =
  (shift: (local: string) => string) =>
  (draft: OutingDraft): Partial<OutingDraft> => ({
    startDateTime: shift(draft.startDateTime),
    endDateTime: draft.endDateTime ? shift(draft.endDateTime) : null,
    estimatedEndDateTime: draft.estimatedEndDateTime
      ? shift(draft.estimatedEndDateTime)
      : null,
  });

// ----- The club's finished and ongoing outings, as efa numbered them -----

interface Imported {
  logbook: string;
  entryId: string;
  id: string;
  entry: Efa2Fields;
}

const baselineProject = async (project: Efa2Project = fixture) =>
  exportOf(await importProject(project));

const importedOf = (project: Efa2Project): Imported[] =>
  findObjects(project, "efa2logbook").flatMap((logbook) =>
    logbook.records.map((entry) => ({
      logbook: logbook.name,
      entryId: entry.EntryId,
      id: outingIdOf(logbook.name, entry.EntryId),
      entry,
    }))
  );

let cachedBaseline: Promise<{ project: Efa2Project; snap: Snapshot }> | null =
  null;
const baseline = () => {
  cachedBaseline ??= baselineProject().then((project) => ({
    project,
    snap: snapshot(project),
  }));
  return cachedBaseline;
};

const ongoing = (item: Imported) => item.entry.Open === "true";

const routeFields = [
  "DestinationVariantName",
  "WatersIdList",
  "WatersNameList",
] as const;

/**
 * The stamp a correction leaves: ChangeCount is always efa's own count plus
 * one, so an entry the plain export already rewrote (efa's free names turned
 * into records) has it before the correction.
 */
const STAMP = ["ChangeCount", "LastModified"];
const rawEntryOf = (item: Imported) =>
  findObjects(fixture, "efa2logbook")
    .find((l) => l.name === item.logbook)!
    .records.find((e) => e.EntryId === item.entryId)!;
const stampOf = (item: Imported) => [
  "LastModified",
  ...(item.entry.ChangeCount === rawEntryOf(item).ChangeCount
    ? ["ChangeCount"]
    : []),
];

// ----- Re-import -----

const outingTuples = async (db: SqlClient) => {
  const outings = await db.select<Record<string, unknown>[]>(
    "SELECT id, boat_id, route_id, start_date_time, end_date_time, distance_m, comment, captain_rower_id, outing_type_code FROM outing"
  );
  const crew = await db.select<
    { outing_id: string; rower_id: string; role: string; position: number }[]
  >("SELECT outing_id, rower_id, role, position FROM outing_crew");
  return outings
    .map((outing) =>
      canon({
        ...outing,
        id: undefined,
        crew: crew
          .filter((m) => m.outing_id === outing.id)
          .map((m) => `${m.role}:${m.rower_id}:${m.position}`)
          .sort(),
      })
    )
    .sort();
};

const expectReimportsToSameClub = async (
  db: SqlClient,
  project: Efa2Project,
  at: Date = now
) => {
  const again = await importProject(
    readEfa2ProjectFromZip(writeEfa2BackupZip(project, at.getTime())),
    at
  );
  expect(await outingTuples(again)).toEqual(await outingTuples(db));
  const routes = async (client: SqlClient) =>
    (
      await client.select<{ id: string; name: string; archived: number }[]>(
        "SELECT id, name, archived_at IS NOT NULL AS archived FROM route ORDER BY id"
      )
    ).map((r) => canon(r));
  expect(await routes(again)).toEqual(await routes(db));
};

// ----- Routes -----

interface RouteRow {
  id: string;
  name: string;
  distance_m: number | null;
  note: string | null;
  archived_at: string | null;
}
const routesOf = (db: SqlClient) =>
  db.select<RouteRow[]>("SELECT * FROM route ORDER BY name");
const save = (db: SqlClient, route: RouteRow, patch: Partial<RouteRow>) => {
  const next = { ...route, ...patch };
  return saveRoute(db, {
    id: next.id,
    name: next.name,
    distanceM: next.distance_m,
    note: next.note,
    archivedAt: next.archived_at ?? undefined,
  });
};

describe("sanity", () => {
  test("two exports of the same import are identical and satisfy the invariants", async () => {
    const { project, snap } = await baseline();
    expect(checkInvariants(project)).toEqual([]);
    expect(diff(snap, snapshot(await baselineProject()))).toEqual(NOTHING);
    expect(importedOf(project).length).toBe(57);
  });
});

describe("a route renamed, added or archived leaves every entry alone", () => {
  test(
    "renaming each route in turn changes the destinations file only",
    async () => {
      const { snap } = await baseline();
      const routeCount = (await routesOf(await importProject())).length;
      expect(routeCount).toBeGreaterThan(10);
      for (let index = 0; index < routeCount; index++) {
        const db = await importProject();
        const route = (await routesOf(db))[index];
        await save(db, route, { name: `${route.name} (renommée)` });
        const project = await exportOf(db);
        expect([route.name, diff(snap, snapshot(project))]).toEqual([
          route.name,
          { ...NOTHING, objects: ["efa2destinations|destinations"] },
        ]);
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test("renaming every route at once changes the destinations file only", async () => {
    const { snap } = await baseline();
    const db = await importProject();
    for (const route of await routesOf(db)) {
      await save(db, route, { name: `Z ${route.name}` });
    }
    const project = await exportOf(db);
    expect(diff(snap, snapshot(project))).toEqual({
      ...NOTHING,
      objects: ["efa2destinations|destinations"],
    });
    await expectReimportsToSameClub(db, project);
  });

  test("renaming a route to another route's name keeps every entry", async () => {
    const { snap } = await baseline();
    const db = await importProject();
    const routes = await routesOf(db);
    // Every route takes the name of the next one: names are not identities.
    for (const [index, route] of routes.entries()) {
      await save(db, route, { name: routes[(index + 1) % routes.length].name });
    }
    expect(diff(snap, snapshot(await exportOf(db)))).toEqual({
      ...NOTHING,
      objects: ["efa2destinations|destinations"],
    });
  });

  test("new routes, even named like efa's destinations, leave every entry alone", async () => {
    const { snap } = await baseline();
    const db = await importProject();
    const names = new Set<string>();
    for (const route of await routesOf(db)) names.add(route.name);
    const typed = await db.select<{ name: string }[]>(
      "SELECT DISTINCT json_extract(fields, '$.DestinationName') AS name FROM efa_record WHERE json_extract(fields, '$.DestinationName') IS NOT NULL"
    );
    for (const { name } of typed) names.add(name);
    for (const { name } of await db.select<{ name: string }[]>(
      "SELECT DISTINCT json_extract(fields, '$.DestinationVariantName') AS name FROM efa_record WHERE json_extract(fields, '$.DestinationVariantName') IS NOT NULL"
    )) {
      names.add(name);
    }
    names.add("Nouvelle route");
    // Duplicates of existing names, with another case.
    for (const name of [...names]) names.add(name.toUpperCase());
    let n = 0;
    for (const name of names) {
      await saveRoute(db, {
        id: deriveEfa2Id(`new-route-${n++}`),
        name,
        distanceM: 1000,
      });
    }
    const project = await exportOf(db);
    const d = diff(snap, snapshot(project));
    expect(d).toEqual({
      ...NOTHING,
      objects: ["efa2destinations|destinations"],
    });
    expect(checkInvariants(project)).toEqual([]);
    await expectReimportsToSameClub(db, project);
  });

  test(
    "archiving each active route in turn leaves every entry alone",
    async () => {
      const { snap } = await baseline();
      const db0 = await importProject();
      const active = (await routesOf(db0)).filter((r) => !r.archived_at);
      for (const route of active) {
        const db = await importProject();
        await save(db, route, { archived_at: now.toISOString() });
        const project = await exportOf(db);
        expect([route.name, diff(snap, snapshot(project))]).toEqual([
          route.name,
          { ...NOTHING, objects: ["efa2destinations|destinations"] },
        ]);
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test("archiving every route, or restoring the archived ones, leaves every entry alone", async () => {
    const { snap } = await baseline();
    for (const archived of [true, false]) {
      const db = await importProject();
      for (const route of await routesOf(db)) {
        await save(db, route, {
          archived_at: archived ? now.toISOString() : null,
        });
      }
      const project = await exportOf(db);
      expect(diff(snap, snapshot(project))).toEqual({
        ...NOTHING,
        objects: ["efa2destinations|destinations"],
      });
      await expectReimportsToSameClub(db, project);
    }
  });

  test("renaming, adding and archiving routes, then correcting only a comment, changes that entry's stamp only", async () => {
    const { project: base, snap } = await baseline();
    const db = await importProject();
    for (const route of await routesOf(db)) {
      await save(db, route, {
        name: `${route.name} (bis)`,
        archived_at: route.archived_at ?? now.toISOString(),
      });
    }
    await saveRoute(db, { id: deriveEfa2Id("extra"), name: "Wehr Feudenheim" });
    // Entries with a variant or waters, a free-text destination, none at all.
    const items = importedOf(base).filter(
      (item) =>
        !ongoing(item) &&
        (item.entry.DestinationVariantName ||
          item.entry.WatersIdList ||
          item.entry.WatersNameList ||
          !item.entry.DestinationId ||
          item.entry.EntryId === "20")
    );
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) {
      await correct(db, item.id, { comment: "Corrigée" });
    }
    const d = diff(snap, snapshot(await exportOf(db)));
    expect(Object.keys(d.changed).sort()).toEqual(
      items.map((i) => keyOf(i.logbook, i.entryId)).sort()
    );
    for (const item of items) {
      const key = keyOf(item.logbook, item.entryId);
      expect([key, d.changed[key]]).toEqual([
        key,
        [...stampOf(item), "Comments"].sort(),
      ]);
    }
  });
});

describe("correcting the route of an outing", () => {
  const checkRouteChange = async (
    item: Imported,
    routeId: string | null,
    setup?: (db: SqlClient) => Promise<void>
  ) => {
    const { snap } = await baseline();
    const db = await importProject();
    await setup?.(db);
    // Already there: not a route change (see the same-route property).
    if (item.entry.DestinationId === (routeId ?? undefined)) return;
    await correct(db, item.id, { routeId });
    const project = await exportOf(db);
    const d = diff(snap, snapshot(project));
    const key = keyOf(item.logbook, item.entryId);
    const dropped = routeFields.filter((f) => item.entry[f] !== undefined);
    const expectedFields = [
      ...stampOf(item),
      ...dropped,
      ...(item.entry.DestinationId === (routeId ?? undefined)
        ? []
        : ["DestinationId"]),
    ].sort();
    expect([key, d]).toEqual([
      key,
      {
        ...NOTHING,
        changed: { [key]: expectedFields },
        // An ongoing boat's status loses efa's "on the water" text.
        objects: d.objects.every((o) => o.startsWith("efa2boatstatus|"))
          ? d.objects
          : [],
      },
    ]);
    const entry = findObjects(project, "efa2logbook")
      .find((l) => l.name === item.logbook)!
      .records.find((e) => e.EntryId === item.entryId)!;
    expect(entry.DestinationId).toBe(routeId ?? undefined);
    for (const field of routeFields) expect(entry[field]).toBeUndefined();
    expect(entry.ChangeCount).toBe(
      String(Number(rawEntryOf(item).ChangeCount) + 1)
    );
    expect(checkInvariants(project)).toEqual([]);
    return { db, project };
  };

  test(
    "to another route, for every outing: only the destination, its variant and waters and the stamp change",
    async () => {
      const { project: base } = await baseline();
      const db0 = await importProject();
      const active = (await routesOf(db0)).filter((r) => !r.archived_at);
      for (const item of importedOf(base)) {
        const other = active.find((r) => r.id !== item.entry.DestinationId)!;
        await checkRouteChange(item, other.id);
      }
    },
    LONG
  );

  test(
    "to an archived route, for every outing",
    async () => {
      const { project: base } = await baseline();
      const db0 = await importProject();
      const archived = (await routesOf(db0)).filter((r) => r.archived_at);
      for (const item of importedOf(base)) {
        const other = archived.find((r) => r.id !== item.entry.DestinationId)!;
        await checkRouteChange(item, other.id);
      }
    },
    LONG
  );

  test(
    "to none, for every outing",
    async () => {
      const { project: base } = await baseline();
      for (const item of importedOf(base)) {
        await checkRouteChange(item, null);
      }
    },
    LONG
  );

  test("from none to a route, for every outing without one", async () => {
    const { project: base } = await baseline();
    const items = importedOf(base).filter((i) => !i.entry.DestinationId);
    expect(items.length).toBeGreaterThan(0);
    const db0 = await importProject();
    const [route] = await routesOf(db0);
    for (const item of items) {
      await checkRouteChange(item, route.id);
    }
  });

  test("from none to a route drops the waters efa typed without a destination", async () => {
    const { project: base } = await baseline();
    const item = importedOf(base).find(
      (i) => !i.entry.DestinationId && !ongoing(i)
    )!;
    const { project } = await (async () => {
      const db = await importProject();
      await db.execute(
        "UPDATE efa_record SET fields = json_set(fields, '$.WatersNameList', 'Altrhein') WHERE rb_table = 'outing' AND rb_id = $1",
        [item.id]
      );
      const [route] = await routesOf(db);
      // Correcting something else keeps those waters.
      await correct(db, item.id, { comment: "Corrigée" });
      const kept = findObjects(await exportOf(db), "efa2logbook")
        .find((l) => l.name === item.logbook)!
        .records.find((e) => e.EntryId === item.entryId)!;
      expect(kept.WatersNameList).toBe("Altrhein");
      await correct(db, item.id, { routeId: route.id });
      return { project: await exportOf(db) };
    })();
    const entry = findObjects(project, "efa2logbook")
      .find((l) => l.name === item.logbook)!
      .records.find((e) => e.EntryId === item.entryId)!;
    expect(entry.WatersNameList).toBeUndefined();
  });

  test(
    "to the same route (a route-less edit) keeps variant, waters and destination, for every outing",
    async () => {
      const { project: base, snap } = await baseline();
      for (const item of importedOf(base)) {
        const db = await importProject();
        const stored = (await draftOf(db, item.id)).routeId;
        await correct(db, item.id, { routeId: stored });
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const key = keyOf(item.logbook, item.entryId);
        // Nothing changed: efa's own entry, or the one the plain export
        // already rewrote with only its save time new.
        const rewritten =
          item.entry.ChangeCount !== rawEntryOf(item).ChangeCount;
        expect([key, d.changed, d.removed, d.added, d.objects]).toEqual([
          key,
          rewritten ? { [key]: ["LastModified"] } : {},
          [],
          [],
          // An ongoing boat's status loses efa's "on the water" text.
          ongoing(item) ? d.objects : [],
        ]);
        expect(d.objects.every((o) => o.startsWith("efa2boatstatus|"))).toBe(
          true
        );
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test("an entry with a variant and waters keeps them when the route is renamed first, then changed back and forth", async () => {
    const { project: base, snap } = await baseline();
    const item = importedOf(base).find(
      (i) => i.entry.WatersIdList && i.entry.DestinationId
    )!;
    expect(item).toBeDefined();
    const db = await importProject();
    const original = (await draftOf(db, item.id)).routeId;
    const [route] = (await routesOf(db)).filter((r) => r.id !== original);
    await correct(db, item.id, { routeId: route.id });
    await correct(db, item.id, { routeId: original });
    const project = await exportOf(db);
    const entry = project.objects
      .find((o) => o.name === item.logbook)!
      .records.find((e) => e.EntryId === item.entryId)!;
    // Back on the route efa recorded: the stored outing is what it was, so
    // the entry has its variant and waters again.
    expect(entry.DestinationId).toBe(item.entry.DestinationId);
    expect(diff(snap, snapshot(project))).toEqual({
      ...NOTHING,
      changed: { [keyOf(item.logbook, item.entryId)]: stampOf(item).sort() },
    });
  });

  test("one outing to another route, every other outing then edited and reimported", async () => {
    const { project: base } = await baseline();
    const db = await importProject();
    const finished = importedOf(base).filter((i) => !ongoing(i));
    const routes = (await routesOf(db)).filter((r) => !r.archived_at);
    for (const [index, item] of finished.entries()) {
      await correct(db, item.id, {
        routeId: index % 4 === 0 ? null : routes[index % routes.length].id,
      });
    }
    const project = await exportOf(db);
    expect(checkInvariants(project)).toEqual([]);
    await expectReimportsToSameClub(db, project);
  });
});

describe("correcting the date of an outing", () => {
  const entryOf = (project: Efa2Project, logbook: string, entryId: string) =>
    findObjects(project, "efa2logbook")
      .find((l) => l.name === logbook)
      ?.records.find((e) => e.EntryId === entryId);

  test(
    "by a day within the same logbook, for every finished outing",
    async () => {
      const { project: base, snap } = await baseline();
      for (const item of importedOf(base).filter((i) => !ongoing(i))) {
        const db = await importProject();
        const draft = await draftOf(db, item.id);
        // 31 December and 1 January stay in their year.
        const days = draft.startDateTime.slice(5, 10) === "12-31" ? -1 : 1;
        await correct(
          db,
          item.id,
          movedBy((l) => shiftDays(l, days))
        );
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const key = keyOf(item.logbook, item.entryId);
        const dateFields = item.entry.EndDate ? ["Date", "EndDate"] : ["Date"];
        expect([key, d]).toEqual([
          key,
          {
            ...NOTHING,
            changed: { [key]: [...stampOf(item), ...dateFields].sort() },
          },
        ]);
        const entry = entryOf(project, item.logbook, item.entryId)!;
        expect(entry.Date).toBe(efaDate(shiftDays(draft.startDateTime, days)));
        expect(entry.SessionGroupId).toBe(item.entry.SessionGroupId);
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test(
    "to the other year's logbook, for every finished outing",
    async () => {
      const { project: base, snap } = await baseline();
      const nextId = { "2025": 26, "2026": 33 } as Record<string, number>;
      for (const item of importedOf(base).filter((i) => !ongoing(i))) {
        const db = await importProject();
        const years = item.logbook === "2025" ? 1 : -1;
        await correct(
          db,
          item.id,
          movedBy((l) => shiftYears(l, years))
        );
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const target = String(Number(item.logbook) + years);
        const movedKey = keyOf(target, nextId[item.logbook]);
        const key = keyOf(item.logbook, item.entryId);
        expect([key, d.removed, d.added, d.changed, d.objects]).toEqual([
          key,
          [key],
          [movedKey],
          {},
          [],
        ]);
        const moved = entryOf(project, target, String(nextId[item.logbook]))!;
        const expectedChanged = [
          ...stampOf(item),
          "Date",
          ...(String(nextId[item.logbook]) === item.entryId ? [] : ["EntryId"]),
          ...(item.entry.EndDate ? ["EndDate"] : []),
          ...(item.entry.SessionGroupId ? ["SessionGroupId"] : []),
        ].sort();
        expect([key, changedFields(item.entry, moved)]).toEqual([
          key,
          expectedChanged,
        ]);
        expect(moved.SessionGroupId).toBeUndefined();
        expect(moved.Date.slice(-4)).toBe(target);
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test("every 2025 outing to 2026 at once: new entry numbers follow each other, no collision", async () => {
    const { project: base, snap } = await baseline();
    const db = await importProject();
    const items = importedOf(base).filter((i) => i.logbook === "2025");
    for (const item of items) {
      await correct(
        db,
        item.id,
        movedBy((l) => shiftYears(l, 1))
      );
    }
    const project = await exportOf(db);
    expect(checkInvariants(project)).toEqual([]);
    const d = diff(snap, snapshot(project));
    expect(d.removed).toEqual(
      items.map((i) => keyOf("2025", i.entryId)).sort()
    );
    // 2026 had 25 entries: the 32 moved ones are 26 to 57.
    expect(d.added).toEqual(
      Array.from({ length: items.length }, (_, i) =>
        keyOf("2026", 26 + i)
      ).sort()
    );
    // The open entries of 2026 and their boats' status did not move.
    expect(d.changed).toEqual({});
    expect(d.objects).toEqual([]);
    const emptied = findObjects(project, "efa2logbook").find(
      (l) => l.name === "2025"
    );
    expect(emptied?.records).toEqual([]);
    await expectReimportsToSameClub(db, project);
  });

  test(
    "outings crossing in both directions at once get numbers in their own target",
    async () => {
      const { project: base, snap } = await baseline();
      const db = await importProject();
      const items = importedOf(base).filter((i) => !ongoing(i));
      for (const item of items) {
        await correct(
          db,
          item.id,
          movedBy((l) => shiftYears(l, item.logbook === "2025" ? 1 : -1))
        );
      }
      const project = await exportOf(db);
      expect(checkInvariants(project)).toEqual([]);
      const d = diff(snap, snapshot(project));
      // Ongoing entries 24 and 25 of 2026 stay, the rest of 2026 left.
      expect(d.removed.filter((k) => k.startsWith("2026|")).length).toBe(23);
      expect(d.removed.filter((k) => k.startsWith("2025|")).length).toBe(32);
      expect(d.added.filter((k) => k.startsWith("2026|")).length).toBe(32);
      expect(d.added.filter((k) => k.startsWith("2025|")).length).toBe(23);
      await expectReimportsToSameClub(db, project);
    },
    LONG
  );

  test("moved to a year without logbook creates it, listed in the project file", async () => {
    const { project: base, snap } = await baseline();
    const db = await importProject();
    const item = importedOf(base).find(
      (i) => i.logbook === "2026" && !ongoing(i)
    )!;
    const other = importedOf(base).find((i) => i.logbook === "2025")!;
    await correct(
      db,
      item.id,
      movedBy((l) => shiftYears(l, 1))
    );
    await correct(
      db,
      other.id,
      movedBy((l) => shiftYears(l, -1))
    );
    const project = await exportOf(db);
    expect(checkInvariants(project)).toEqual([]);
    expect(
      findObjects(project, "efa2logbook")
        .map((l) => l.name)
        .sort()
    ).toEqual(["2024", "2025", "2026", "2027"]);
    const record = project.projectRecords.find(
      (r) => r.Type === "Logbook" && r.Name === "2027"
    );
    expect(record).toMatchObject({
      StartDate: "01.01.2027",
      EndDate: "31.12.2027",
    });
    expect(entryOf(project, "2027", "1")?.Date.slice(-4)).toBe("2027");
    expect(entryOf(project, "2024", "1")?.Date.slice(-4)).toBe("2024");
    expect(diff(snap, snapshot(project)).projectRecordsChanged).toBe(true);
    await expectReimportsToSameClub(db, project);
  });

  test(
    "moved and moved back to the original date: efa's entry again, with a new stamp only",
    async () => {
      const { project: base, snap } = await baseline();
      for (const item of importedOf(base).filter((i) => !ongoing(i))) {
        const db = await importProject();
        const years = item.logbook === "2025" ? 1 : -1;
        await correct(
          db,
          item.id,
          movedBy((l) => shiftYears(l, years))
        );
        await correct(
          db,
          item.id,
          movedBy((l) => shiftYears(l, -years))
        );
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const key = keyOf(item.logbook, item.entryId);
        expect([key, d]).toEqual([
          key,
          {
            ...NOTHING,
            changed:
              item.entry.ChangeCount === rawEntryOf(item).ChangeCount
                ? {}
                : { [key]: ["LastModified"] },
          },
        ]);
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test("moved through three years and back to the original date", async () => {
    const { project: base, snap } = await baseline();
    const item = importedOf(base).find(
      (i) => i.entry.SessionGroupId && i.logbook === "2026"
    )!;
    const db = await importProject();
    for (const years of [1, 1, -2, -1, 0]) {
      // 2027, 2028 (new logbooks), then 2026 -> 2027 -> back
      await correct(db, item.id, (draft) => ({
        startDateTime: shiftYears(draft.startDateTime, years),
        endDateTime: shiftYears(draft.endDateTime!, years),
      }));
    }
    const project = await exportOf(db);
    const d = diff(snap, snapshot(project));
    // Moved twice to the other side of the original, then once to it.
    expect(checkInvariants(project)).toEqual([]);
    expect(d.removed.length).toBe(0 + (d.added.length ? 1 : 0));
  });

  test("moved, then the route changed: the entry keeps its new number and loses its waters", async () => {
    const { project: base } = await baseline();
    const item = importedOf(base).find(
      (i) =>
        i.entry.WatersIdList &&
        i.entry.DestinationId &&
        i.logbook === "2026" &&
        i.entry.EntryId === "19"
    )!;
    const db = await importProject();
    const [route] = (await routesOf(db)).filter(
      (r) => r.id !== item.entry.DestinationId && !r.archived_at
    );
    await correct(
      db,
      item.id,
      movedBy((l) => shiftYears(l, -1))
    );
    await correct(db, item.id, { routeId: route.id });
    const project = await exportOf(db);
    const moved = entryOf(project, "2025", "33")!;
    expect(moved.DestinationId).toBe(route.id);
    expect(moved.WatersIdList).toBeUndefined();
    expect(moved.WatersNameList).toBeUndefined();
    expect(moved.SessionGroupId).toBeUndefined();
    expect(entryOf(project, "2026", "19")).toBeUndefined();
    expect(checkInvariants(project)).toEqual([]);
  });

  test(
    "only the time, for every finished outing",
    async () => {
      const { project: base, snap } = await baseline();
      for (const item of importedOf(base).filter((i) => !ongoing(i))) {
        const db = await importProject();
        const draft = await draftOf(db, item.id);
        const startDay = draft.startDateTime.slice(0, 10);
        const endDay = draft.endDateTime!.slice(0, 10);
        const delta = [15, -15].find(
          (minutes) =>
            shiftMinutes(draft.startDateTime, minutes).slice(0, 10) ===
              startDay &&
            shiftMinutes(draft.endDateTime!, minutes).slice(0, 10) === endDay
        )!;
        await correct(
          db,
          item.id,
          movedBy((l) => shiftMinutes(l, delta))
        );
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const key = keyOf(item.logbook, item.entryId);
        expect([
          key,
          d.removed,
          d.added,
          d.objects,
          Object.keys(d.changed),
        ]).toEqual([key, [], [], [], [key]]);
        const fields = d.changed[key];
        expect(
          fields.filter((f) => !["StartTime", "EndTime", ...STAMP].includes(f))
        ).toEqual([]);
        expect(fields).toContain("StartTime");
        expect(checkInvariants(project)).toEqual([]);
      }
    },
    LONG
  );

  test("an outing made to cross midnight keeps its two dates through a re-import", async () => {
    const { project: base } = await baseline();
    const db = await importProject();
    const items = importedOf(base).filter(
      (i) => !ongoing(i) && !i.entry.EndDate
    );
    for (const item of items.slice(0, 10)) {
      await correct(db, item.id, (draft) => {
        const day = draft.startDateTime.slice(0, 10);
        return {
          startDateTime: `${day}T23:00`,
          endDateTime: `${shiftDays(draft.startDateTime, 1).slice(0, 10)}T00:30`,
        };
      });
    }
    const project = await exportOf(db);
    expect(checkInvariants(project)).toEqual([]);
    await expectReimportsToSameClub(db, project);
  });

  test("an outing made to cross midnight in a logbook's last night goes to the first day's logbook", async () => {
    const { project: base } = await baseline();
    const db = await importProject();
    const item = importedOf(base).find(
      (i) => i.logbook === "2025" && i.entryId === "32"
    )!;
    await correct(db, item.id, {
      startDateTime: "2025-12-31T23:00",
      endDateTime: "2026-01-01T00:30",
    });
    const project = await exportOf(db);
    const entry = entryOf(project, "2025", "32")!;
    expect(entry.Date).toBe("31.12.2025");
    expect(entry.StartTime).toBe("23:00:00");
    expect(entry.EndTime).toBe("00:30:00");
    await expectReimportsToSameClub(db, project);
  });
});

describe("an entry whose date is outside its logbook's dates", () => {
  // The 2025 logbook now ends on 30 June and the 2026 one starts on 1 February:
  // the second half of 2025 and January 2026 are in no logbook's dates.
  const narrowed = (() => {
    const project = structuredClone(fixture);
    for (const record of project.projectRecords) {
      if (record.Type === "Logbook" && record.Name === "2025") {
        record.EndDate = "30.06.2025";
      }
      if (record.Type === "Logbook" && record.Name === "2026") {
        record.StartDate = "01.02.2026";
      }
    }
    return project;
  })();
  const rangeOf = (logbook: string) =>
    logbook === "2025"
      ? ["2025-01-01", "2025-06-30"]
      : ["2026-02-01", "2026-12-31"];
  const isoOf = (entry: Efa2Fields) =>
    `${entry.Date.slice(6)}-${entry.Date.slice(3, 5)}-${entry.Date.slice(0, 2)}`;
  const outside = (items: Imported[]) =>
    items.filter((item) => {
      const [from, to] = rangeOf(item.logbook);
      return isoOf(item.entry) < from || isoOf(item.entry) > to;
    });

  test(
    "is untouched by the export itself, and by every kind of correction that keeps its date",
    async () => {
      const base = await baselineProject(narrowed);
      const snap = snapshot(base);
      const items = outside(importedOf(base));
      expect(items.length).toBeGreaterThan(10);
      expect(diff(snap, snapshot(await baselineProject(narrowed)))).toEqual(
        NOTHING
      );

      for (const item of items.filter((i) => !ongoing(i))) {
        for (const [label, patch] of [
          ["comment", { comment: "Corrigée" }],
          ["time", movedBy((l) => shiftMinutes(l, 5))],
          ["route", {}],
        ] as const) {
          const db = await importProject(narrowed);
          const [anyRoute] = await routesOf(db);
          await correct(
            db,
            item.id,
            label === "route"
              ? {
                  routeId: (await draftOf(db, item.id)).routeId
                    ? null
                    : anyRoute.id,
                }
              : patch
          );
          const project = await exportOf(db);
          const d = diff(snap, snapshot(project));
          const key = keyOf(item.logbook, item.entryId);
          expect([
            label,
            key,
            d.removed,
            d.added,
            Object.keys(d.changed),
          ]).toEqual([label, key, [], [], [key]]);
          expect(entryOf(project, item.logbook, item.entryId)?.Date).toBe(
            item.entry.Date
          );
        }
      }
    },
    LONG
  );

  const entryOf = (project: Efa2Project, logbook: string, entryId: string) =>
    findObjects(project, "efa2logbook")
      .find((l) => l.name === logbook)
      ?.records.find((e) => e.EntryId === entryId);

  test(
    "stays in its logbook when the date moves to another day no logbook covers",
    async () => {
      const base = await baselineProject(narrowed);
      const snap = snapshot(base);
      for (const item of outside(importedOf(base)).filter((i) => !ongoing(i))) {
        const db = await importProject(narrowed);
        const draft = await draftOf(db, item.id);
        const moved = shiftDays(draft.startDateTime, 1);
        const [from, to] = rangeOf(item.logbook);
        const day = moved.slice(0, 10);
        const sameYear = day.slice(0, 4) === item.logbook;
        const covered =
          rangeOf("2025").concat(rangeOf("2026")).length &&
          ((day >= "2025-01-01" && day <= "2025-06-30") ||
            (day >= "2026-02-01" && day <= "2026-12-31"));
        if (!sameYear || covered || (day >= from && day <= to)) continue;
        await correct(
          db,
          item.id,
          movedBy((l) => shiftDays(l, 1))
        );
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const key = keyOf(item.logbook, item.entryId);
        expect([key, d.removed, d.added, Object.keys(d.changed)]).toEqual([
          key,
          [],
          [],
          [key],
        ]);
      }
    },
    LONG
  );

  test("an entry moved into the dates of the other logbook goes there, with a new number", async () => {
    const base = await baselineProject(narrowed);
    const item = outside(importedOf(base)).find(
      (i) => i.logbook === "2025" && !ongoing(i) && !i.entry.EndDate
    )!;
    const db = await importProject(narrowed);
    await correct(
      db,
      item.id,
      movedBy((l) => `2026-03-15${l.slice(10)}`)
    );
    const project = await exportOf(db);
    expect(entryOf(project, item.logbook, item.entryId)).toBeUndefined();
    expect(entryOf(project, "2026", "26")).toMatchObject({
      Date: "15.03.2026",
      BoatId: item.entry.BoatId,
    });
    expect(checkInvariants(project)).toEqual([]);
  });

  test("open entries and their boats stay", async () => {
    const base = await baselineProject(narrowed);
    const snap = snapshot(base);
    for (const item of importedOf(base).filter(ongoing)) {
      const db = await importProject(narrowed);
      await correct(db, item.id, { comment: "Corrigée" });
      const project = await exportOf(db);
      const d = diff(snap, snapshot(project));
      expect(Object.keys(d.changed)).toEqual([
        keyOf(item.logbook, item.entryId),
      ]);
      expect(checkInvariants(project)).toEqual([]);
    }
  });
});

describe("ongoing outings and boat status pointers", () => {
  test("correcting the route of each ongoing outing keeps its entry open and its status pointing at it", async () => {
    const { project: base, snap } = await baseline();
    const open = importedOf(base).filter(ongoing);
    expect(open.length).toBe(2);
    for (const item of open) {
      const db = await importProject();
      const [route] = (await routesOf(db)).filter(
        (r) => r.id !== item.entry.DestinationId && !r.archived_at
      );
      await correct(db, item.id, { routeId: route.id });
      const project = await exportOf(db);
      expect(checkInvariants(project)).toEqual([]);
      const d = diff(snap, snapshot(project));
      const key = keyOf(item.logbook, item.entryId);
      expect(Object.keys(d.changed)).toEqual([key]);
      expect(d.changed[key]).toContain("DestinationId");
      expect(d.removed).toEqual([]);
      expect(d.added).toEqual([]);
    }
  });

  test("moving an ongoing outing to another year follows it in the logbook and the boat status", async () => {
    const { project: base, snap } = await baseline();
    for (const item of importedOf(base).filter(ongoing)) {
      // The past year already has 32 entries; 2027 has no logbook yet.
      for (const [years, logbook, entryId] of [
        [-1, "2025", "33"],
        [1, "2027", "1"],
      ] as const) {
        const db = await importProject();
        await correct(
          db,
          item.id,
          movedBy((l) => shiftYears(l, years))
        );
        const project = await exportOf(db);
        expect(checkInvariants(project)).toEqual([]);
        const d = diff(snap, snapshot(project));
        expect(d.removed).toEqual([keyOf("2026", item.entryId)]);
        expect(d.added).toEqual([keyOf(logbook, entryId)]);
        const moved = findObjects(project, "efa2logbook")
          .find((l) => l.name === logbook)!
          .records.find((e) => e.EntryId === entryId)!;
        expect(moved.Open).toBe("true");
        expect(moved.Date).toBe(`19.10.${logbook}`);
        // efa closes an outing left open on a past day when it is imported
        // again, so only the future one comes back on the water.
        if (years > 0) await expectReimportsToSameClub(db, project);
      }
    }
  });

  test("moving a finished outing into the logbook of an ongoing one leaves the status pointers alone", async () => {
    const { project: base, snap } = await baseline();
    const db = await importProject();
    for (const item of importedOf(base).filter(
      (i) => i.logbook === "2025" && !ongoing(i)
    )) {
      await correct(
        db,
        item.id,
        movedBy((l) => shiftYears(l, 1))
      );
    }
    const project = await exportOf(db);
    expect(checkInvariants(project)).toEqual([]);
    const statuses = findObject(project, "efa2boatstatus")!.records;
    const baseStatuses = findObject(base, "efa2boatstatus")!.records;
    expect(canon(statuses)).toBe(canon(baseStatuses));
    expect(diff(snap, snapshot(project)).objects).toEqual([]);
  });

  test(
    "moving both ongoing outings and finished ones across years keeps every pointer valid",
    async () => {
      const { project: base } = await baseline();
      const db = await importProject();
      for (const item of importedOf(base)) {
        await correct(
          db,
          item.id,
          movedBy((l) =>
            shiftYears(l, ongoing(item) || item.logbook === "2025" ? 1 : -1)
          )
        );
      }
      const project = await exportOf(db);
      expect(checkInvariants(project)).toEqual([]);
      await expectReimportsToSameClub(db, project);
    },
    LONG
  );
});

describe("re-import", () => {
  test(
    "after one correction of every kind per outing",
    async () => {
      const { project: base } = await baseline();
      const db = await importProject();
      const routes = (await routesOf(db)).filter((r) => !r.archived_at);
      for (const [index, item] of importedOf(base)
        .filter((i) => !ongoing(i))
        .entries()) {
        switch (index % 4) {
          case 0:
            await correct(db, item.id, {
              routeId: routes[index % routes.length].id,
            });
            break;
          case 1:
            await correct(
              db,
              item.id,
              movedBy((l) => shiftYears(l, item.logbook === "2025" ? 1 : -1))
            );
            break;
          case 2:
            await correct(db, item.id, { routeId: null });
            break;
          default:
            await correct(
              db,
              item.id,
              movedBy((l) => shiftMinutes(l, 10))
            );
        }
      }
      for (const route of await routesOf(db)) {
        await save(db, route, { name: `${route.name}!` });
      }
      const project = await exportOf(db);
      expect(checkInvariants(project)).toEqual([]);
      await expectReimportsToSameClub(db, project);
    },
    LONG
  );
});

// ----- Where the original route comes from: efa's destinations -----

describe("free-text destinations and homonym destinations", () => {
  const HOMONYM = "0c0ffee0-aaaa-4bbb-8ccc-0123456789ab";
  /** Entry 2025/1 typed its destination in efa, with a variant and waters. */
  const typed = (
    homonym: "first" | "last" | "none",
    expiresAt: number | null,
    name = "  NECKARINSEL "
  ) => {
    const project = structuredClone(fixture);
    const destinations = project.objects.find(
      (o) => o.type === "efa2destinations"
    )!;
    const copy: Efa2Fields = {
      Id: HOMONYM,
      Name: "Neckarinsel",
      ValidFrom: "0",
      InvalidFrom: String(expiresAt ?? EFA2_FOREVER),
      ChangeCount: "1",
      LastModified: "1792397149502",
    };
    if (homonym === "first") destinations.records.unshift(copy);
    if (homonym === "last") destinations.records.push(copy);
    const entry = project.objects
      .find((o) => o.type === "efa2logbook" && o.name === "2025")!
      .records.find((e) => e.EntryId === "1")!;
    delete entry.DestinationId;
    entry.DestinationName = name;
    entry.DestinationVariantName = "Variante X";
    entry.WatersNameList = "Rhein";
    return project;
  };
  const entryOneOf = (project: Efa2Project) =>
    findObjects(project, "efa2logbook")
      .find((l) => l.name === "2025")!
      .records.find((e) => e.EntryId === "1")!;

  test("a destination typed in another case keeps its variant and waters, corrected or not", async () => {
    for (const homonym of ["none", "first", "last"] as const) {
      const db = await importProject(typed(homonym, null));
      const untouched = entryOneOf(await exportOf(db));
      expect([homonym, untouched.DestinationVariantName]).toEqual([
        homonym,
        "Variante X",
      ]);
      expect(untouched.WatersNameList).toBe("Rhein");
      await correct(db, deriveEfa2Id("outing:2025:1"), { comment: "Corrigée" });
      const corrected = entryOneOf(await exportOf(db));
      expect([homonym, corrected.DestinationVariantName]).toEqual([
        homonym,
        "Variante X",
      ]);
      expect(corrected.WatersNameList).toBe("Rhein");
      expect(corrected.DestinationId).toBe(untouched.DestinationId);
    }
  });

  const keepsWatersBeforeAndAfterExpiry = async (homonym: "first" | "last") => {
    const expiry = Date.UTC(2026, 11, 1);
    const db = await importProject(typed(homonym, expiry));
    for (const at of [now, new Date("2027-01-15T12:00:00Z")]) {
      const entry = entryOneOf(await exportOf(db, at));
      expect([at.toISOString(), entry.DestinationVariantName]).toEqual([
        at.toISOString(),
        "Variante X",
      ]);
      expect(entry.WatersNameList).toBe("Rhein");
    }
  };

  test("a destination typed like a homonym that expires later keeps its waters (homonym listed first)", async () => {
    await keepsWatersBeforeAndAfterExpiry("first");
  });

  // efa lists two destinations named "Neckarinsel", the second one valid
  // until 2026-12-01. The import was made before that date and picked the
  // later one for the typed name; an export made after it must still see
  // the entry's route as unchanged.
  test("a destination typed like a homonym that expires later keeps its waters (homonym listed last)", async () => {
    await keepsWatersBeforeAndAfterExpiry("last");
  });
});

describe("end dates and partial changes of a multi-day outing", () => {
  test(
    "the end moved one day later, for every finished outing",
    async () => {
      const { project: base, snap } = await baseline();
      for (const item of importedOf(base).filter((i) => !ongoing(i))) {
        const db = await importProject();
        await correct(db, item.id, (draft) => ({
          endDateTime: shiftDays(draft.endDateTime!, 1),
        }));
        const project = await exportOf(db);
        const d = diff(snap, snapshot(project));
        const key = keyOf(item.logbook, item.entryId);
        expect([
          key,
          d.removed,
          d.added,
          d.objects,
          Object.keys(d.changed),
        ]).toEqual([key, [], [], [], [key]]);
        expect(checkInvariants(project)).toEqual([]);
        await expectReimportsToSameClub(db, project);
      }
    },
    LONG
  );

  test("the start of a multi-day outing moved one day later keeps its end and group", async () => {
    const { project: base, snap } = await baseline();
    for (const item of importedOf(base).filter((i) => i.entry.EndDate)) {
      const db = await importProject();
      await correct(db, item.id, (draft) => ({
        startDateTime: shiftDays(draft.startDateTime, 1),
      }));
      const project = await exportOf(db);
      const d = diff(snap, snapshot(project));
      const key = keyOf(item.logbook, item.entryId);
      expect([key, d.changed, d.removed, d.added]).toEqual([
        key,
        { [key]: [...stampOf(item), "Date"].sort() },
        [],
        [],
      ]);
      await expectReimportsToSameClub(db, project);
    }
  });
});

describe("entry numbers of moved outings", () => {
  test("late entries and moved outings in one logbook never share a number", async () => {
    const { project: base } = await baseline();
    const db = await importProject();
    const [boat] = await db.select<{ id: string }[]>(
      "SELECT id FROM boat ORDER BY id LIMIT 1"
    );
    const [rower] = await db.select<{ id: string }[]>(
      "SELECT id FROM rower ORDER BY id LIMIT 1"
    );
    for (const [index, day] of ["03", "20", "11"].entries()) {
      await insertOuting(db, {
        id: deriveEfa2Id(`late-${index}`),
        boatId: boat.id,
        startDateTime: `2026-05-${day}T10:00`,
        endDateTime: `2026-05-${day}T11:00`,
        crew: [{ rowerId: rower.id, role: "rower" }],
      });
    }
    for (const item of importedOf(base).filter(
      (i) => i.logbook === "2025" && !ongoing(i)
    )) {
      await correct(
        db,
        item.id,
        movedBy((l) => shiftYears(l, 1))
      );
    }
    const project = await exportOf(db);
    expect(checkInvariants(project)).toEqual([]);
    const ids = findObjects(project, "efa2logbook")
      .find((l) => l.name === "2026")!
      .records.map((e) => Number(e.EntryId));
    expect(ids.length).toBe(25 + 32 + 3);
    expect(Math.max(...ids)).toBe(25 + 32 + 3);
  });

  // Known limitation (A-FAIRE-PLUS-TARD.md): a moved outing's number is
  // "next free" in the order of the outings' start dates, so it is only
  // stable for one export. Moving an earlier outing into the same logbook
  // shifts the number of the first one in the next export. Fix: keep the
  // numbers given in efa_record.
  test.fails(
    "moving another outing does not renumber the ones already moved",
    async () => {
      const { project: base } = await baseline();
      const items = importedOf(base).filter((i) => i.logbook === "2025");
      const earliest = items.find((i) => i.entryId === "1")!;
      const latest = items.find((i) => i.entryId === "18")!;
      const db = await importProject();
      await correct(
        db,
        latest.id,
        movedBy((l) => shiftYears(l, 1))
      );
      const numberOf = async (item: Imported) =>
        findObjects(await exportOf(db), "efa2logbook")
          .find((l) => l.name === "2026")!
          .records.find(
            (e) =>
              e.BoatId === item.entry.BoatId &&
              e.Date.endsWith("2026") &&
              e.StartTime === item.entry.StartTime &&
              e.Date.slice(0, 5) === item.entry.Date.slice(0, 5)
          )!.EntryId;
      const before = await numberOf(latest);
      await correct(
        db,
        earliest.id,
        movedBy((l) => shiftYears(l, 1))
      );
      // A number efa may already have given out elsewhere must not change from
      // one export to the next.
      expect(await numberOf(latest)).toBe(before);
    }
  );
});

describe("re-import after one correction at a time", () => {
  test(
    "route, year and midnight corrections each come back as saved",
    async () => {
      const { project: base } = await baseline();
      const routes = (await routesOf(await importProject())).filter(
        (r) => !r.archived_at
      );
      for (const item of importedOf(base).filter((i) => !ongoing(i))) {
        for (const patch of [
          { routeId: null },
          { routeId: routes[0].id },
          movedBy((l: string) =>
            shiftYears(l, item.logbook === "2025" ? 1 : -1)
          ),
        ]) {
          const db = await importProject();
          await correct(db, item.id, patch);
          await expectReimportsToSameClub(db, await exportOf(db));
        }
      }
    },
    LONG
  );
});

describe("outings efa left open on a past day", () => {
  // Imported two weeks after the fixture was written: the two outings on the
  // water on 19 October are closed by the import.
  const later = new Date("2026-11-02T12:00:00Z");

  test(
    "their route, date and time corrections export like any other",
    async () => {
      const base = await exportOf(await importProject(fixture, later), later);
      expect(checkInvariants(base)).toEqual([]);
      const snap = snapshot(base);
      const items = importedOf(base).filter(
        (i) => rawEntryOf(i).Open === "true"
      );
      expect(items.length).toBe(2);
      expect(items.every((i) => i.entry.Open !== "true")).toBe(true);
      const patches: [
        string,
        (
          i: Imported
        ) => Partial<OutingDraft> | ((d: OutingDraft) => Partial<OutingDraft>),
        (i: Imported) => string[],
      ][] = [
        ["route", () => ({ routeId: null }), () => ["DestinationId"]],
        [
          "time",
          () => movedBy((l) => shiftMinutes(l, 10)),
          () => ["StartTime"],
        ],
        ["day", () => movedBy((l) => shiftDays(l, 1)), () => ["Date"]],
      ];
      for (const item of items) {
        for (const [label, patch, fields] of patches) {
          const db = await importProject(fixture, later);
          await correct(db, item.id, patch(item));
          const project = await exportOf(db, later);
          const d = diff(snap, snapshot(project));
          const key = keyOf(item.logbook, item.entryId);
          expect([label, key, d.removed, d.added, d.objects]).toEqual([
            label,
            key,
            [],
            [],
            [],
          ]);
          expect(Object.keys(d.changed)).toEqual([key]);
          expect(d.changed[key]).toEqual(expect.arrayContaining(fields(item)));
          expect(checkInvariants(project)).toEqual([]);
          await expectReimportsToSameClub(db, project, later);
        }
        // And a year back.
        const db = await importProject(fixture, later);
        await correct(
          db,
          item.id,
          movedBy((l) => shiftYears(l, -1))
        );
        const project = await exportOf(db, later);
        expect(checkInvariants(project)).toEqual([]);
        await expectReimportsToSameClub(db, project, later);
      }
    },
    LONG
  );
});

describe("a logbook without dates", () => {
  // efa always writes the dates of a logbook; without them, a logbook named
  // after a year holds that year.
  test("an outing moved to another year leaves a dateless logbook named after its year", async () => {
    const project = structuredClone(fixture);
    for (const record of project.projectRecords) {
      if (record.Type === "Logbook" && record.Name === "2025") {
        delete record.StartDate;
        delete record.EndDate;
      }
    }
    const db = await importProject(project);
    await correct(
      db,
      deriveEfa2Id("outing:2025:1"),
      movedBy((l) => shiftYears(l, 1))
    );
    const exported = await exportOf(db);
    const entry = findObjects(exported, "efa2logbook")
      .find((l) => l.name === "2025")!
      .records.find((e) => e.EntryId === "1");
    expect(entry).toBeUndefined();
  });
});
