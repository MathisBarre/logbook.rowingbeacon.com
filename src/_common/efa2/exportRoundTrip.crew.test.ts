import { describe, expect, test } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import {
  loadOuting,
  OutingToSave,
  updateOuting,
} from "../database/repositories/club.repository";
import { SqlClient } from "../database/sqlClient";
import { OutingDraft } from "../../logbook/business/EditOuting/outingDraft";
import { readFinishedOutingDraft } from "../../logbook/business/EditOuting/loadOutingDraft";
import { readFixtureProject } from "./__fixtures__/readFixtureProject";
import { runEfa2Import } from "./runEfa2Import";
import { buildEfa2Export } from "./buildEfa2Export";
import { deriveEfa2Id } from "./planEfa2Import";
import {
  Efa2Project,
  findObject,
  findObjects,
  readEfa2ProjectFromZip,
  writeEfa2BackupZip,
} from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";

/**
 * Round trips of crew corrections: efa2 import, a correction through the real
 * repository path (readFinishedOutingDraft, then updateOuting as
 * SaveOutingUsecase calls it), efa2 export. The export of the corrected club
 * is compared with the export of the untouched club, entry by entry.
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

const importProject = async (project: Efa2Project) => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  await runEfa2Import(db, project, {
    backup: () => Promise.resolve(),
    labels: importLabels,
    now,
  });
  return db;
};

// ---------------------------------------------------------------------------
// The efa fixture, made harder: seat gaps, efa's AllCrewNames, a captain on a
// gap seat, on the cox, a cox-only crew. Typed names (CrewNName) and the
// "Krause, Zoe" style are already in the fixture.
// ---------------------------------------------------------------------------

const SEATS = Array.from({ length: 24 }, (_, i) => i + 1);

const prepareProject = (): Efa2Project => {
  const project = readFixtureProject();
  const persons = new Map(
    (findObject(project, "efa2persons")?.records ?? []).map((p) => [
      p.Id,
      `${p.FirstName} ${p.LastName}`.trim(),
    ])
  );
  const logbooks = findObjects(project, "efa2logbook");
  const entryOf = (logbook: string, entryId: string) => {
    const entry = logbooks
      .find((l) => l.name === logbook)
      ?.records.find((r) => r.EntryId === entryId);
    if (!entry) throw new Error(`fixture entry ${logbook}/${entryId} missing`);
    return entry;
  };
  /** Moves Crew<from>Id/Name to Crew<to>…; the captain follows. */
  const reseat = (entry: Efa2Fields, mapping: Record<number, number>) => {
    const moved: Efa2Fields = {};
    for (const seat of SEATS) {
      for (const kind of ["Id", "Name"]) {
        const key = `Crew${seat}${kind}`;
        if (entry[key] !== undefined) {
          moved[`Crew${mapping[seat] ?? seat}${kind}`] = entry[key];
          delete entry[key];
        }
      }
    }
    Object.assign(entry, moved);
    if (entry.BoatCaptain && mapping[Number(entry.BoatCaptain)]) {
      entry.BoatCaptain = String(mapping[Number(entry.BoatCaptain)]);
    }
  };

  // Gaps (efa leaves a seat empty when a rower is removed).
  reseat(entryOf("2026", "2"), { 1: 2, 2: 5 }); // cox + 2 rowers
  reseat(entryOf("2026", "3"), { 1: 1, 2: 3, 3: 4, 4: 7 });
  reseat(entryOf("2026", "1"), { 1: 3, 2: 4, 3: 6, 4: 9 }); // captain on 3
  reseat(entryOf("2025", "3"), { 1: 2, 2: 3, 3: 5, 4: 24 }); // seat 24 used
  reseat(entryOf("2025", "23"), { 1: 2, 2: 4, 3: 6 }); // typed names + cox name
  reseat(entryOf("2025", "31"), { 1: 4, 2: 5 }); // "Krause, Zoe"
  reseat(entryOf("2026", "4"), { 1: 5 }); // single rower
  entryOf("2025", "8").BoatCaptain = "0"; // the cox is captain
  entryOf("2026", "5").BoatCaptain = "4"; // last rower is captain
  // A crew with a cox and no rower.
  const coxOnly = entryOf("2025", "10");
  coxOnly.CoxId = coxOnly.Crew1Id;
  delete coxOnly.Crew1Id;

  // efa writes the names of the whole crew next to the ids.
  for (const logbook of logbooks) {
    for (const entry of logbook.records) {
      const names = ["Cox", ...SEATS.map((seat) => `Crew${seat}`)]
        .map((prefix) =>
          entry[`${prefix}Id`]
            ? persons.get(entry[`${prefix}Id`])
            : entry[`${prefix}Name`]
        )
        .filter(Boolean);
      if (names.length > 0) entry.AllCrewNames = names.join(", ");
    }
  }
  return project;
};

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

type ExportResult = Awaited<ReturnType<typeof buildEfa2Export>>;

const entryKey = (logbook: string, entryId: string) => `${logbook}|${entryId}`;

const entriesOf = (project: Efa2Project) =>
  new Map(
    findObjects(project, "efa2logbook").flatMap((logbook) =>
      logbook.records.map(
        (entry) => [entryKey(logbook.name, entry.EntryId), entry] as const
      )
    )
  );

/** Everything but the logbook entries. */
/**
 * Everything but the logbook entries. A crew change of an outing still on
 * the water drops efa's "on the water since… with…" text from its boat
 * status: with `onWater`, those status fields are left out.
 */
