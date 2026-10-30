import { AgeCategoryEnum } from "../_common/business/ageCategory.rules";
import { SeriousnessCategoryEnum } from "../_common/business/seriousness.rules";
import { MODULE_IDS } from "../_common/business/modules.rules";
import { applyMigrations } from "../_common/database/migrations";
import {
  validateReservation,
  type BoatReservation,
  type DayOfWeek,
} from "../_common/business/reservation.rules";
import { getRowerFullName } from "../_common/business/rower.rules";
import {
  saveBoatDamage,
  saveSetting,
} from "../_common/database/repositories/club.repository";
import type {
  BoatDamage,
  ClubRower,
  DamageSeverity,
} from "../_common/database/repositories/club.types";
import { saveReservation } from "../_common/database/repositories/reservation.repository";
import type { SqlClient } from "../_common/database/sqlClient";
import {
  SETTING_COACH_NOTE,
  SETTING_PASSWORD_HASH,
} from "../_common/store/clubOverview.store";
import { hashPassword } from "../_common/utils/password";
import { simplifyString } from "../_common/utils/string.utils";
import { createScriptRecorder } from "./scriptRecorder";
import {
  finishDemoPlan,
  GUEST_KEYS,
  isGuestKey,
  planDemoClub,
  REFERENCE_DAY,
} from "./demoPlan";
import { ANALYTICS_QUERIES, queryIdOf } from "./seed/analytics";
import {
  addDays,
  parseLocalDateTime,
  toLocalDateTime,
  weekdayOf,
} from "./seed/calendar";
import { FEATURED, idFor, SEED } from "./seed/club";
import { DAMAGED } from "./seed/damages";
import type { LocaleContent } from "./seed/content/types";
import { createRng } from "./seed/prng";
import {
  seedClubWith,
  type SeedContext,
  type SeedVariant,
} from "./seed/seedClub";

/** The admin password of the demo club (parameters screens). */
export const DEMO_ADMIN_PASSWORD = "admin";

export type DemoLocale =
  | "fr-FR"
  | "en-US"
  | "en-GB"
  | "de-DE"
  | "it-IT"
  | "nl-NL";

// ----- Member records (Member profile module) -----

/** Members whose record carries a note, in the order of `demo.memberNotes`. */
const NOTE_HOLDERS = [
  "rec.F5",
  "masters.F2",
  "rec.M7",
  "masters.F3",
  "rec.F20",
  "masters.M1",
];

const digits = (rng: ReturnType<typeof createRng>, count: number) =>
  Array.from({ length: count }, () => rng.int(0, 9)).join("");

/** Fictional numbers, in the shape each country writes them. */
const phoneNumber = (
  locale: DemoLocale,
  rng: ReturnType<typeof createRng>
): string => {
  switch (locale) {
    case "fr-FR":
      return `06 39 98 ${digits(rng, 2)} ${digits(rng, 2)}`;
    case "en-GB":
      return `07700 900${digits(rng, 3)}`;
    case "en-US":
      return `(212) 555-01${digits(rng, 2)}`;
    case "de-DE":
      return `030 23125 ${digits(rng, 3)}`;
    case "it-IT":
      return `320 555 ${digits(rng, 4)}`;
    case "nl-NL":
      return `06 5550 ${digits(rng, 4)}`;
  }
};

const address = (
  locale: DemoLocale,
  rng: ReturnType<typeof createRng>,
  contacts: LocaleContent["demo"]["contacts"]
) => {
  const number = rng.int(1, 89);
  const street = rng.pick(contacts.streets);
  const town = rng.pick(contacts.towns);
  return locale === "de-DE" || locale === "nl-NL"
    ? `${street} ${number}, ${town}`
    : `${number} ${street}, ${town}`;
};

