// About twenty incidents over two seasons: three on the featured boat (one
// last week), one on the last outing of each boat now in maintenance, and
// the others spread over time and boats. Which text goes with which boat is
// decided per pack, so that a seat number, a sweep oar or a scull is never
// reported on a boat that has none.
import { addDays, daysBetween, toLocalDateTime } from "./calendar";
import {
  BoatSpec,
  CLASS_SHAPES,
  ClubStructure,
  FEATURED,
  HISTORY_START,
  SEED,
  idFor,
} from "./club";
import { PlannedOuting } from "./history";
import { createRng } from "./prng";

export interface PlannedIncident {
  key: string;
  id: string;
  outingId: string;
  boatKey: string;
  /** Local wall-clock time: the end of the outing. */
  occurredAt: string;
}

const RANDOM_INCIDENTS = 15;

const lastOutingOn = (
  outings: PlannedOuting[],
  boatKey: string,
  onOrBefore: string
) => {
  let found: PlannedOuting | null = null;
  for (const outing of outings) {
    if (
      outing.boatKey === boatKey &&
      outing.day <= onOrBefore &&
      outing.endMinutes !== null
    ) {
      found = outing;
    }
  }
  if (!found)
    throw new Error(`No outing of ${boatKey} on or before ${onOrBefore}`);
  return found;
};

export const planIncidents = (
  club: ClubStructure,
  outings: PlannedOuting[],
  today: string,
  {
    historyStart = HISTORY_START,
    statsBoatDays,
  }: {
    historyStart?: string;
    /** Days (on or before) of the featured boat's two older incidents; fixed dates by default. */
    statsBoatDays?: [string, string];
  } = {}
): PlannedIncident[] => {
  const rng = createRng(`${SEED}:incidents`);
  const picked: PlannedOuting[] = [];

  // The featured boat: last week, last autumn, the season before.
  picked.push(lastOutingOn(outings, FEATURED.statsBoat, addDays(today, -7)));
  picked.push(
    lastOutingOn(
      outings,
      FEATURED.statsBoat,
      statsBoatDays?.[0] ?? "2025-10-18"
    )
  );
  picked.push(
    lastOutingOn(
      outings,
      FEATURED.statsBoat,
      statsBoatDays?.[1] ?? "2025-03-08"
    )
  );

  // What sent the boats in maintenance there.
  for (const boat of club.boats) {
    if (boat.maintenanceFrom) {
      picked.push(
        lastOutingOn(outings, boat.key, addDays(boat.maintenanceFrom, -1))
      );
    }
  }

  // The others: one per boat, spread from the first weeks to last month.
  const reserved = new Set<string>([
    FEATURED.statsBoat,
    ...club.boats
      .filter(
        (boat) =>
          boat.maintenanceFrom ||
          boat.configurations.some((c) => c.cls === "launch")
      )
      .map((boat) => boat.key),
  ]);
  const first = addDays(historyStart, 20);
  const span = daysBetween(first, addDays(today, -21));
  const used = new Set<string>();
  for (let k = 0; k < RANDOM_INCIDENTS; k++) {
    const target = addDays(
      first,
      Math.floor(((k + rng.next()) * span) / RANDOM_INCIDENTS)
    );
    const candidates = outings.filter(
      (outing) =>
        outing.day >= target &&
        outing.day <= addDays(target, 14) &&
        outing.endMinutes !== null &&
        !reserved.has(outing.boatKey) &&
        !used.has(outing.boatKey)
    );
    if (candidates.length === 0) continue;
    const outing = rng.pick(candidates);
    used.add(outing.boatKey);
    picked.push(outing);
  }

  return picked.map((outing) => ({
    key: outing.key,
    id: idFor("incident", outing.key),
    outingId: outing.id,
    boatKey: outing.boatKey,
    occurredAt: toLocalDateTime(outing.day, outing.endMinutes!),
  }));
};

// ----- Texts -----

/** What a report mentions, read from its words (every studio language). */
interface TextNeeds {
  /** Highest seat number named ("seat 3", "Platz 3", "del 3"…). */
  seat: number;
  /** A crew position (stroke, bow seat…): not a single. */
  position: boolean;
  sweep: boolean;
  scull: boolean;
  rudder: boolean;
  cox: boolean;
}

const POSITION =
  /\bstroke\b|\bbow seat\b|\bbow side\b|\bstroke side\b|\bschlag\b|\bauf bug\b|capovoga|prodiere|\bslag\b|\bboeg\b|chef de nage|\bn°\s?\d/i;