const restOf = (project: Efa2Project, onWater = false) =>
  JSON.stringify({
    projectRecords: project.projectRecords,
    objects: project.objects.map((object) =>
      object.type === "efa2logbook"
        ? { type: object.type, name: object.name }
        : onWater && object.type === "efa2boatstatus"
          ? {
              ...object,
              records: object.records.map((record) =>
                record.CurrentStatus === "ONTHEWATER"
                  ? {
                      ...record,
                      Comment: undefined,
                      ChangeCount: undefined,
                      LastModified: undefined,
                    }
                  : record
              ),
            }
          : object
    ),
  });

const exportClub = (db: SqlClient): Promise<ExportResult> =>
  buildEfa2Export(db, { labels: exportLabels, now });

const SEAT_FIELD = /^(Cox|Crew\d+)(Id|Name)$/;
const isAllowedDiff = (key: string, extra: string[] = []) =>
  extra.includes(key) ||
  SEAT_FIELD.test(key) ||
  key === "AllCrewNames" ||
  key === "BoatCaptain" ||
  key === "ChangeCount" ||
  key === "LastModified";

const seatsOf = (entry: Efa2Fields) =>
  SEATS.filter((seat) => entry[`Crew${seat}Id`]).map(
    (seat) => [seat, entry[`Crew${seat}Id`]] as const
  );

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

interface Environment {
  db: SqlClient;
  project: Efa2Project;
  /** Every outing the efa project made, with where its entry sits. */
  outings: { id: string; logbook: string; entryId: string }[];
  pool: string[];
  names: Map<string, string[]>;
  last: ExportResult;
}

const createEnvironment = async (
  setup?: (db: SqlClient, env: Pick<Environment, "outings">) => Promise<void>
): Promise<Environment> => {
  const project = prepareProject();
  const db = await importProject(project);
  const outings = findObjects(project, "efa2logbook").flatMap((logbook) =>
    logbook.records.map((entry) => ({
      id: deriveEfa2Id(`outing:${logbook.name}:${entry.EntryId}`),
      logbook: logbook.name,
      entryId: entry.EntryId,
    }))
  );
  await setup?.(db, { outings });
  const rowers = await db.select<
    { id: string; first_name: string; last_name: string }[]
  >("SELECT id, first_name, last_name FROM rower ORDER BY id");
  return {
    db,
    project,
    outings,
    pool: rowers.map((r) => r.id),
    names: new Map(
      rowers.map((r) => [
        r.id,
        [
          `${r.first_name} ${r.last_name}`.trim(),
          `${r.last_name}, ${r.first_name}`,
        ],
      ])
    ),
    last: await exportClub(db),
  };
};

interface EditContext {
  /** Position of the outing among those edited, to vary who is added. */
  index: number;
  /** The n-th rower who is not in the crew. */
  fresh: (draft: OutingDraft, n?: number) => string;
  random: () => number;
}
type Edit = (draft: OutingDraft, context: EditContext) => OutingDraft | null;

const crewOf = (draft: OutingDraft) => [
  ...draft.rowerIds,
  ...(draft.coxId ? [draft.coxId] : []),
];

/** As the editor does: a captain who left the crew is cleared. */
const settle = (draft: OutingDraft): OutingDraft => ({
  ...draft,
  captainRowerId:
    draft.captainRowerId && crewOf(draft).includes(draft.captainRowerId)
      ? draft.captainRowerId
      : null,
});

