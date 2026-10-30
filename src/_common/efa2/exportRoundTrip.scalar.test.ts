import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyMigrations } from "../database/migrations";
import {
  finishOuting,
  loadClubData,
  loadOuting,
  StoredOuting,
} from "../database/repositories/club.repository";
import { SqlClient } from "../database/sqlClient";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import { ZustandSession } from "../store/sessions.store";
import { readFinishedOutingDraft } from "../../logbook/business/EditOuting/loadOutingDraft";
import { OutingDraft } from "../../logbook/business/EditOuting/outingDraft";
import { SaveOutingUsecase } from "../../logbook/business/EditOuting/SaveOuting.usecase";
import { createInMemoryStartSessionRepository } from "../../boathouse/business/StartSession/StartSession.repository.inMemory";
import { readFixtureProject } from "./__fixtures__/readFixtureProject";
import { buildEfa2Export } from "./buildEfa2Export";
import {
  Efa2Project,
  findObjects,
  readEfa2ProjectFromZip,
  writeEfa2BackupZip,
} from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";
import {
  efaDateToIso,
  efaDistanceToMetres,
  efaList,
  efaTimeToHhMm,
} from "./efa2Values";
import { deriveEfa2Id, toOutingTypeCode } from "./planEfa2Import";
import { runEfa2Import } from "./runEfa2Import";

/**
 * Round trip properties of the efa2 export for imported outings corrected
 * through the outing editor (the real SaveOutingUsecase), one scalar field at
 * a time. After a correction:
 *  - the entry differs from the untouched export in the corrected field(s)
 *    only, apart from efa's ChangeCount and LastModified;
 *  - the entry says what the database says (dates, distance, type, boat,
 *    variant, captain seat, crew seats…), read the way efa reads it;
 *  - no other entry, boat status or object of the project moves.
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
const importNow = new Date("2026-10-19T12:00:00Z");
/** When corrections are saved: after the import. */
const correctionTime = new Date("2026-10-20T08:00:00Z");
/** The editor's clock: after every imported outing. */
const editorNow = new Date("2026-10-28T14:30:00");

const VERSION_FIELDS = ["ChangeCount", "LastModified"];
const SLOW = 120_000;

// ----- Imported club -----

const importClub = async (project = readFixtureProject()) => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  await runEfa2Import(db, project, {
    backup: () => Promise.resolve(),
    labels: importLabels,
    now: importNow,
  });
  return db;
};

const exportClub = async (db: SqlClient) =>
  (await buildEfa2Export(db, { labels: exportLabels, now: importNow })).project;

interface ImportedOuting {
  id: string;
  logbook: string;
  entryId: string;
  raw: Efa2Fields;
  finished: boolean;
}

const listImportedOutings = async (db: SqlClient) => {
  const rows = await db.select<
    {
      id: string;
      end_date_time: string | null;
      object_name: string;
      fields: string;
    }[]
  >(/* sql */ `
    SELECT o.id, o.end_date_time, e.object_name, e.fields
    FROM outing o
    JOIN efa_record e ON e.rb_table = 'outing' AND e.rb_id = o.id
      AND e.object_type = 'efa2logbook'
    ORDER BY e.object_name, o.start_date_time`);
  return rows.map((row): ImportedOuting => {
    const raw = JSON.parse(row.fields) as Efa2Fields;
    return {
      id: row.id,
      logbook: row.object_name,
      entryId: raw.EntryId,
      raw,
      finished: row.end_date_time !== null,
    };
  });
};

// ----- Reading an export -----

const entryKey = (logbook: string, entryId: string) => `${logbook}|${entryId}`;

const entriesOf = (project: Efa2Project) =>
  new Map(
    findObjects(project, "efa2logbook").flatMap((logbook) =>
      logbook.records.map((record): [string, Efa2Fields] => [
        entryKey(logbook.name, record.EntryId),
        record,
      ])
    )
  );

const statusesOf = (project: Efa2Project) =>
  new Map(
    findObjects(project, "efa2boatstatus").flatMap((object) =>
      object.records.map((record): [string, Efa2Fields] => [
        record.BoatId || `unknown|${record.BoatText}`,
        record,
      ])
    )
  );

/** The fields that differ, as `field: [before, after]` (missing = ""). */
const diffFields = (before: Efa2Fields | undefined, after: Efa2Fields) => {
  const diff: Record<string, [string, string]> = {};
  for (const key of new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after),
  ])) {
    const a = before?.[key] ?? "";
    const b = after[key] ?? "";
    if (a !== b) diff[key] = [a, b];
  }
  return diff;
};

/** Everything of the project but the logbook entries named in `skip` and the boat statuses. */
const projectWithout = (project: Efa2Project, skip: Set<string>) =>
  JSON.stringify({
    name: project.name,
    projectRecords: project.projectRecords,
    objects: project.objects.map((object) => ({
      ...object,
      records:
        object.type === "efa2logbook"
          ? object.records.filter(
              (record) => !skip.has(entryKey(object.name, record.EntryId))
            )
          : object.type === "efa2boatstatus"
            ? []
            : object.records,
    })),
  });

const nextIsoDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** The entry's start and end as efa reads them ("YYYY-MM-DDTHH:mm"). */
const interpretDates = (entry: Efa2Fields) => {
  const date = efaDateToIso(entry.Date);
  const start = efaTimeToHhMm(entry.StartTime) ?? "00:00";
  const end = efaTimeToHhMm(entry.EndTime) ?? start;
  const endDate =
    efaDateToIso(entry.EndDate) ?? (end < start ? nextIsoDay(date!) : date);
  return { start: `${date}T${start}`, end: `${endDate}T${end}` };
};

