// Gives the club's people, boats and routes their names from a content
// pack. Which name goes where is fixed by the structure, so every locale
// gets the same club with other words.
import { simplifyString } from "../../_common/utils/string.utils";
import { getRowerFullName } from "../../_common/business/rower.rules";
import { ClubStructure, SEED } from "./club";
import type { LocaleContent } from "./content/types";
import { createRng } from "./prng";
import { LIMITS } from "./validate";

export interface ClubNames {
  rowers: Map<
    string,
    { firstName: string; lastName: string; fullName: string }
  >;
  boats: Map<string, string>;
  routes: string[];
}

/**
 * Packs list first names from the most given lately to the oldest: members
 * get them by age, the youngest from the first band. Juniors' names come
 * from the first YOUNG_FIRST_NAMES.
 */
export const YOUNG_FIRST_NAMES = 20;
const NAME_BAND = 20;

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

export const composeNames = (
  club: ClubStructure,
  content: LocaleContent
): ClubNames => {
  const rng = createRng(`${SEED}:names`);
  // Fixed shuffles within bands of the first entries every pack must have.
  const banded = () =>
    range(LIMITS.firstNames / NAME_BAND).flatMap((band) =>
      rng.shuffle(range(NAME_BAND).map((i) => band * NAME_BAND + i))
    );
  const firstNameOrder = { female: banded(), male: banded() };
  const lastNameOrder = rng.shuffle(range(LIMITS.lastNames));

  const lastNameOf = (slot: number) => {
    if (slot >= LIMITS.lastNames) {
      throw new Error(
        `The club needs more than ${LIMITS.lastNames} family names`
      );
    }
    return content.lastNames[lastNameOrder[slot]];
  };

  // Youngest first; a name already given (a unisex name in both lists) or
  // equal to the family name is skipped.
  const queues = {
    female: [...firstNameOrder.female],
    male: [...firstNameOrder.male],
  };
  const usedFirstNames = new Set<string>();
  const rowers = new Map<
    string,
    { firstName: string; lastName: string; fullName: string }
  >();
  const ordered = [...club.rowers].sort((a, b) =>
    a.birthDate === b.birthDate
      ? a.key < b.key
        ? -1
        : 1
      : a.birthDate < b.birthDate
        ? 1
        : -1
  );
  for (const rower of ordered) {
    const lastName = lastNameOf(rower.lastNameSlot);
    const queue = queues[rower.gender];
    let firstName: string | undefined;
    while (firstName === undefined) {
      const index = queue.shift();
      if (index === undefined) {
        throw new Error(
          `${content.locale}: not enough distinct ${rower.gender} first names among the first ${LIMITS.firstNames} (some repeat the other list)`
        );
      }
      const candidate = content.firstNames[rower.gender][index];
      const key = simplifyString(candidate);
      if (usedFirstNames.has(key) || key === simplifyString(lastName)) continue;
      usedFirstNames.add(key);
      firstName = candidate;
    }
    rowers.set(rower.key, {
      firstName,
      lastName,
      fullName: getRowerFullName({ firstName, lastName }),
    });
  }

  // The crew picker filters by "contains" and puts names starting with the
  // typed text first: no full name may start another one.
  const fullNames = [...rowers.values()]
    .map((name) => simplifyString(name.fullName))
    .sort();
  for (let i = 1; i < fullNames.length; i++) {
    if (fullNames[i].startsWith(fullNames[i - 1])) {
      throw new Error(
        `${content.locale}: two members would be called "${fullNames[i - 1]}"`
      );
    }
  }

  const boats = new Map(
    club.boats.map((boat) => {
      if (boat.nameSlot >= content.boatNames.length)
        throw new Error(`Boat name slot ${boat.nameSlot} is out of range`);
      return [boat.key, content.boatNames[boat.nameSlot]];
    })
  );
  const routes = club.routes.map((route) => content.routes[route.slot]);

  return { rowers, boats, routes };
};
