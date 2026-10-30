import { Efa2Fields } from "../efa2Xml";
import { Efa2Project, findObject } from "../efa2Project";
import { readFixtureProject } from "./readFixtureProject";

/** Ids in the efa-generated test project (TestClub). */
export const NECKAR = "c11721e8-b73e-4682-8b01-f3cec71fb7a5";
export const MOSEL = "dda63443-fdac-4576-bc12-fdb915536bfa";
export const MAIN = "2a494bc2-3ecd-4bdb-8445-fb05715042be";
export const NIKLAS = "2b845db5-ee3d-4f4c-b3c5-473382d5e6a4";
export const KATRIN = "b12a65f0-0548-4b96-82a4-e7373271e2d7";

/**
 * Reservation records that efa wrote (the three types, a holder by id and
 * by name), as in the sample project: reservations 1 to 3, counter at 3.
 */
export const sampleReservations = (): Efa2Fields[] => [
  {
    BoatId: NECKAR,
    Reservation: "3",
    Type: "WEEKLY_LIMITED",
    DateFrom: "01.04.2026",
    DateTo: "31.10.2026",
    DayOfWeek: "WEDNESDAY",
    TimeFrom: "17:30:00",
    TimeTo: "19:30:00",
    PersonName: "Trainingsgruppe Junioren",
    Reason: "Training",
    ChangeCount: "1",
    LastModified: "1792397149681",
  },
  {
    BoatId: MOSEL,
    Reservation: "1",
    Type: "ONETIME",
    DateFrom: "24.10.2026",
    DateTo: "25.10.2026",
    TimeFrom: "09:00:00",
    TimeTo: "16:30:00",
    PersonId: NIKLAS,
    Reason: "Herbstregatta Heilbronn",
    Contact: "0621 123456",
    ChangeCount: "1",
    LastModified: "1792397149668",
  },
  {
    BoatId: MAIN,
    Reservation: "2",
    Type: "WEEKLY",
    DayOfWeek: "MONDAY",
    TimeFrom: "18:00:00",
    TimeTo: "20:00:00",
    PersonId: KATRIN,
    Reason: "Montagsvierer",
    ChangeCount: "1",
    LastModified: "1792397149681",
  },
];

/** Records Rowing Beacon cannot read, or whose boat or holder it does not know. */
export const unreadableReservations = (): Efa2Fields[] => [
  // Boat efa no longer has (purged).
  {
    BoatId: "00000000-0000-4000-8000-0000000000aa",
    Reservation: "4",
    Type: "ONETIME",
    DateFrom: "01.11.2026",
    DateTo: "01.11.2026",
    TimeFrom: "10:00:00",
    TimeTo: "12:00:00",
    PersonName: "Gast",
    ChangeCount: "1",
    LastModified: "1792397149700",
  },
  // One-time reservation without dates.
  {
    BoatId: NECKAR,
    Reservation: "5",
    Type: "ONETIME",
    TimeFrom: "10:00:00",
    TimeTo: "12:00:00",
    PersonName: "Ohne Datum",
    ChangeCount: "1",
    LastModified: "1792397149701",
  },
  // Weekly reservation without a valid day of the week.
  {
    BoatId: MOSEL,
    Reservation: "6",
    Type: "WEEKLY",
    DayOfWeek: "FUNDAY",
    TimeFrom: "10:00:00",
    TimeTo: "12:00:00",
    PersonName: "Ohne Tag",
    ChangeCount: "2",
    LastModified: "1792397149702",
  },
];

/** The efa test project with exactly the given reservations (counter set to the highest). */
export const projectWithReservations = (
  reservations: Efa2Fields[] = sampleReservations(),
  counter?: string
): Efa2Project => {
  const project = readFixtureProject();
  findObject(project, "efa2boatreservations")!.records = reservations;
  const sequence = findObject(project, "efa2autoincrement")!.records.find(
    (record) => record.Sequence === "efa2boatreservations"
  )!;
  sequence.IntValue =
    counter ??
    String(Math.max(0, ...reservations.map((r) => Number(r.Reservation))));
  return project;
};