/** What the entry says, compared to what the database holds for the outing. */
const entryProblems = async (
  db: SqlClient,
  project: Efa2Project,
  entry: Efa2Fields,
  outing: StoredOuting
) => {
  const problems: string[] = [];
  const expectEqual = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      problems.push(
        `${field} reads ${JSON.stringify(actual)}, the database has ${JSON.stringify(expected)}`
      );
    }
  };

  const dates = interpretDates(entry);
  expectEqual("start", dates.start, outing.startDateTime);
  const ongoing = outing.endDateTime === null;
  expectEqual("Open", entry.Open === "true", ongoing);
  if (!ongoing) expectEqual("end", dates.end, outing.endDateTime);

  expectEqual(
    "distance",
    efaDistanceToMetres(entry.Distance) ?? null,
    outing.distanceM
  );
  expectEqual("comment", entry.Comments ?? "", outing.comment);
  expectEqual(
    "type",
    toOutingTypeCode(entry.SessionType || "NORMAL"),
    outing.outingTypeCode ?? "normal"
  );
  expectEqual("route", entry.DestinationId ?? "", outing.routeId ?? "");

  // A boat efa only knows by name, still on the water, keeps its name.
  if (entry.BoatId) {
    expectEqual("boat", entry.BoatId, outing.boatId);
    const boat = findObjects(project, "efa2boats")
      .flatMap((object) => object.records)
      .filter((record) => record.Id === entry.BoatId);
    if (boat.length === 0) problems.push("the boat is not in the project");
    const variants = efaList(boat.at(-1)?.TypeVariant);
    if (entry.BoatVariant && !variants.includes(entry.BoatVariant)) {
      problems.push(
        `BoatVariant ${entry.BoatVariant} is not a variant of the boat (${variants.join(";")})`
      );
    }
    const wanted = variants.find(
      (variant) =>
        deriveEfa2Id(`configuration:${outing.boatId}:${variant}`) ===
        outing.boatConfigurationId
    );
    if (wanted) expectEqual("variant", entry.BoatVariant, wanted);
  }

  const crewRows = await db.select<
    { rower_id: string; role: string; position: number }[]
  >("SELECT rower_id, role, position FROM outing_crew WHERE outing_id = $1", [
    outing.id,
  ]);
  const seats = new Map<string, string>();
  for (const row of crewRows) {
    seats.set(row.role === "cox" ? "0" : String(row.position), row.rower_id);
  }
  for (let seat = 0; seat <= 24; seat++) {
    const field = seat === 0 ? "CoxId" : `Crew${seat}Id`;
    expectEqual(field, entry[field] ?? "", seats.get(String(seat)) ?? "");
  }
  const captainSeat = [...seats].find(
    ([, rowerId]) => rowerId === outing.captainRowerId
  )?.[0];
  expectEqual(
    "captain",
    entry.BoatCaptain ?? "",
    outing.captainRowerId ? (captainSeat ?? "") : ""
  );
  return problems;
};

/** Boat statuses and open entries agree with each other. */
const statusProblems = (project: Efa2Project) => {
  const problems: string[] = [];
  const entries = entriesOf(project);
  const statuses = [...statusesOf(project).values()];
  const open = [...entries].filter(([, entry]) => entry.Open === "true");

  for (const [key, entry] of open) {
    const [logbook] = key.split("|");
    const status = statuses.find((s) =>
      entry.BoatId
        ? s.BoatId === entry.BoatId
        : s.UnknownBoat === "true" && s.BoatText === entry.BoatName
    );
    if (
      !status ||
      status.CurrentStatus !== "ONTHEWATER" ||
      status.Logbook !== logbook ||
      status.EntryNo !== entry.EntryId
    ) {
      problems.push(
        `open entry ${key} (${entry.BoatId ?? entry.BoatName}) has status ${JSON.stringify(status)}`
      );
    }
  }
  for (const status of statuses) {
    if (status.CurrentStatus !== "ONTHEWATER") {
      if (status.Logbook || status.EntryNo) {
        problems.push(
          `${status.BoatText} is not on the water but points to ${status.Logbook}|${status.EntryNo}`
        );
      }
      continue;
    }
    const entry = entries.get(entryKey(status.Logbook, status.EntryNo));
    if (
      !entry ||
      entry.Open !== "true" ||
      (status.UnknownBoat === "true"
        ? entry.BoatName !== status.BoatText
        : entry.BoatId !== status.BoatId)
    ) {
      problems.push(
        `${status.BoatText} is on the water for ${status.Logbook}|${status.EntryNo}: ${JSON.stringify(entry)}`
      );
    }
  }
  return problems;
};

// ----- Correcting an outing through the real save path -----

interface Context {
  boats: {
    id: string;
    configurations: { id: string; isDefault: boolean }[];
  }[];
  index: number;
  /** Boats on the water. */
  busyBoatIds: string[];
}