/** The OutingToSave SaveOutingUsecase builds for a finished outing. */
const toOutingToSave = (draft: OutingDraft): OutingToSave => ({
  id: draft.id as string,
  boatId: draft.boatId,
  boatConfigurationId: draft.boatConfigurationId,
  routeId: draft.routeId,
  outingTypeCode: draft.outingTypeCode,
  captainRowerId: draft.captainRowerId,
  startDateTime: draft.startDateTime,
  estimatedEndDateTime: draft.estimatedEndDateTime,
  endDateTime: draft.endDateTime,
  distanceM: draft.distanceM,
  comment: draft.comment,
  hasBeenCoached: draft.hasBeenCoached,
  crew: [
    ...draft.rowerIds.map((rowerId) => ({ rowerId, role: "rower" as const })),
    ...(draft.coxId ? [{ rowerId: draft.coxId, role: "cox" as const }] : []),
  ],
});

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The draft of a finished outing, or of an ongoing one (as the editor loads it). */
const readDraft = async (
  db: SqlClient,
  id: string,
  ongoing = false
): Promise<OutingDraft | null> => {
  if (!ongoing) return readFinishedOutingDraft(db, id);
  const outing = await loadOuting(db, id);
  if (!outing || outing.endDateTime !== null) return null;
  return {
    id: outing.id,
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

interface Change {
  id: string;
  key: string;
  before: OutingDraft;
  /** What the editor sent. */
  intended: OutingDraft;
  /**
   * Seats of the rowers before the correction, when they are efa seats (1 to
   * 24, no two alike): a crew entered in Rowing Beacon, or an efa crew with
   * only a cox that was given rowers, has none to keep.
   */
  efaSeats: Map<string, number>;
}
interface Round {
  ongoing: boolean;
  before: ExportResult;
  after: ExportResult;
  changes: Change[];
  /** Outings left alone on purpose, to see that nothing leaks to them. */
  untouched: string[];
}

/**
 * Corrects every other finished outing that has a crew and the edit applies
 * to; the others are a control group.
 */
const applyRound = async (
  env: Environment,
  edit: Edit,
  { seed = 1, ongoing = false }: { seed?: number; ongoing?: boolean } = {}
): Promise<Round> => {
  const random = mulberry32(seed);
  const changes: Change[] = [];
  const untouched: string[] = [];
  let applicable = 0;
  for (const outing of env.outings) {
    const before = await readDraft(env.db, outing.id, ongoing);
    if (!before || crewOf(before).length === 0) continue;
    const key = entryKey(outing.logbook, outing.entryId);
    const index = applicable;
    const intended = edit(before, {
      index,
      random,
      fresh: (draft, n = 0) => {
        const candidates = env.pool.filter((id) => !crewOf(draft).includes(id));
        return candidates[(index * 5 + n) % candidates.length];
      },
    });
    if (!intended) continue;
    applicable++;
    if (index % 2 === 1) {
      untouched.push(key);
      continue;
    }
    const stored = await env.db.select<
      { rower_id: string; position: number }[]
    >(
      "SELECT rower_id, position FROM outing_crew WHERE outing_id = $1 AND role = 'rower'",
      [outing.id]
    );
    const isEfaSeats =
      stored.length > 0 &&
      stored.every((row) => row.position >= 1 && row.position <= 24) &&
      new Set(stored.map((row) => row.position)).size === stored.length;
    const efaSeats = new Map(
      isEfaSeats ? stored.map((row) => [row.rower_id, row.position]) : []
    );
    const settled = settle(intended);
    expect(
      await updateOuting(env.db, toOutingToSave(settled), {
        onlyIfFinished: !ongoing,
        onlyIfOngoing: ongoing,
      })
    ).toBe(true);
    changes.push({ id: outing.id, key, before, intended: settled, efaSeats });
  }
  const after = await exportClub(env.db);
  const round = { ongoing, before: env.last, after, changes, untouched };
  env.last = after;
  return round;
};

// ---------------------------------------------------------------------------
// The model: what the export of a corrected outing must say
// ---------------------------------------------------------------------------

/**
 * Spec of round 4 (a): rowers who stay keep their efa seat, a new rower takes
 * the first free seat after the rower before them; when the editor's order
 * cannot be followed (swapped rowers, no seat left), seats are 1..n.
 */
const expectedSeats = (previous: Map<string, number>, rowers: string[]) => {
  const renumbered = rowers.map((_, index) => index + 1);
  if (previous.size === 0) return renumbered;
  const staying = rowers.filter((id) => previous.has(id));
  const stayingSeats = staying.map((id) => previous.get(id) as number);
  if (stayingSeats.some((seat, i) => i > 0 && seat <= stayingSeats[i - 1])) {
    return renumbered;
  }
  const taken = new Set(stayingSeats);
  const seats: number[] = [];
  let last = 0;
  for (const id of rowers) {
    let seat = previous.get(id);
    if (seat === undefined) {
      seat = last + 1;
      while (taken.has(seat)) seat++;
      taken.add(seat);
    }
    if (seat <= last || seat > 24) return renumbered;
    seats.push(seat);
    last = seat;
  }
  return seats;
};

const describeEntry = (entry: Efa2Fields | undefined) =>
  entry
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(entry).filter(
            ([key]) => SEAT_FIELD.test(key) || key === "BoatCaptain"
          )
        )
      )
    : "(missing)";

const isCrewChange = (a: OutingDraft, b: OutingDraft) =>
  JSON.stringify([a.rowerIds, a.coxId]) !==
  JSON.stringify([b.rowerIds, b.coxId]);