const SWEEP =
  /\bbow side\b|\bstroke side\b|\bsweep\b|riemen\b|\briem\b|boordriem|remo di punta|de pointe\b/i;
const SCULL = /scull|skull|di coppia|de couple\b/i;
const RUDDER =
  /rudder|\bsteuer\b|steuerseil|timone|\broer\b|stuurlijn|gouvernail|safran|\bbarre\b/i;
const COX = /\bcox\b|barreur|steuermann|timoniere|\bstuurman\b/i;
/** Damage that takes a boat out of service (preferred for boats in maintenance). */
const DAMAGE =
  /crack|split|bent|dent|fissur|fêl|fendu|tordu|enfonc|riss\b|haarriss|gerissen|verbogen|eingedellt|angebrochen|crepa|incrinat|piegat|ammaccat|rott[ao]\b|scheur|verbogen|deuk|water in|eau dans|wasser im|acqua nel/i;
/** The hull itself (preferred among damage). */
const HULL =
  /hull|coque|rumpf|bootshaut|scafo|\bromp\b|compartment|caisson|luftkast|gavone|skeg|\bfin\b|aileron|schwert|pinna|\bvin\b|bordwand|saxboard|gunwale|falchetta|plat-bord|\bboord\b/i;

export const readNeeds = (text: string): TextNeeds => {
  const seats = [...text.matchAll(/(?:^|[^\d])([2-8])(?![\d])/g)].map((match) =>
    Number(match[1])
  );
  return {
    seat: seats.length ? Math.max(...seats) : 0,
    position: POSITION.test(text),
    sweep: SWEEP.test(text),
    scull: SCULL.test(text),
    rudder: RUDDER.test(text),
    cox: COX.test(text),
  };
};

const boatOffers = (boat: BoatSpec) => {
  const shapes = boat.configurations.map(
    (configuration) => CLASS_SHAPES[configuration.cls]
  );
  return {
    seats: Math.max(...shapes.map((shape) => shape.seats ?? 0)),
    sweep: shapes.some((shape) => shape.rigging === "sweep"),
    scull: shapes.some((shape) => shape.rigging === "scull"),
    coxed: shapes.some((shape) => shape.coxed),
  };
};

export const fitsBoat = (needs: TextNeeds, boat: BoatSpec) => {
  const offers = boatOffers(boat);
  if (offers.seats === 0) return false;
  if (needs.seat > offers.seats) return false;
  if (needs.position && offers.seats < 2) return false;
  if (needs.sweep && !offers.sweep) return false;
  if (needs.scull && !offers.scull) return false;
  if (needs.rudder && offers.seats < 2 && !offers.coxed) return false;
  if (needs.cox && !offers.coxed) return false;
  return true;
};

/**
 * One distinct report per incident, fitting its boat. The choice depends on
 * the pack's texts; the incidents themselves do not.
 */
export const pickIncidentMessages = (
  club: ClubStructure,
  incidents: PlannedIncident[],
  texts: string[],
  locale: string
): string[] => {
  const needs = texts.map(readNeeds);
  const used = new Set<number>();
  return incidents.map((incident) => {
    const boat = club.boatByKey.get(incident.boatKey)!;
    const order = createRng(`${SEED}:incident-text:${incident.key}`).shuffle(
      texts.map((_, i) => i)
    );
    const fitting = order.filter(
      (index) => !used.has(index) && fitsBoat(needs[index], boat)
    );
    const specific = fitting.filter((index) => {
      const need = needs[index];
      return (
        need.seat > 0 ||
        need.position ||
        need.sweep ||
        need.scull ||
        need.rudder ||
        need.cox
      );
    });
    const damage = fitting
      .filter((index) => DAMAGE.test(texts[index]))
      .sort(
        (a, b) => Number(HULL.test(texts[b])) - Number(HULL.test(texts[a]))
      );
    const choice =
      // What sent a boat to maintenance is damage; reports that only fit
      // crew boats go to crew boats first, leaving the others to singles.
      (
        boat.maintenanceFrom && damage.length > 0
          ? damage
          : boatOffers(boat).seats >= 2 && specific.length > 0
            ? specific
            : fitting
      )[0];
    if (choice === undefined) {
      throw new Error(
        `${locale}: no incident text left that fits boat ${incident.boatKey}`
      );
    }
    used.add(choice);
    return texts[choice];
  });
};