/** The outing as the editor loads it, ongoing or finished. */
const readDraft = async (db: SqlClient, outingId: string) => {
  const stored = (await loadOuting(db, outingId))!;
  return {
    id: stored.id,
    boatId: stored.boatId,
    boatConfigurationId: stored.boatConfigurationId,
    routeId: stored.routeId,
    outingTypeCode: stored.outingTypeCode,
    rowerIds: stored.crew
      .filter((m) => m.role === "rower")
      .map((m) => m.rowerId),
    coxId: stored.crew.find((m) => m.role === "cox")?.rowerId ?? null,
    captainRowerId: stored.captainRowerId,
    startDateTime: stored.startDateTime,
    estimatedEndDateTime: stored.estimatedEndDateTime,
    endDateTime: stored.endDateTime,
    // The ongoing editor does not know the distance: it keeps the stored one.
    ...(stored.endDateTime === null ? {} : { distanceM: stored.distanceM }),
    comment: stored.comment,
    hasBeenCoached: stored.hasBeenCoached,
  } satisfies OutingDraft;
};

/** Same wiring as useSaveOuting, on the test database. */
const saveCorrection = async (
  db: SqlClient,
  mode: "finished" | "ongoing",
  draft: OutingDraft
) => {
  const data = await loadClubData(db);
  let sessions: ZustandSession[] = data.ongoingOutings;
  const usecase = new SaveOutingUsecase({
    repository: createInMemoryStartSessionRepository({
      boats: data.boats,
      rowers: data.rowers,
      routes: data.routes,
    }),
    sessions: {
      getOngoingSessions: () => sessions,
      getOngoingSession: (id) => sessions.find((s) => s.id === id),
      updateSession: (outing) => {
        sessions = sessions.map((s) => (s.id === outing.id ? outing : s));
      },
    },
    database: {
      write: async (_label, write) => {
        await write(db);
        return true;
      },
      findOverlaps: () => Promise.resolve([]),
      loadFinished: (id) => readFinishedOutingDraft(db, id),
    },
    requireCaptain: () => false,
    now: () => editorNow,
    generateId: () => "never",
  });
  return usecase.execute({ mode, draft, acceptWarnings: true });
};

const contextOf = async (db: SqlClient, index: number): Promise<Context> => {
  const data = await loadClubData(db);
  return {
    index,
    busyBoatIds: data.ongoingOutings.map((outing) => outing.boat.id),
    boats: data.boats.map((boat) => ({
      id: boat.id,
      configurations: (boat.configurations ?? []).map((c) => ({
        id: c.id,
        isDefault: c.isDefault,
      })),
    })),
  };
};