/** Messages of every property the corrected export breaks. */
const verifyRound = async (
  env: Environment,
  round: Round,
  { editedFields = [] }: { editedFields?: string[] } = {}
) => {
  const failures: string[] = [];
  const fail = (key: string, message: string) =>
    failures.push(`${key}: ${message}`);
  const before = entriesOf(round.before.project);
  const after = entriesOf(round.after.project);

  // Nothing but the entries changes; same entries in the same logbooks.
  if (
    restOf(round.before.project, round.ongoing) !==
    restOf(round.after.project, round.ongoing)
  ) {
    failures.push("objects other than the logbook entries changed");
  }
  if (
    JSON.stringify([...before.keys()]) !== JSON.stringify([...after.keys()])
  ) {
    failures.push("the set of entries changed");
  }
  for (const key of round.untouched) {
    if (JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))) {
      fail(key, "an outing nobody corrected changed");
    }
  }
  const changedKeys = new Set(round.changes.map((change) => change.key));
  for (const [key, entry] of before) {
    if (changedKeys.has(key)) continue;
    if (JSON.stringify(entry) !== JSON.stringify(after.get(key))) {
      fail(key, "an entry that was not corrected changed");
    }
  }

  for (const change of round.changes) {
    const { key, intended } = change;
    const previous = before.get(key) as Efa2Fields;
    const entry = after.get(key);
    if (!entry) {
      fail(key, "entry missing");
      continue;
    }

    // Only crew fields (and the change bookkeeping) may differ.
    for (const field of new Set([
      ...Object.keys(previous),
      ...Object.keys(entry),
    ])) {
      if (
        !isAllowedDiff(field, editedFields) &&
        previous[field] !== entry[field]
      ) {
        fail(key, `${field} changed: ${previous[field]} -> ${entry[field]}`);
      }
    }

    // The database holds what the editor sent.
    const stored = await readDraft(env.db, change.id, round.ongoing);
    if (
      !stored ||
      JSON.stringify([stored.rowerIds, stored.coxId, stored.captainRowerId]) !==
        JSON.stringify([
          intended.rowerIds,
          intended.coxId,
          intended.captainRowerId,
        ])
    ) {
      fail(
        key,
        `stored crew ${JSON.stringify(stored)} is not what was saved ${JSON.stringify(
          [intended.rowerIds, intended.coxId, intended.captainRowerId]
        )}`
      );
    }

    // Cox.
    if ((entry.CoxId ?? null) !== intended.coxId) {
      fail(key, `CoxId ${entry.CoxId} expected ${intended.coxId}`);
    }
    // Rowers: the editor's order, on the seats of the model.
    const previousSeats = change.efaSeats;
    const seats = expectedSeats(previousSeats, intended.rowerIds);
    const exported = seatsOf(entry);
    const expected = intended.rowerIds.map((id, i) => [seats[i], id] as const);
    if (JSON.stringify(exported) !== JSON.stringify(expected)) {
      fail(
        key,
        `seats ${JSON.stringify(exported)} expected ${JSON.stringify(expected)} (was ${JSON.stringify([...previousSeats])})`
      );
    }
    // No duplicate id, no name field left.
    const ids = Object.entries(entry)
      .filter(([field]) => /^(Cox|Crew\d+)Id$/.test(field))
      .map(([, id]) => id);
    if (new Set(ids).size !== ids.length) {
      fail(key, `duplicate ids ${ids.join(",")}`);
    }
    // Captain.
    const captainSeat = intended.captainRowerId
      ? intended.captainRowerId === intended.coxId
        ? "0"
        : String(exported.find(([, id]) => id === intended.captainRowerId)?.[0])
      : undefined;
    if (entry.BoatCaptain !== captainSeat) {
      fail(key, `BoatCaptain ${entry.BoatCaptain} expected ${captainSeat}`);
    }

    // People who left must not stay in the entry (GDPR), nor in what the
    // database keeps of efa's entry.
    const gone = crewOf(change.before).filter(
      (id) => !crewOf(intended).includes(id)
    );
    const [row] = await env.db.select<{ fields: string }[]>(
      "SELECT fields FROM efa_record WHERE object_type = 'efa2logbook' AND rb_table = 'outing' AND rb_id = $1",
      [change.id]
    );
    const kept = row ? (JSON.parse(row.fields) as Efa2Fields) : {};
    const crewChanged =
      isCrewChange(change.before, intended) || gone.length > 0;
    const texts = [JSON.stringify(entry), row?.fields ?? ""];
    for (const id of gone) {
      for (const name of env.names.get(id) ?? []) {
        if (texts.some((text) => text.includes(name))) {
          fail(key, `${name} left the crew but is still in the entry`);
        }
      }
    }
    if (crewChanged) {
      const nameFields = Object.keys({ ...kept, ...entry }).filter((field) =>
        /^(Cox|Crew\d+)Name$|^AllCrewNames$/.test(field)
      );
      if (nameFields.length > 0) {
        fail(key, `names left over: ${nameFields.join(",")}`);
      }
    }
  }
  return failures;
};

/** The export imported again gives the same crews. */
const reimportFailures = async (env: Environment) => {
  const { project } = await exportClub(env.db);
  const again = await importProject(
    readEfa2ProjectFromZip(writeEfa2BackupZip(project, now.getTime()))
  );
  const read = async (db: SqlClient) => {
    const outings = await db.select<
      { id: string; captain_rower_id: string | null }[]
    >("SELECT id, captain_rower_id FROM outing ORDER BY id");
    const crew = await db.select<
      { outing_id: string; rower_id: string; role: string; position: number }[]
    >("SELECT * FROM outing_crew ORDER BY outing_id, position, rower_id");
    return new Map(
      outings.map((outing) => {
        const members = crew.filter((c) => c.outing_id === outing.id);
        return [
          outing.id,
          {
            captain: outing.captain_rower_id,
            rowers: members
              .filter((m) => m.role === "rower")
              .map((m) => m.rower_id),
            coxes: members
              .filter((m) => m.role === "cox")
              .map((m) => m.rower_id),
          },
        ] as const;
      })
    );
  };
  const exportedEntries = entriesOf(project);
  // Exporting the re-imported club gives the same crews again.
  const second = entriesOf((await exportClub(again)).project);
  const unstable: string[] = [];
  for (const [key, entry] of exportedEntries) {
    if (describeEntry(entry) !== describeEntry(second.get(key))) {
      unstable.push(
        `${key}: ${describeEntry(second.get(key))} expected ${describeEntry(entry)}`
      );
    }
  }
  const seatRows = await again.select<
    { outing_id: string; rower_id: string; position: number }[]
  >(
    "SELECT outing_id, rower_id, position FROM outing_crew WHERE role = 'rower' ORDER BY outing_id, position"
  );
  const original = await read(env.db);
  const reimported = await read(again);
  const failures: string[] = [...unstable];
  for (const [id, outing] of original) {
    const other = reimported.get(id);
    if (!other) {
      failures.push(`${id}: outing missing after the re-import`);
      continue;
    }
    // efa2 has one cox: the others are reported as cut (crewsCut).
    const shown = (await readFinishedOutingDraft(env.db, id))?.coxId;
    const expectedCoxes =
      outing.coxes.length > 0 ? [shown ?? outing.coxes[0]] : [];
    const entry = env.outings.find((o) => o.id === id);
    const exportedSeats = seatsOf(
      exportedEntries.get(
        entryKey(entry?.logbook ?? "", entry?.entryId ?? "")
      ) ?? {}
    );
    const importedSeats = seatRows
      .filter((row) => row.outing_id === id)
      .map((row) => [row.position, row.rower_id]);
    if (JSON.stringify(importedSeats) !== JSON.stringify(exportedSeats)) {
      failures.push(
        `${entry?.logbook}/${entry?.entryId}: re-imported seats ${JSON.stringify(importedSeats)} expected ${JSON.stringify(exportedSeats)}`
      );
    }
    const description = `${entry?.logbook}/${entry?.entryId}`;
    if (JSON.stringify(other.rowers) !== JSON.stringify(outing.rowers)) {
      failures.push(
        `${description}: rowers ${JSON.stringify(other.rowers)} expected ${JSON.stringify(outing.rowers)}`
      );
    }
    if (JSON.stringify(other.coxes) !== JSON.stringify(expectedCoxes)) {
      failures.push(
        `${description}: cox ${JSON.stringify(other.coxes)} expected ${JSON.stringify(expectedCoxes)}`
      );
    }
    // A captain who is one of several coxes has no seat in efa2: the crew
    // is counted as cut.
    const captainIsHiddenCox =
      outing.captain !== null &&
      outing.coxes.includes(outing.captain) &&
      !expectedCoxes.includes(outing.captain);
    if (!captainIsHiddenCox && other.captain !== outing.captain) {
      failures.push(
        `${description}: captain ${other.captain} expected ${outing.captain}`
      );
    }
  }
  return failures;
};

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const reorder = (
  name: string,
  move: (rowers: string[]) => string[],
  min = 2
): [string, Edit] => [
  name,
  (draft) =>
    draft.rowerIds.length >= min
      ? { ...draft, rowerIds: move(draft.rowerIds) }
      : null,
];