const decorateRower = (
  rower: ClubRower,
  specKey: string,
  isJunior: boolean,
  isCompetitor: boolean,
  context: SeedContext
): ClubRower => {
  const { demo } = context.content;
  const locale = context.options.locale;
  const rng = createRng(`${SEED}:demo:profile:${specKey}`);
  // Every draw is made whatever the answer: a member's record does not
  // change with the others'.
  const hasEmail = rng.chance(isJunior ? 0.35 : 0.88);
  const hasPhone = rng.chance(isJunior ? 0.45 : 0.72);
  const hasLicense = rng.chance(isCompetitor || isJunior ? 0.9 : 0.35);
  const hasAddress = rng.chance(0.62);
  const licenseNumber = String(rng.int(100000, 999999));
  const phone = phoneNumber(locale, rng);
  const postal = address(locale, rng, demo.contacts);
  const note = NOTE_HOLDERS.indexOf(specKey);
  const emailName = (text: string) =>
    simplifyString(text).replace(/[^a-z0-9]+/g, "");
  return {
    ...rower,
    email: hasEmail
      ? `${emailName(rower.firstName)}.${emailName(rower.lastName)}@${demo.contacts.emailDomain}`
      : null,
    phone: hasPhone ? phone : null,
    licenseNumber: hasLicense ? licenseNumber : null,
    address: hasAddress ? postal : null,
    note: note >= 0 ? demo.memberNotes[note] : null,
  };
};

// ----- Damages (Damages module) -----

const COSTS = [0, 25, 40, 85, 140, 320, 560];
/** Who repairs in the club workshop. */
const REPAIRERS = ["staff.coachM", "masters.M1", "masters.M2"];