beforeEach(() => {
  // The migrations log every step.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(correctionTime);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ----- 1. Untouched -----

describe("export of an untouched import", () => {
  test("gives every logbook's entries as efa had them, but for the free names the import made records of", async () => {
    const db = await importClub();
    const exported = entriesOf(await exportClub(db));
    const raw = readFixtureProject();
    const problems: string[] = [];
    const normalised: string[] = [];

    for (const logbook of findObjects(raw, "efa2logbook")) {
      const count = [...exported.keys()].filter((key) =>
        key.startsWith(`${logbook.name}|`)
      ).length;
      expect([logbook.name, count]).toEqual([
        logbook.name,
        logbook.records.length,
      ]);

      for (const record of logbook.records) {
        const after = exported.get(entryKey(logbook.name, record.EntryId));
        if (!after) {
          problems.push(`${logbook.name}/${record.EntryId} is missing`);
          continue;
        }
        const diff = diffFields(record, after);
        const keys = Object.keys(diff);
        if (keys.length === 0) continue;
        // Legit normalisation: a free name (crew, boat, destination) the
        // import turned into a record. The Name goes, an Id comes, and the
        // entry counts as one save more for efa.
        const isFreeName = (key: string) =>
          /^(Cox|Crew\d+|Boat|Destination)(Id|Name)$/.test(key);
        const legit =
          keys.every((key) => isFreeName(key) || key === "ChangeCount") &&
          keys.some(isFreeName) &&
          Number(after.ChangeCount) === Number(record.ChangeCount) + 1 &&
          keys
            .filter((key) => key.endsWith("Name"))
            .every(
              (key) => diff[key][1] === "" && after[key.replace(/Name$/, "Id")]
            );
        (legit ? normalised : problems).push(
          `${logbook.name}/${record.EntryId}: ${JSON.stringify(diff)}`
        );
      }
    }
    expect(problems).toEqual([]);
    // Documented: only entries typed with free names are normalised (12
    // finished ones and the ongoing 2026/25 in the fixture).
    expect(normalised).toHaveLength(13);
  });

  test("boat status records of an untouched import are as efa had them", async () => {
    const db = await importClub();
    const statuses = statusesOf(await exportClub(db));
    const problems: string[] = [];
    for (const [key, record] of statusesOf(readFixtureProject())) {
      const diff = diffFields(record, statuses.get(key) ?? {});
      // The export stamps the status records it rewrites.
      delete diff.ChangeCount;
      delete diff.LastModified;
      if (Object.keys(diff).length > 0) {
        problems.push(`${record.BoatText}: ${JSON.stringify(diff)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("every entry says what the database says, and the statuses agree", async () => {
    const db = await importClub();
    const project = await exportClub(db);
    const entries = entriesOf(project);
    const problems = statusProblems(project);
    for (const outing of await listImportedOutings(db)) {
      const entry = entries.get(entryKey(outing.logbook, outing.entryId))!;
      const stored = (await loadOuting(db, outing.id))!;
      for (const problem of await entryProblems(db, project, entry, stored)) {
        problems.push(`${outing.logbook}/${outing.entryId}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// ----- Scenarios -----

interface Variant {
  label: string;
  draft: OutingDraft;
  /** The entry fields that may differ, apart from the version fields. */
  allowed: string[];
}

interface Scenario {
  name: string;
  variants: (draft: OutingDraft, context: Context) => Variant[];
}

const addMinutes = (local: string, minutes: number) => {
  const date = new Date(`${local}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
};
const day = (local: string) => local.slice(0, 10);

const OUTING_TYPES = [
  "normal",
  "training",
  "regatta",
  "training_camp",
  "instruction",
  "tour",
  "club_trip",
  "ergometer",
  "motorboat",
  null,
];

const finishedScenarios: Scenario[] = [
  {
    name: "comment",
    variants: (draft) =>
      [
        "Corrigé après coup",
        "Special: <Ufer> & \"Wehr\" 'Steg'; äöüß €\nligne 2",
        "",
      ].map((comment) => ({
        label: JSON.stringify(comment),
        draft: { ...draft, comment },
        allowed: ["Comments"],
      })),
  },
  {
    name: "start time",
    variants: (draft) => {
      const end = draft.endDateTime!;
      const candidates = [
        addMinutes(draft.startDateTime, 1),
        addMinutes(draft.startDateTime, -1),
        `${day(draft.startDateTime)}T06:30`,
        `${day(draft.startDateTime)}T23:45`,
        end,
      ];
      return candidates
        .filter(
          (start) =>
            day(start) === day(draft.startDateTime) &&
            start <= end &&
            start !== draft.startDateTime
        )
        .slice(0, 3)
        .map((startDateTime) => ({
          label: startDateTime,
          draft: { ...draft, startDateTime },
          allowed: ["StartTime", "EndTime"],
        }));
    },
  },
  {
    name: "end time (same day)",
    variants: (draft) => {
      const start = draft.startDateTime;
      const candidates = [
        addMinutes(draft.endDateTime!, 1),
        addMinutes(draft.endDateTime!, -1),
        `${day(draft.endDateTime!)}T23:59`,
        start,
      ];
      return candidates
        .filter(
          (end) =>
            day(end) === day(draft.endDateTime!) &&
            end >= start &&
            end !== draft.endDateTime
        )
        .slice(0, 3)
        .map((endDateTime) => ({
          label: endDateTime,
          draft: { ...draft, endDateTime },
          allowed: ["EndTime", "EndDate"],
        }));
    },
  },
  {
    name: "end on another day",
    variants: (draft) => {
      const start = draft.startDateTime;
      const nextDay = nextIsoDay(day(start));
      return [
        // later than the start's clock time, and earlier: efa writes an end
        // date for the first, reads the second as the next day by itself.
        `${nextDay}T${start.slice(11)}`,
        `${nextDay}T00:30`,
        // multi-day entries come back to one day
        `${day(start)}T${draft.endDateTime!.slice(11)}`,
      ]
        .filter(
          (end) =>
            end >= start &&
            end !== draft.endDateTime &&
            end <= "2026-10-28T14:00"
        )
        .map((endDateTime) => ({
          label: endDateTime,
          draft: { ...draft, endDateTime },
          allowed: ["EndTime", "EndDate"],
        }));
    },
  },
  {
    name: "distance",
    variants: (draft) =>
      [(draft.distanceM ?? 0) + 1500, null, 0, 500].map((distanceM) => ({
        label: String(distanceM),
        draft: { ...draft, distanceM },
        allowed: ["Distance"],
      })),
  },
  {
    name: "outing type",
    variants: (draft, { index }) =>
      [0, 3, 7]
        .map((shift) => OUTING_TYPES[(index + shift) % OUTING_TYPES.length])
        .filter((code) => code !== draft.outingTypeCode)
        .map((outingTypeCode) => ({
          label: String(outingTypeCode),
          draft: { ...draft, outingTypeCode },
          allowed: ["SessionType"],
        })),
  },
  {
    name: "captain removed or changed",
    variants: (draft) => {
      const crew = [...draft.rowerIds, ...(draft.coxId ? [draft.coxId] : [])];
      const others = crew.filter((id) => id !== draft.captainRowerId);
      return [
        ...(draft.captainRowerId
          ? [{ label: "removed", captainRowerId: null }]
          : []),
        ...(others.length > 0
          ? [
              { label: "first other", captainRowerId: others[0] },
              { label: "last other", captainRowerId: others.at(-1)! },
            ]
          : []),
      ].map(({ label, captainRowerId }) => ({
        label,
        draft: { ...draft, captainRowerId },
        allowed: ["BoatCaptain"],
      }));
    },
  },
  {
    name: "coached flag",
    variants: (draft) => [
      {
        label: "coached",
        draft: { ...draft, hasBeenCoached: true },
        // efa2 has no such field.
        allowed: [],
      },
    ],
  },
  {
    name: "boat changed to another boat (any of its rigs)",
    variants: (draft, { boats, index }) => {
      const others = boats.filter((boat) => boat.id !== draft.boatId);
      // A boat with several rigs: all of them, on a few outings.
      const allRigs = index % 8 === 0;
      const picks = new Set([
        others[index % others.length],
        others[(index * 7 + 3) % others.length],
        ...(allRigs ? others.filter((b) => b.configurations.length > 1) : []),
      ]);
      return [...picks].flatMap((boat) =>
        (allRigs ? boat.configurations : boat.configurations.slice(0, 1)).map(
          (configuration) => ({
            label: `${boat.id}/${configuration.id}`,
            draft: {
              ...draft,
              boatId: boat.id,
              boatConfigurationId: configuration.id,
            },
            allowed: ["BoatId", "BoatVariant", "BoatName"],
          })
        )
      );
    },
  },
];

/** The club an efa2 export gives back when efa2 (or Rowing Beacon) imports it. */
const reimportProblems = async (
  db: SqlClient,
  project: Efa2Project,
  outing: ImportedOuting
) => {
  const again = await importClub(
    readEfa2ProjectFromZip(writeEfa2BackupZip(project, importNow.getTime()))
  );
  const twin = (await listImportedOutings(again)).find(
    (other) =>
      other.logbook === outing.logbook && other.entryId === outing.entryId
  );
  if (!twin) return ["the entry is not imported back"];
  const mine = (await loadOuting(db, outing.id))!;
  const theirs = (await loadOuting(again, twin.id))!;
  const pick = (stored: StoredOuting) => ({
    boatId: stored.boatId,
    boatConfigurationId: stored.boatConfigurationId,
    routeId: stored.routeId,
    outingTypeCode: stored.outingTypeCode ?? "normal",
    captainRowerId: stored.captainRowerId,
    startDateTime: stored.startDateTime,
    endDateTime: stored.endDateTime,
    distanceM: stored.distanceM,
    comment: stored.comment,
    crew: [...stored.crew].sort((a, b) =>
      `${a.role}${a.rowerId}`.localeCompare(`${b.role}${b.rowerId}`)
    ),
  });
  return JSON.stringify(pick(mine)) === JSON.stringify(pick(theirs))
    ? []
    : [
        `imported back as ${JSON.stringify(pick(theirs))}, was ${JSON.stringify(pick(mine))}`,
      ];
};

interface RunOptions {
  mode: "finished" | "ongoing";
  select: (outing: ImportedOuting) => boolean;
}

const runScenario = async (
  scenario: Scenario,
  { mode, select }: RunOptions,
  project = readFixtureProject
) => {
  const base = await importClub(project());
  // The import is deterministic: the same club gives the same export.
  const untouched = await exportClub(base);
  const outings = (await listImportedOutings(base)).filter(select);
  const problems: string[] = [];
  let applied = 0;

  for (const [index, outing] of outings.entries()) {
    const label = `${outing.logbook}/${outing.entryId}`;
    const stored = await readDraft(base, outing.id);
    const variants = scenario.variants(stored, await contextOf(base, index));
    for (const [variantIndex, variant] of variants.entries()) {
      const db = await importClub(project());
      const where = `${label} ${scenario.name} ${variant.label}`;
      const result = await saveCorrection(db, mode, variant.draft);
      applied++;
      if (result.status !== "saved") {
        problems.push(`${where}: not saved ${JSON.stringify(result)}`);
        continue;
      }
      const corrected = await exportClub(db);

      const key = entryKey(outing.logbook, outing.entryId);
      const before = entriesOf(untouched);
      const after = entriesOf(corrected);
      const entryBefore = before.get(key);
      const entryAfter = after.get(key);
      if (!entryAfter || !entryBefore || before.size !== after.size) {
        problems.push(`${where}: the entry moved or was duplicated`);
        continue;
      }

      // Only the corrected fields differ.
      const diff = diffFields(entryBefore, entryAfter);
      const allowed = new Set([...VERSION_FIELDS, ...variant.allowed]);
      const unexpected = Object.keys(diff).filter((f) => !allowed.has(f));
      if (unexpected.length > 0) {
        problems.push(
          `${where}: unexpected changes ${JSON.stringify(
            Object.fromEntries(unexpected.map((f) => [f, diff[f]]))
          )}`
        );
      }
      // The entry says what the database says.
      const storedAfter = (await loadOuting(db, outing.id))!;
      for (const problem of await entryProblems(
        db,
        corrected,
        entryAfter,
        storedAfter
      )) {
        problems.push(`${where}: ${problem}`);
      }
      // Corrected means newer for efa. A correction that changes nothing efa
      // knows (the same type, a coached flag…) leaves the counter alone.
      const contentChanged = Object.keys(diff).some(
        (field) => !VERSION_FIELDS.includes(field)
      );
      if (contentChanged) {
        if (
          Number(entryAfter.ChangeCount) <=
            Number(outing.raw.ChangeCount ?? 0) ||
          Number(entryAfter.LastModified) <=
            Number(outing.raw.LastModified ?? 0)
        ) {
          problems.push(
            `${where}: version did not move (${outing.raw.ChangeCount}/${outing.raw.LastModified} -> ${entryAfter.ChangeCount}/${entryAfter.LastModified})`
          );
        }
      } else if (entryAfter.ChangeCount !== entryBefore.ChangeCount) {
        problems.push(`${where}: ChangeCount moved without any change`);
      }
      // The file efa reads gives the same entry.
      const reread = entriesOf(
        readEfa2ProjectFromZip(
          writeEfa2BackupZip(corrected, importNow.getTime())
        )
      ).get(key);
      const unread = diffFields(entryAfter, reread ?? {});
      if (!reread || Object.keys(unread).length > 0) {
        problems.push(
          `${where}: the written file reads back with ${JSON.stringify(unread)}`
        );
      }

      // Nothing else moved.
      if (
        projectWithout(untouched, new Set([key])) !==
        projectWithout(corrected, new Set([key]))
      ) {
        problems.push(`${where}: something else of the project changed`);
      }
      for (const [otherKey, entry] of before) {
        if (otherKey === key) continue;
        if (JSON.stringify(after.get(otherKey)) !== JSON.stringify(entry)) {
          problems.push(`${where}: other entry ${otherKey} changed`);
        }
      }
      {
        // Finished outing: no boat status moves. Ongoing: only the status of
        // the boat the outing leaves and of the one it takes.
        const entries = mode === "finished" ? [] : [entryBefore, entryAfter];
        const isInvolved = (status: Efa2Fields) =>
          entries.some((entry) =>
            entry.BoatId
              ? entry.BoatId === status.BoatId
              : status.UnknownBoat === "true" &&
                entry.BoatName === status.BoatText
          );
        const statusAfter = statusesOf(corrected);
        for (const [boat, status] of statusesOf(untouched)) {
          const moved = diffFields(status, statusAfter.get(boat) ?? {});
          if (Object.keys(moved).length === 0) continue;
          const mayMove = [
            "CurrentStatus",
            "Logbook",
            "EntryNo",
            "Comment",
            ...VERSION_FIELDS,
          ];
          const gone = status.UnknownBoat === "true" && !statusAfter.has(boat);
          if (
            !isInvolved(status) ||
            (!gone && Object.keys(moved).some((f) => !mayMove.includes(f)))
          ) {
            problems.push(
              `${where}: boat status of ${status.BoatText} changed ${JSON.stringify(moved)}`
            );
          }
        }
      }
      for (const problem of statusProblems(corrected)) {
        problems.push(`${where}: ${problem}`);
      }
      // Exporting again gives the same project.
      if (JSON.stringify(await exportClub(db)) !== JSON.stringify(corrected)) {
        problems.push(`${where}: a second export differs from the first`);
      }
      // The heavier round trips on the first variant of each outing.
      if (variantIndex > 0) continue;
      for (const problem of await reimportProblems(db, corrected, outing)) {
        problems.push(`${where}: ${problem}`);
      }

      // Correcting back to what it was gives the entry back.
      const reverted = await saveCorrection(db, mode, stored);
      if (reverted.status !== "saved") {
        problems.push(`${where}: revert not saved ${JSON.stringify(reverted)}`);
      } else {
        const revertedEntry = entriesOf(await exportClub(db)).get(key)!;
        const left = diffFields(entryBefore, revertedEntry);
        for (const field of VERSION_FIELDS) delete left[field];
        if (Object.keys(left).length > 0) {
          problems.push(
            `${where}: corrected back, the entry still differs ${JSON.stringify(left)}`
          );
        }
        if (
          projectWithout(untouched, new Set([key])) !==
          projectWithout(await exportClub(db), new Set([key]))
        ) {
          problems.push(`${where}: corrected back, the project differs`);
        }
      }

      // An outing corrected on the water is then stopped as usual: its entry
      // is closed and the boat is back.
      if (mode === "ongoing") {
        await saveCorrection(db, mode, variant.draft);
        const end = addMinutes(variant.draft.startDateTime, 75);
        await finishOuting(db, {
          id: outing.id,
          endDateTime: end,
          comment: variant.draft.comment,
          hasBeenCoached: null,
        });
        const stopped = await exportClub(db);
        const stoppedEntry = entriesOf(stopped).get(key)!;
        const stoppedProblems = [
          ...(await entryProblems(
            db,
            stopped,
            stoppedEntry,
            (await loadOuting(db, outing.id))!
          )),
          ...statusProblems(stopped),
        ];
        if (stoppedEntry.Open === "true") {
          stoppedProblems.push("the entry is still open");
        }
        for (const problem of stoppedProblems) {
          problems.push(`${where}, then stopped: ${problem}`);
        }
      }
    }
  }
  return { problems, applied };
};

describe("re-saving every finished imported outing without any change", () => {
  test(
    "gives the untouched export, but for efa's LastModified",
    async () => {
      const base = await importClub();
      const finished = (await listImportedOutings(base)).filter(
        (o) => o.finished
      );
      expect(finished).toHaveLength(55);
      const problems: string[] = [];
      const versionMoved: string[] = [];

      for (const outing of finished) {
        const db = await importClub();
        const untouched = await exportClub(db);
        const result = await saveCorrection(
          db,
          "finished",
          await readDraft(db, outing.id)
        );
        const label = `${outing.logbook}/${outing.entryId}`;
        if (result.status !== "saved") {
          problems.push(`${label}: not saved ${JSON.stringify(result)}`);
          continue;
        }
        const corrected = await exportClub(db);
        const key = entryKey(outing.logbook, outing.entryId);
        const diff = diffFields(
          entriesOf(untouched).get(key),
          entriesOf(corrected).get(key)!
        );
        for (const field of VERSION_FIELDS) {
          if (diff[field]) versionMoved.push(`${label}.${field}`);
          delete diff[field];
        }
        if (Object.keys(diff).length > 0) {
          problems.push(`${label}: ${JSON.stringify(diff)}`);
        }
        if (
          projectWithout(untouched, new Set([key])) !==
          projectWithout(corrected, new Set([key]))
        ) {
          problems.push(`${label}: something else of the project changed`);
        }
        const statusBefore = statusesOf(untouched);
        for (const [boat, status] of statusesOf(corrected)) {
          if (
            JSON.stringify(status) !== JSON.stringify(statusBefore.get(boat))
          ) {
            problems.push(
              `${label}: boat status of ${status.BoatText} changed`
            );
          }
        }
      }
      expect(problems).toEqual([]);
      // Decision: a save is a save. The entries the export rewrites anyway
      // (free names turned into records, 12 here) take the save time as
      // LastModified; the others stay byte for byte as efa had them.
      expect(versionMoved).toHaveLength(12);
      expect(
        versionMoved.every((moved) => moved.endsWith(".LastModified"))
      ).toBe(true);
    },
    SLOW
  );
});

describe("a single scalar correction of every finished imported outing", () => {
  for (const scenario of finishedScenarios) {
    test(
      `${scenario.name}: only that field of the entry moves`,
      async () => {
        const { problems, applied } = await runScenario(scenario, {
          mode: "finished",
          select: (outing) => outing.finished,
        });
        expect(applied).toBeGreaterThan(0);
        expect(problems).toEqual([]);
      },
      SLOW
    );
  }
});

const ongoingScenarios: Scenario[] = [
  {
    name: "no change",
    variants: (draft) => [{ label: "same", draft, allowed: [] }],
  },
  ...finishedScenarios
    .filter((scenario) =>
      [
        "comment",
        "outing type",
        "captain removed or changed",
        "boat changed to another boat (any of its rigs)",
      ].includes(scenario.name)
    )
    .map((scenario) => ({
      ...scenario,
      variants: (draft: OutingDraft, context: Context) =>
        // A boat already on the water cannot take a second outing.
        scenario
          .variants(draft, context)
          .filter(
            (variant) =>
              variant.draft.boatId === draft.boatId ||
              !context.busyBoatIds.includes(variant.draft.boatId)
          ),
    })),
  {
    name: "start time",
    variants: (draft) =>
      [-1, 5, 60].map((minutes) => ({
        label: `${minutes} min`,
        draft: {
          ...draft,
          startDateTime: addMinutes(draft.startDateTime, minutes),
        },
        allowed: ["StartTime"],
      })),
  },
  {
    name: "estimated end",
    variants: (draft) => [
      {
        label: "estimated",
        draft: {
          ...draft,
          estimatedEndDateTime: addMinutes(draft.startDateTime, 90),
        },
        // efa2 has no such field.
        allowed: [],
      },
    ],
  },
];

describe("a single scalar correction of every ongoing imported outing", () => {
  for (const scenario of ongoingScenarios) {
    test(
      `${scenario.name}: only that field of the entry moves, boat statuses stay consistent`,
      async () => {
        const { problems, applied } = await runScenario(scenario, {
          mode: "ongoing",
          select: (outing) => !outing.finished,
        });
        expect(applied).toBeGreaterThan(0);
        expect(problems).toEqual([]);
      },
      SLOW
    );
  }
});

const statusOfOuting = async (db: SqlClient, outing: ImportedOuting) => {
  const statuses = [...statusesOf(await exportClub(db)).values()].filter(
    (status) =>
      status.Logbook === outing.logbook && status.EntryNo === outing.entryId
  );
  return statuses[0] ?? {};
};

describe("every outing corrected in the same club", () => {
  test(
    "each entry says what the database says, nothing else moves",
    async () => {
      const db = await importClub();
      const untouched = await exportClub(db);
      const outings = await listImportedOutings(db);
      const problems: string[] = [];
      const changed = new Set<string>();

      // A different scalar change per outing, finished and ongoing alike.
      for (const [index, outing] of outings.entries()) {
        const draft = await readDraft(db, outing.id);
        const scenario = [
          finishedScenarios[0],
          finishedScenarios[1],
          finishedScenarios[4],
          finishedScenarios[5],
        ][index % 4];
        const [variant] = scenario
          .variants(draft, await contextOf(db, index))
          .filter(
            (candidate) =>
              outing.finished ||
              ["comment", "outing type"].includes(scenario.name) ||
              candidate.draft.startDateTime !== draft.startDateTime
          );
        if (!variant) continue;
        const result = await saveCorrection(
          db,
          outing.finished ? "finished" : "ongoing",
          variant.draft
        );
        if (result.status !== "saved") {
          problems.push(
            `${outing.logbook}/${outing.entryId}: ${result.status}`
          );
        }
        changed.add(entryKey(outing.logbook, outing.entryId));
      }

      const project = await exportClub(db);
      const entries = entriesOf(project);
      expect(entries.size).toBe(entriesOf(untouched).size);
      for (const outing of outings) {
        const key = entryKey(outing.logbook, outing.entryId);
        for (const problem of await entryProblems(
          db,
          project,
          entries.get(key)!,
          (await loadOuting(db, outing.id))!
        )) {
          problems.push(`${key}: ${problem}`);
        }
      }
      problems.push(...statusProblems(project));
      expect(changed.size).toBeGreaterThan(40);
      expect(problems).toEqual([]);
    },
    SLOW
  );
});

describe("boat statuses of ongoing outings", () => {
  const ongoingOutings = async () =>
    (await listImportedOutings(await importClub())).filter((o) => !o.finished);

  // efa's "on the water since… with…" text stays while what it says
  // (destination, start, boat, crew) is what efa recorded.
  test("a save that changes nothing leaves the boat statuses alone", async () => {
    const problems: string[] = [];
    for (const outing of await ongoingOutings()) {
      const db = await importClub();
      const untouched = statusesOf(await exportClub(db));
      await saveCorrection(db, "ongoing", await readDraft(db, outing.id));
      const saved = statusesOf(await exportClub(db));
      for (const [boat, status] of untouched) {
        const moved = diffFields(status, saved.get(boat) ?? {});
        if (Object.keys(moved).length > 0) {
          problems.push(
            `${outing.logbook}/${outing.entryId}: ${status.BoatText} ${JSON.stringify(moved)}`
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // A comment, an outing type or a captain change does not make the text
  // ("unterwegs nach <destination> seit <start> mit <crew>") wrong.
  test("a comment change keeps efa's on-the-water text", async () => {
    for (const outing of await ongoingOutings()) {
      const db = await importClub();
      const text = (await statusOfOuting(db, outing)).Comment;
      expect(text).toBeTruthy();
      await saveCorrection(db, "ongoing", {
        ...(await readDraft(db, outing.id)),
        comment: "Corrigé",
      });
      expect((await statusOfOuting(db, outing)).Comment).toBe(text);
    }
  });
});

// ----- Entries efa could have written that the fixture has none of -----

const SYNTHETIC: Record<string, Efa2Fields> = {
  overnight: {
    EntryId: "26",
    Date: "10.10.2026",
    StartTime: "22:30:00",
    EndTime: "01:15:00",
    Distance: "9 km",
  },
  explicitMidnight: {
    EntryId: "27",
    Date: "11.10.2026",
    StartTime: "00:00:00",
    EndTime: "00:00:00",
    Distance: "0 km",
  },
  minimal: {
    EntryId: "28",
    Date: "12.10.2026",
    StartTime: "10:00:00",
    EndTime: "11:00:00",
  },
  endDateSameDay: {
    EntryId: "29",
    Date: "13.10.2026",
    EndDate: "13.10.2026",
    StartTime: "10:00:00",
    EndTime: "11:00:00",
    Distance: "5 km",
  },
  oddTexts: {
    EntryId: "30",
    Date: "9.5.2026",
    StartTime: "9:05:30",
    EndTime: "10:10:45",
    Distance: "12,5 km",
    SessionType: "MyType",
    Comments: "  spaces  ",
  },
  openToday: {
    EntryId: "32",
    Date: "19.10.2026",
    StartTime: "08:00:00",
    Open: "true",
  },
  leftOpen: {
    EntryId: "31",
    Date: "14.10.2026",
    StartTime: "09:00:00",
    Open: "true",
    Distance: "3 km",
  },
};

const withSyntheticEntries = () => {
  const project = readFixtureProject();
  const logbook = findObjects(project, "efa2logbook").find(
    (object) => object.name === "2026"
  )!;
  const template = logbook.records.find((record) => record.EntryId === "18")!;
  for (const entry of Object.values(SYNTHETIC)) {
    const record: Efa2Fields = {
      ...template,
      ...entry,
      ChangeCount: "1",
      LastModified: "1792397149700",
    };
    // What the entry does not say, it does not say at all.
    delete record.DestinationId;
    if (!entry.EndTime) delete record.EndTime;
    if (!entry.SessionType) record.SessionType = "NORMAL";
    if (entry.EntryId === "28") {
      delete record.SessionType;
      delete record.BoatVariant;
    }
    logbook.records.push(record);
  }
  return project;
};

describe("entries efa could have written, that the fixture has none of", () => {
  const isSynthetic = (outing: ImportedOuting) =>
    outing.logbook === "2026" && Number(outing.entryId) >= 26;
  const isFinishedSynthetic = (outing: ImportedOuting) =>
    isSynthetic(outing) && outing.finished;

  test("untouched, they come back as efa had them but for documented normalisations", async () => {
    const db = await importClub(withSyntheticEntries());
    const project = await exportClub(db);
    const exported = entriesOf(project);
    const raw = entriesOf(withSyntheticEntries());
    const problems = statusProblems(project);
    const normalised: Record<string, string[]> = {};

    for (const outing of (await listImportedOutings(db)).filter(isSynthetic)) {
      const key = entryKey(outing.logbook, outing.entryId);
      const diff = diffFields(raw.get(key), exported.get(key)!);
      delete diff.ChangeCount;
      normalised[outing.entryId] = Object.keys(diff).sort();
      problems.push(
        ...(
          await entryProblems(
            db,
            project,
            exported.get(key)!,
            (await loadOuting(db, outing.id))!
          )
        ).map((problem) => `${key}: ${problem}`)
      );
    }
    expect(problems).toEqual([]);
    expect(normalised).toEqual({
      // read the same way by efa
      "26": [],
      "27": [],
      // efa's default type and the end date of a one-day entry are written
      // or dropped
      "28": ["SessionType"],
      "29": ["EndDate"],
      "30": [],
      // left open in efa before today: closed by the import, with a note
      "31": ["Comments", "Open"],
      // on the water today
      "32": [],
    });
  });

  for (const scenario of finishedScenarios) {
    test(
      `${scenario.name}: only that field of the entry moves`,
      async () => {
        const { problems, applied } = await runScenario(
          scenario,
          { mode: "finished", select: isFinishedSynthetic },
          withSyntheticEntries
        );
        expect(applied).toBeGreaterThan(0);
        expect(problems).toEqual([]);
      },
      SLOW
    );
  }

  for (const scenario of ongoingScenarios) {
    test(
      `ongoing, ${scenario.name}: only that field of the entry moves, boat statuses stay consistent`,
      async () => {
        const { problems, applied } = await runScenario(
          scenario,
          {
            mode: "ongoing",
            select: (outing) => isSynthetic(outing) && !outing.finished,
          },
          withSyntheticEntries
        );
        expect(applied).toBeGreaterThan(0);
        expect(problems).toEqual([]);
      },
      SLOW
    );
  }
});