const swap = (a: number, b: number) => (rowers: string[]) => {
  const next = [...rowers];
  const [i, j] = [a < 0 ? rowers.length + a : a, b < 0 ? rowers.length + b : b];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

const insertAt = (
  where: "start" | "middle" | "end",
  min: number
): [string, Edit] => [
  `adds a rower at the ${where}`,
  (draft, { fresh }) => {
    if (draft.rowerIds.length < min || draft.rowerIds.length >= 24) return null;
    const at =
      where === "start"
        ? 0
        : where === "end"
          ? draft.rowerIds.length
          : Math.floor(draft.rowerIds.length / 2);
    const rowerIds = [...draft.rowerIds];
    rowerIds.splice(at, 0, fresh(draft));
    return { ...draft, rowerIds };
  },
];

const removeAt = (where: "first" | "middle" | "last"): [string, Edit] => [
  `removes the ${where} rower`,
  (draft) => {
    if (draft.rowerIds.length < 2) return null;
    const at =
      where === "first"
        ? 0
        : where === "last"
          ? draft.rowerIds.length - 1
          : Math.floor(draft.rowerIds.length / 2);
    return { ...draft, rowerIds: draft.rowerIds.filter((_, i) => i !== at) };
  },
];

const replaceAt = (where: "first" | "middle" | "last"): [string, Edit] => [
  `replaces the ${where} rower`,
  (draft, { fresh }) => {
    if (draft.rowerIds.length < 1) return null;
    const at =
      where === "first"
        ? 0
        : where === "last"
          ? draft.rowerIds.length - 1
          : Math.floor(draft.rowerIds.length / 2);
    return {
      ...draft,
      rowerIds: draft.rowerIds.map((id, i) => (i === at ? fresh(draft) : id)),
    };
  },
];

const rowerEdits: [string, Edit][] = [
  [
    "gives rowers to a crew that has only a cox",
    (draft, { fresh }) =>
      draft.rowerIds.length === 0 && draft.coxId
        ? { ...draft, rowerIds: [fresh(draft, 0), fresh(draft, 1)] }
        : null,
  ],
  reorder("reverses the rowers", (rowers) => [...rowers].reverse()),
  reorder("swaps the first two rowers", swap(0, 1)),
  reorder("swaps the first and the last rower", swap(0, -1)),
  reorder("swaps two rowers in the middle", swap(1, -2), 4),
  reorder("moves the last rower first", (rowers) => [
    rowers[rowers.length - 1],
    ...rowers.slice(0, -1),
  ]),
  reorder("moves the first rower last", (rowers) => [
    ...rowers.slice(1),
    rowers[0],
  ]),
  insertAt("start", 1),
  insertAt("middle", 2),
  insertAt("end", 1),
  removeAt("first"),
  removeAt("middle"),
  removeAt("last"),
  replaceAt("first"),
  replaceAt("middle"),
  replaceAt("last"),
];

const coxEdits: [string, Edit][] = [
  [
    "sets a cox on a crew without one",
    (draft, { fresh }) =>
      draft.coxId ? null : { ...draft, coxId: fresh(draft) },
  ],
  [
    "changes the cox",
    (draft, { fresh }) =>
      draft.coxId ? { ...draft, coxId: fresh(draft) } : null,
  ],
  [
    "removes the cox",
    (draft) =>
      draft.coxId && draft.rowerIds.length ? { ...draft, coxId: null } : null,
  ],
  [
    "swaps the first rower and the cox",
    (draft) =>
      draft.coxId && draft.rowerIds.length
        ? {
            ...draft,
            coxId: draft.rowerIds[0],
            rowerIds: [draft.coxId, ...draft.rowerIds.slice(1)],
          }
        : null,
  ],
  [
    "swaps the last rower and the cox",
    (draft) =>
      draft.coxId && draft.rowerIds.length
        ? {
            ...draft,
            coxId: draft.rowerIds[draft.rowerIds.length - 1],
            rowerIds: [...draft.rowerIds.slice(0, -1), draft.coxId],
          }
        : null,
  ],
  [
    "makes a rower the cox and brings in a new rower",
    (draft, { fresh }) =>
      draft.rowerIds.length >= 2
        ? {
            ...draft,
            coxId: draft.rowerIds[1],
            rowerIds: [
              draft.rowerIds[0],
              fresh(draft),
              ...draft.rowerIds.slice(2),
            ],
          }
        : null,
  ],
];

const captainEdits: [string, Edit][] = [
  [
    "makes the last rower captain",
    (draft) =>
      draft.rowerIds.length
        ? {
            ...draft,
            captainRowerId: draft.rowerIds[draft.rowerIds.length - 1],
          }
        : null,
  ],
  [
    "makes the first rower captain",
    (draft) =>
      draft.rowerIds.length
        ? { ...draft, captainRowerId: draft.rowerIds[0] }
        : null,
  ],
  [
    "makes the cox captain",
    (draft) => (draft.coxId ? { ...draft, captainRowerId: draft.coxId } : null),
  ],
  [
    "removes the captain",
    (draft) =>
      draft.captainRowerId ? { ...draft, captainRowerId: null } : null,
  ],
  [
    "keeps the captain on the right seat when the rowers are reversed",
    (draft) =>
      draft.rowerIds.length >= 2
        ? {
            ...draft,
            captainRowerId: draft.captainRowerId ?? draft.rowerIds[1],
            rowerIds: [...draft.rowerIds].reverse(),
          }
        : null,
  ],
  [
    "keeps the captain when a rower is added in front",
    (draft, { fresh }) =>
      draft.rowerIds.length >= 1 && draft.rowerIds.length < 24
        ? {
            ...draft,
            captainRowerId: draft.captainRowerId ?? draft.rowerIds[0],
            rowerIds: [fresh(draft), ...draft.rowerIds],
          }
        : null,
  ],
  [
    "clears the captain who is removed from the crew",
    (draft) =>
      draft.captainRowerId && draft.rowerIds.length >= 2
        ? {
            ...draft,
            rowerIds: draft.rowerIds.filter(
              (id) => id !== draft.captainRowerId
            ),
          }
        : null,
  ],
];

const editNamed = (name: string): Edit => {
  const found = [...rowerEdits, ...coxEdits, ...captainEdits].find(
    ([title]) => title === name
  );
  if (!found) throw new Error(`no edit named ${name}`);
  return found[1];
};

/** A random mix of the edits above, for a sequence of corrections. */
const randomEdit: Edit = (draft, context) => {
  const all = [...rowerEdits, ...coxEdits, ...captainEdits];
  for (let attempt = 0; attempt < 20; attempt++) {
    const [, edit] = all[Math.floor(context.random() * all.length)];
    const edited = edit(draft, context);
    if (edited) return edited;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("efa2 export after a crew correction", () => {
  test("the fixture has what the properties need", async () => {
    const env = await createEnvironment();
    const withCrew = [];
    for (const outing of env.outings) {
      const draft = await readFinishedOutingDraft(env.db, outing.id);
      if (draft && crewOf(draft).length > 0) withCrew.push(draft);
    }
    expect(withCrew.length).toBeGreaterThanOrEqual(45);
    expect(withCrew.some((d) => d.coxId)).toBe(true);
    expect(withCrew.some((d) => d.captainRowerId)).toBe(true);
    expect(withCrew.some((d) => d.rowerIds.length === 0)).toBe(true);
    // Seats with gaps made it into the baseline export.
    const entries = entriesOf(env.last.project);
    expect(
      seatsOf(entries.get("2026|3") as Efa2Fields).map(([s]) => s)
    ).toEqual([1, 3, 4, 7]);
  });

  const scenarios: [string, [string, Edit][]][] = [
    ["rowers", rowerEdits],
    ["cox", coxEdits],
    ["captain", captainEdits],
  ];
  for (const [group, edits] of scenarios) {
    describe(group, () => {
      for (const [name, edit] of edits) {
        test(`${name}: order, seats, captain, no leftover names, rest untouched, re-import`, async () => {
          const env = await createEnvironment();
          const round = await applyRound(env, edit);
          expect(round.changes.length).toBeGreaterThan(0);
          expect(await verifyRound(env, round)).toEqual([]);
          expect(await reimportFailures(env)).toEqual([]);
        }, 60_000);
      }
    });
  }

  test("a correction that leaves the crew alone keeps efa's seats, gaps included", async () => {
    const env = await createEnvironment();
    const round = await applyRound(env, (draft) =>
      crewOf(draft).length ? { ...draft, comment: "Corrigée" } : null
    );
    expect(round.changes.length).toBeGreaterThan(10);
    expect(
      await verifyRound(env, round, { editedFields: ["Comments"] })
    ).toEqual([]);
    for (const { key } of round.changes) {
      const previous = entriesOf(round.before.project).get(key) as Efa2Fields;
      const entry = entriesOf(round.after.project).get(key) as Efa2Fields;
      expect([key, describeEntry(entry)]).toEqual([
        key,
        describeEntry(previous),
      ]);
    }
    expect(await reimportFailures(env)).toEqual([]);
  });

  test("a sequence of random corrections stays consistent, and re-imports", async () => {
    const env = await createEnvironment();
    for (let round = 1; round <= 6; round++) {
      const result = await applyRound(env, randomEdit, { seed: 100 + round });
      expect(result.changes.length).toBeGreaterThan(5);
      expect(await verifyRound(env, result)).toEqual([]);
      // Exporting again changes nothing.
      expect(JSON.stringify((await exportClub(env.db)).project)).toBe(
        JSON.stringify(result.after.project)
      );
    }
    expect(await reimportFailures(env)).toEqual([]);
  }, 120_000);

  test("typed names of efa are gone once the crew changes, whoever is removed", async () => {
    // 2025/23: cox and two rowers typed, 2025/31: "Krause, Zoe", 2026/21.
    for (const edit of [
      reorder("reverse", (rowers) => [...rowers].reverse())[1],
      removeAt("first")[1],
      replaceAt("last")[1],
      editNamed("removes the cox"),
    ]) {
      const env = await createEnvironment();
      const ids = new Map(
        env.outings.map((o) => [entryKey(o.logbook, o.entryId), o.id])
      );
      const round = await applyRound(env, (draft, context) =>
        ["2025|23", "2025|31", "2026|21"].some(
          (key) => ids.get(key) === draft.id
        )
          ? edit(draft, { ...context, index: 0 })
          : null
      );
      // Every other outing is a control: index parity must not skip these.
      expect(round.changes.length + round.untouched.length).toBeGreaterThan(0);
      expect(await verifyRound(env, round)).toEqual([]);
    }
  });

  test("rowers given to a crew with only a cox are exported on seats 1..n and re-import", async () => {
    const env = await createEnvironment();
    const round = await applyRound(
      env,
      editNamed("gives rowers to a crew that has only a cox")
    );
    expect(round.changes.map((c) => c.key)).toEqual(["2025|10"]);
    expect(await verifyRound(env, round)).toEqual([]);
    // Then the usual corrections of that crew.
    for (const edit of [
      editNamed("reverses the rowers"),
      editNamed("adds a rower at the end"),
      editNamed("removes the middle rower"),
    ]) {
      const next = await applyRound(env, edit);
      expect(await verifyRound(env, next)).toEqual([]);
    }
    expect(await reimportFailures(env)).toEqual([]);
  });

  test("a comment corrected after a crew correction keeps the seats the crew correction gave", async () => {
    const env = await createEnvironment();
    for (const edit of [
      editNamed("adds a rower at the middle"),
      editNamed("removes the first rower"),
    ]) {
      expect(await verifyRound(env, await applyRound(env, edit))).toEqual([]);
    }
    const round = await applyRound(env, (draft) => ({
      ...draft,
      comment: "Encore corrigée",
    }));
    expect(round.changes.length).toBeGreaterThan(10);
    expect(
      await verifyRound(env, round, { editedFields: ["Comments"] })
    ).toEqual([]);
    expect(await reimportFailures(env)).toEqual([]);
  });

  test("outings still on the water: reordering, replacing and removing rowers", async () => {
    // 2026/24 (cox, captain on seat 1) and 2026/25 (a typed name).
    for (const edit of [
      "reverses the rowers",
      "adds a rower at the end",
      "removes the first rower",
      "replaces the last rower",
      "keeps the captain when a rower is added in front",
    ].map(editNamed)) {
      const env = await createEnvironment();
      const round = await applyRound(env, edit, { ongoing: true });
      expect(round.changes.length + round.untouched.length).toBeGreaterThan(0);
      expect(await verifyRound(env, round)).toEqual([]);
    }
  });

  test("more than 24 rowers: the first 24 in the editor's order are exported, the cut is reported", async () => {
    const env = await createEnvironment();
    const ids = new Map(
      env.outings.map((o) => [entryKey(o.logbook, o.entryId), o.id])
    );
    // 2026/19: cox and 6+ rowers; 25 rowers once everyone is added.
    const round = await applyRound(env, (draft) =>
      draft.id === ids.get("2026|19")
        ? {
            ...draft,
            rowerIds: [
              ...draft.rowerIds,
              ...env.pool.filter((id) => !crewOf(draft).includes(id)),
            ].slice(0, 25),
          }
        : null
    );
    const [change] = round.changes;
    expect(change.intended.rowerIds).toHaveLength(25);
    const entry = entriesOf(round.after.project).get("2026|19") as Efa2Fields;
    expect(seatsOf(entry)).toEqual(
      change.intended.rowerIds.slice(0, 24).map((id, i) => [i + 1, id])
    );
    expect(entry.Crew25Id).toBeUndefined();
    expect(round.after.report.crewsCut).toBe(round.before.report.crewsCut + 1);
  });

  describe("several coxes", () => {
    /** Makes the first or last rower of each crew with a cox a second cox (position 0). */
    const withSecondCox =
      (which: "first" | "last") => async (db: SqlClient) => {
        const rows = await db.select<{ outing_id: string; rower_id: string }[]>(
          `SELECT outing_id, rower_id FROM outing_crew WHERE role = 'rower' AND outing_id IN
            (SELECT outing_id FROM outing_crew WHERE role = 'cox')
          ORDER BY outing_id, position ${which === "first" ? "ASC" : "DESC"}`
        );
        const done = new Set<string>();
        for (const row of rows) {
          if (done.has(row.outing_id)) continue;
          const rowers = rows.filter((r) => r.outing_id === row.outing_id);
          if (rowers.length < 2) continue;
          done.add(row.outing_id);
          await db.execute(
            "UPDATE outing_crew SET role = 'cox', position = 0 WHERE outing_id = $1 AND rower_id = $2",
            [row.outing_id, row.rower_id]
          );
        }
      };

    for (const which of ["first", "last"] as const) {
      test(`the cox shown by the editor is the cox exported (second cox was the ${which} rower)`, async () => {
        const env = await createEnvironment(withSecondCox(which));
        let multi = 0;
        const idOrders = new Set<string>();
        const failures: string[] = [];
        const entries = entriesOf(env.last.project);
        for (const outing of env.outings) {
          const draft = await readFinishedOutingDraft(env.db, outing.id);
          if (!draft?.coxId) continue;
          const [{ n }] = await env.db.select<{ n: number }[]>(
            "SELECT COUNT(*) AS n FROM outing_crew WHERE outing_id = $1 AND role = 'cox'",
            [outing.id]
          );
          if (Number(n) < 2) continue;
          multi++;
          // Both id orders must occur, whatever the tie-break by id.
          const original = findObjects(env.project, "efa2logbook")
            .find((l) => l.name === outing.logbook)
            ?.records.find((r) => r.EntryId === outing.entryId)?.CoxId;
          const [other] = await env.db.select<{ rower_id: string }[]>(
            "SELECT rower_id FROM outing_crew WHERE outing_id = $1 AND role = 'cox' AND rower_id <> $2",
            [outing.id, original ?? ""]
          );
          if (other && original) {
            idOrders.add(other.rower_id < original ? "before" : "after");
          }
          const key = entryKey(outing.logbook, outing.entryId);
          const exported = entries.get(key)?.CoxId;
          if (exported !== draft.coxId) {
            failures.push(
              `${key}: editor shows ${draft.coxId}, export has ${exported}`
            );
          }
        }
        expect(multi).toBeGreaterThan(3);
        expect([...idOrders].sort()).toEqual(["after", "before"]);
        expect(failures).toEqual([]);
      });
    }

    const keepsExtraCox: [string, Edit][] = [
      ["reverses the rowers", editNamed("reverses the rowers")],
      ["adds a rower in the middle", editNamed("adds a rower at the middle")],
      [
        "makes the first rower captain",
        editNamed("makes the first rower captain"),
      ],
      [
        "only changes the comment",
        (draft) => ({ ...draft, comment: "Corrigée" }),
      ],
    ];
    for (const [name, edit] of keepsExtraCox) {
      test(`${name}: the extra cox stays, the shown cox stays, the export keeps the shown cox`, async () => {
        const env = await createEnvironment(withSecondCox("last"));
        const coxesOf = async () => {
          const rows = await env.db.select<
            { outing_id: string; rower_id: string }[]
          >(
            "SELECT outing_id, rower_id FROM outing_crew WHERE role = 'cox' ORDER BY outing_id, rower_id"
          );
          return JSON.stringify(rows);
        };
        const coxesBefore = await coxesOf();
        const round = await applyRound(env, (draft, context) =>
          draft.coxId ? edit(draft, context) : null
        );
        expect(round.changes.length).toBeGreaterThan(0);
        // Same coxes in the database for everyone, edited or not.
        expect(await coxesOf()).toBe(coxesBefore);
        expect(
          await verifyRound(env, round, { editedFields: ["Comments"] })
        ).toEqual([]);
        expect(await reimportFailures(env)).toEqual([]);
      });
    }

    test("changing the shown cox drops the extra cox, removing the cox leaves none", async () => {
      for (const edit of ["changes the cox", "removes the cox"].map(
        editNamed
      )) {
        const env = await createEnvironment(withSecondCox("last"));
        const round = await applyRound(env, (draft, context) =>
          draft.coxId ? edit(draft, context) : null
        );
        expect(round.changes.length).toBeGreaterThan(0);
        expect(await verifyRound(env, round)).toEqual([]);
        for (const { id, intended } of round.changes) {
          const rows = await env.db.select<{ rower_id: string }[]>(
            "SELECT rower_id FROM outing_crew WHERE outing_id = $1 AND role = 'cox'",
            [id]
          );
          expect(rows.map((r) => r.rower_id)).toEqual(
            intended.coxId ? [intended.coxId] : []
          );
        }
      }
    });

    for (const [name, move] of [
      [
        "the other cox is brought in as a rower",
        (draft: OutingDraft, hidden: string) => ({
          ...draft,
          rowerIds: [hidden, ...draft.rowerIds],
        }),
      ],
      [
        "the other cox becomes the cox and the shown cox a rower",
        (draft: OutingDraft, hidden: string) => ({
          ...draft,
          coxId: hidden,
          rowerIds: [...draft.rowerIds, draft.coxId as string],
        }),
      ],
    ] as const) {
      test(`${name}`, async () => {
        const env = await createEnvironment(withSecondCox("last"));
        const hidden = new Map<string, string>();
        for (const outing of env.outings) {
          const draft = await readFinishedOutingDraft(env.db, outing.id);
          const rows = await env.db.select<{ rower_id: string }[]>(
            "SELECT rower_id FROM outing_crew WHERE outing_id = $1 AND role = 'cox'",
            [outing.id]
          );
          const other = rows.find((row) => row.rower_id !== draft?.coxId);
          if (other && draft?.coxId) hidden.set(outing.id, other.rower_id);
        }
        const round = await applyRound(env, (draft) =>
          hidden.has(draft.id as string)
            ? move(draft, hidden.get(draft.id as string) as string)
            : null
        );
        expect(round.changes.length).toBeGreaterThan(3);
        expect(await verifyRound(env, round)).toEqual([]);
        for (const { id, intended } of round.changes) {
          const rows = await env.db.select<{ rower_id: string }[]>(
            "SELECT rower_id FROM outing_crew WHERE outing_id = $1 AND role = 'cox'",
            [id]
          );
          expect(rows.map((r) => r.rower_id)).toEqual([intended.coxId]);
        }
        expect(await reimportFailures(env)).toEqual([]);
      });
    }

    test("a sequence of random corrections on crews with several coxes", async () => {
      const env = await createEnvironment(withSecondCox("last"));
      for (let round = 1; round <= 4; round++) {
        const result = await applyRound(env, randomEdit, { seed: 7 * round });
        expect(await verifyRound(env, result)).toEqual([]);
      }
      expect(await reimportFailures(env)).toEqual([]);
    }, 120_000);
  });
});