const saveDamages = async (db: SqlClient, context: SeedContext) => {
  const { plan, content, messages, rowerId } = context;
  const { club } = plan;
  const { day } = parseLocalDateTime(context.options.now);
  const rng = createRng(`${SEED}:demo:damages`);
  const damageId = (key: string) => idFor("damage", `demo:${key}`);

  const incidents = plan.incidents.map((incident, index) => ({
    ...incident,
    index,
    message: messages[index],
    outing: plan.outings.find((outing) => outing.id === incident.outingId)!,
  }));
  const isLaunch = (boatKey: string) =>
    club.boatByKey.get(boatKey)!.configurations.some((c) => c.cls === "launch");
  const inMaintenance = (boatKey: string) =>
    club.boatByKey.get(boatKey)!.maintenanceFrom !== null;
  const reporter = (outing: { crew: { rowerKey: string }[] }) => {
    const member = outing.crew.find((m) => !isGuestKey(m.rowerKey));
    return member ? rowerId(member.rowerKey) : null;
  };

  const written: BoatDamage[] = [];
  const openBoats = new Set<string>(
    club.boats.filter((b) => b.maintenanceFrom !== null).map((b) => b.key)
  );
  // The studio's damages (written with the Damages module) already hold
  // these boats open: the history adds no second open damage to them.
  for (const key of [
    DAMAGED.warningBoat,
    DAMAGED.precautionBoat,
    DAMAGED.minorBoat,
  ]) {
    openBoats.add(key);
  }
  const write = async (damage: BoatDamage) => {
    await saveBoatDamage(db, damage);
    written.push(damage);
  };
  const fromIncident = (
    incident: (typeof incidents)[number],
    key: string,
    severity: DamageSeverity
  ): BoatDamage => ({
    id: damageId(key),
    boatId: club.boatByKey.get(incident.boatKey)!.id,
    kind: "damage",
    severity,
    description: incident.message,
    reportedAt: incident.occurredAt,
    reportedByRowerId: reporter(incident.outing),
    outingId: incident.outingId,
    incidentId: incident.id,
    fixedAt: null,
    fixedByRowerId: null,
    repairNote: null,
    repairCost: null,
  });

  const eligible = incidents
    .filter(
      (i) =>
        !inMaintenance(i.boatKey) &&
        !isLaunch(i.boatKey) &&
        i.occurredAt.slice(0, 10) < day
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  // Open: the featured boat's report of last week, limited…
  const statsIncident = eligible.find((i) => i.boatKey === FEATURED.statsBoat);
  if (statsIncident) {
    await write(fromIncident(statsIncident, "open-stats", "limited"));
    openBoats.add(statsIncident.boatKey);
  }
  // … and the latest other report, only a nuisance.
  const nuisance = eligible.find((i) => !openBoats.has(i.boatKey));
  if (nuisance) {
    await write(fromIncident(nuisance, "open-latest", "usable"));
    openBoats.add(nuisance.boatKey);
  }

  // Open, declared from the damages screen after a recent outing.
  const lastOutings = new Map<string, (typeof plan.outings)[number]>();
  for (const outing of plan.outings) {
    if (
      outing.endMinutes !== null &&
      outing.day >= addDays(day, -12) &&
      outing.day <= day
    ) {
      lastOutings.set(outing.boatKey, outing);
    }
  }
  const recentBoats = [...lastOutings.keys()].filter(
    (key) =>
      !openBoats.has(key) &&
      !isLaunch(key) &&
      !inMaintenance(key) &&
      club.boatByKey.get(key)!.level === null
  );
  const declared = rng.shuffle(recentBoats).slice(0, 2);
  const severities: DamageSeverity[] = ["usable", "limited"];
  for (const [n, boatKey] of declared.entries()) {
    const outing = lastOutings.get(boatKey)!;
    const texts = content.demo.damages[severities[n] as "usable" | "limited"];
    await write({
      id: damageId(`open-declared-${n}`),
      boatId: club.boatByKey.get(boatKey)!.id,
      kind: "damage",
      severity: severities[n],
      description: rng.pick(texts),
      reportedAt: toLocalDateTime(outing.day, outing.endMinutes! + 5),
      reportedByRowerId: reporter(outing),
      outingId: outing.id,
      incidentId: null,
      fixedAt: null,
      fixedByRowerId: null,
      repairNote: null,
      repairCost: null,
    });
    openBoats.add(boatKey);
  }

  // Repaired: older reports of the history, a few days to a week later.
  const older = eligible
    .filter(
      (i) =>
        !openBoats.has(i.boatKey) &&
        i.occurredAt.slice(0, 10) <= addDays(day, -14)
    )
    .reverse();
  const step = Math.max(1, Math.floor(older.length / 6));
  const repaired = older.filter((_, index) => index % step === 0).slice(0, 6);
  const notes = rng.shuffle(content.demo.repairNotes);
  const kinds: DamageSeverity[] = [
    "limited",
    "unusable",
    "usable",
    "limited",
    "unusable",
    "usable",
  ];
  for (const [n, incident] of repaired.entries()) {
    const reportedDay = incident.occurredAt.slice(0, 10);
    const fixedDay = addDays(reportedDay, Math.min(rng.int(1, 9), 13));
    let severity = kinds[n];
    // A boat out of service rowed nowhere meanwhile.
    if (
      severity === "unusable" &&
      plan.outings.some(
        (outing) =>
          outing.boatKey === incident.boatKey &&
          outing.day > reportedDay &&
          outing.day <= fixedDay
      )
    ) {
      severity = "limited";
    }
    await write({
      ...fromIncident(incident, `repaired-${n}`, severity),
      fixedAt: `${fixedDay}T${n % 2 === 0 ? "17:30" : "11:15"}`,
      fixedByRowerId: rowerId(REPAIRERS[n % REPAIRERS.length]),
      repairNote: notes[n],
      repairCost: COSTS[(n * 3 + 1) % COSTS.length],
    });
  }

  // Also repaired, never tied to an incident.
  const quiet = club.boats
    .filter(
      (b) =>
        !isLaunch(b.key) &&
        b.maintenanceFrom === null &&
        !repaired.some((i) => i.boatKey === b.key)
    )
    .map((b) => b.key);
  for (const [n, boatKey] of rng.shuffle(quiet).slice(0, 2).entries()) {
    const outings = plan.outings.filter(
      (o) =>
        o.boatKey === boatKey &&
        o.endMinutes !== null &&
        o.day <= addDays(day, -30) &&
        o.day >= addDays(day, -150)
    );
    if (outings.length === 0) continue;
    const outing = rng.pick(outings);
    const reportedDay = outing.day;
    await write({
      id: damageId(`repaired-declared-${n}`),
      boatId: club.boatByKey.get(boatKey)!.id,
      kind: "damage",
      severity: "limited",
      description: rng.pick(content.demo.damages.limited),
      reportedAt: toLocalDateTime(outing.day, outing.endMinutes! + 5),
      reportedByRowerId: reporter(outing),
      outingId: outing.id,
      incidentId: null,
      fixedAt: `${addDays(reportedDay, rng.int(2, 8))}T16:45`,
      fixedByRowerId: rowerId(REPAIRERS[(n + 1) % REPAIRERS.length]),
      repairNote: notes[(6 + n) % notes.length],
      repairCost: COSTS[(n * 2 + 2) % COSTS.length],
    });
  }

  return written;
};

// ----- Reservations (Reservations module) -----

const isoDayOf = (day: string) =>
  (weekdayOf(day) === 0 ? 7 : weekdayOf(day)) as DayOfWeek;

const hhmm = (minutes: number) =>
  toLocalDateTime("2000-01-01", minutes).slice(11);

const nextWeekday = (from: string, isoDay: number) => {
  let day = from;
  while (isoDayOf(day) !== isoDay) day = addDays(day, 1);
  return day;
};

const saveReservations = async (db: SqlClient, context: SeedContext) => {
  const { plan, content, rowerId } = context;
  const { club } = plan;
  const { day, minutes } = parseLocalDateTime(context.options.now);
  const texts = content.reservations;
  const written: BoatReservation[] = [];

  const add = async (
    key: string,
    boatKey: string,
    holder: { rowerKey: string } | { name: keyof typeof texts.holders },
    reason: keyof typeof texts.reasons,
    when:
      | { once: [string, string, string, string] }
      | {
          weekly: {
            isoDay: DayOfWeek;
            start: string;
            end: string;
            period?: [string, string];
          };
        },
    contact = false
  ) => {
    const base = {
      id: idFor("reservation", `demo:${key}`),
      boatId: club.boatByKey.get(boatKey)!.id,
      rowerId: "rowerKey" in holder ? rowerId(holder.rowerKey) : null,
      personName: "name" in holder ? texts.holders[holder.name] : null,
      reason: texts.reasons[reason],
      contact: contact ? texts.regattaContact : null,
    };
    const reservation: BoatReservation =
      "once" in when
        ? {
            ...base,
            recurrence: "once",
            startDate: when.once[0],
            endDate: when.once[1],
            dayOfWeek: null,
            startTime: when.once[2],
            endTime: when.once[3],
          }
        : {
            ...base,
            recurrence: "weekly",
            startDate: when.weekly.period?.[0] ?? null,
            endDate: when.weekly.period?.[1] ?? null,
            dayOfWeek: when.weekly.isoDay,
            startTime: when.weekly.start,
            endTime: when.weekly.end,
          };
    // Overlaps and invalid slots are skipped: the calendar is the real one.
    if (validateReservation(reservation, written)) return;
    await saveReservation(db, reservation);
    written.push(reservation);
  };

  const saturday = nextWeekday(addDays(day, 5), 6);
  // Weekly slots.
  await add("initiation", "2x.C4", { name: "initiation" }, "initiation", {
    weekly: { isoDay: 6, start: "09:00", end: "12:00" },
  });
  await add("masters", "2x.C1", { rowerKey: "masters.M0" }, "masters", {
    weekly: { isoDay: 2, start: "07:00", end: "08:30" },
  });
  await add("competition", "2-.S1", { rowerKey: "comp.M4" }, "competition", {
    weekly: { isoDay: 5, start: "07:00", end: "08:30" },
  });
  await add("juniors", "4+.F2", { name: "juniors" }, "juniors", {
    weekly: {
      isoDay: 3,
      start: "17:30",
      end: "19:00",
      period: [addDays(day, -60), addDays(day, 70)],
    },
  });
  // The next regatta weekend, and the last one.
  await add(
    "regatta",
    "8+.E1",
    { name: "regatta" },
    "regatta",
    { once: [saturday, addDays(saturday, 1), "06:30", "19:00"] },
    true
  );
  await add(
    "past-regatta",
    "8+.E1",
    { name: "regatta" },
    "regatta",
    {
      once: [addDays(saturday, -21), addDays(saturday, -20), "06:30", "19:00"],
    },
    true
  );
  // The winter term, over, and a one-off class.
  await add("past-juniors", "4+.F3", { name: "juniors" }, "juniors", {
    weekly: {
      isoDay: 3,
      start: "17:30",
      end: "19:00",
      period: [addDays(day, -250), addDays(day, -90)],
    },
  });
  await add("past-initiation", "2x.C5", { name: "initiation" }, "initiation", {
    once: [addDays(day, -35), addDays(day, -35), "09:00", "12:00"],
  });
  // Today: one reservation running and one about to start, when the
  // boathouse is open.
  if (minutes >= 7 * 60 + 30 && minutes <= 20 * 60) {
    const running = Math.floor((minutes - 40) / 30) * 30;
    const soon = Math.ceil((minutes + 25) / 30) * 30;
    if (running >= 7 * 60) {
      await add("running", "2x.C3", { name: "initiation" }, "initiation", {
        once: [day, day, hhmm(running), hhmm(running + 120)],
      });
    }
    if (soon + 90 <= 22 * 60) {
      await add("soon", "2x.C2", { rowerKey: "masters.F1" }, "masters", {
        once: [day, day, hhmm(soon), hhmm(soon + 90)],
      });
    }
  }
  return written;
};

// ----- The demo club -----

/**
 * The saved queries of the statistics profile carry dates written for the
 * studio's day (seed/analytics.ts): moved by whole days so that they keep
 * their distance to `now`, never in the future nor years old.
 */
const redateSavedQueries = async (db: SqlClient, now: string) => {
  const shiftMs =
    Date.parse(`${now.slice(0, 10)}T00:00:00Z`) -
    Date.parse(`${REFERENCE_DAY}T00:00:00Z`);
  for (const plan of ANALYTICS_QUERIES) {
    const date = new Date(Date.parse(plan.updatedAt) + shiftMs).toISOString();
    await db.execute(
      "UPDATE analytics_query SET created_at = $1, updated_at = $1 WHERE id = $2",
      [date, queryIdOf(plan.key)]
    );
  }
};

/**
 * Fills an empty or existing database with the demo club, replacing all
 * club data. `now` is the local date-time "YYYY-MM-DDTHH:mm".
 *
 * The club is the studio's fictional one, laid out around `now`, with every
 * optional module on and something to see in each: outing types, distances,
 * member records, guests, captains, damages (open and repaired) and boat
 * reservations. Everything is deterministic for a given locale and `now`.
 */
export async function seedDemoClub(
  db: SqlClient,
  options: { locale: DemoLocale; now: string }
): Promise<{ clubName: string }> {
  parseLocalDateTime(options.now);

  const variant: SeedVariant = {
    plan: planDemoClub,
    afterPlan: (plan) => finishDemoPlan(plan, options.now),
    bulk: true,
    skipStudioReservations: true,
    extraRowers: ({ content }) =>
      content.demo.guests.map((guest, index) => ({
        key: GUEST_KEYS[index],
        rower: {
          id: idFor("rower", GUEST_KEYS[index]),
          name: getRowerFullName(guest),
          firstName: guest.firstName,
          lastName: guest.lastName,
          status: "guest",
          note: guest.note,
        },
      })),
    decorateRower: (rower, spec, context) =>
      decorateRower(
        rower,
        spec.key,
        spec.category !== AgeCategoryEnum.SENIOR,
        spec.type === SeriousnessCategoryEnum.COMPETITOR,
        context
      ),
    finish: async (db, context) => {
      await saveDamages(db, context);
      await saveReservations(db, context);
      await redateSavedQueries(db, options.now);
      await saveSetting(db, SETTING_COACH_NOTE, context.content.coachNote);
      await saveSetting(
        db,
        SETTING_PASSWORD_HASH,
        hashPassword(DEMO_ADMIN_PASSWORD)
      );
    },
  };

  // The whole club is one script: one call, one connection, one transaction
  // (the seed brings its own BEGIN and COMMIT). Nothing is written if the
  // seed itself fails.
  await applyMigrations(db);
  const recorder = createScriptRecorder();
  const scenario = await seedClubWith(
    recorder.client,
    {
      locale: options.locale,
      now: options.now,
      modules: MODULE_IDS,
      // Statistiques has something to show: a third season, former members,
      // saved queries, the dashboard (every module is on).
      analytics: { modules: [...MODULE_IDS] },
    },
    { ...variant, migrated: true }
  );
  try {
    await db.execute(recorder.statements.join("\n"));
  } catch (error) {
    // The connection that ran the script may still hold its transaction.
    // The plugin may pick another one for this call: the caller closes the
    // pool too (demoSession).
    await db.execute("ROLLBACK;").catch(() => undefined);
    throw error;
  }
  return { clubName: scenario.clubName };
}
