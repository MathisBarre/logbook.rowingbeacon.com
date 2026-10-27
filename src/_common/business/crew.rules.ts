import { AgeCategoryEnum } from "./ageCategory.rules";
import { simplifyString } from "../utils/string.utils";

/**
 * A name typed at departure that matches no rower (Guests module). The form
 * carries it as an option id; the outing creates a hidden guest record.
 */
const NEW_GUEST_PREFIX = "new-guest:";

/** "  Jean   Dupont " gives "Jean Dupont". */
export const normalizePersonName = (name: string) =>
  name.trim().replace(/\s+/g, " ");

/** Accents, case and spaces ignored: "Léa  martin" matches "Lea Martin". */
export const isSamePersonName = (a: string, b: string) =>
  simplifyString(normalizePersonName(a)) ===
  simplifyString(normalizePersonName(b));

export const toNewGuestOptionId = (name: string) =>
  `${NEW_GUEST_PREFIX}${normalizePersonName(name)}`;

export const getNewGuestName = (optionId: string): string | null =>
  optionId.startsWith(NEW_GUEST_PREFIX)
    ? optionId.slice(NEW_GUEST_PREFIX.length)
    : null;

/** Identifies a crew member, typed guests compared by name. */
export const getCrewMemberKey = (optionId: string) => {
  const guestName = getNewGuestName(optionId);
  return guestName === null
    ? optionId
    : `${NEW_GUEST_PREFIX}${simplifyString(normalizePersonName(guestName))}`;
};

/** True when someone is picked twice, e.g. as a rower and as the cox. */
export const hasDuplicateCrewMember = (optionIds: string[]) => {
  const keys = optionIds.map(getCrewMemberKey);
  return new Set(keys).size !== keys.length;
};

export const ADULT_AGE = 18;

/**
 * Adult unless the birth date or the age category says otherwise: clubs
 * that fill neither still get a captain suggestion.
 */
export const isAdult = (
  rower: { category?: AgeCategoryEnum | undefined; birthDate?: string | null },
  today: Date
) => {
  if (rower.birthDate) {
    const birthDate = new Date(rower.birthDate);
    const adultFrom = new Date(birthDate);
    adultFrom.setFullYear(birthDate.getFullYear() + ADULT_AGE);
    return adultFrom <= today;
  }

  return !rower.category || rower.category === AgeCategoryEnum.SENIOR;
};

/**
 * Captain suggested at departure: the cox, otherwise the first adult rower;
 * guests are never suggested (their age is not known).
 */
export const getDefaultCaptainId = (
  crew: {
    id: string;
    role: "rower" | "cox";
    category?: AgeCategoryEnum | undefined;
    birthDate?: string | null;
    status?: string;
  }[],
  today: Date
): string | null => {
  const members = crew.filter(
    (member) => member.status !== "guest" && getNewGuestName(member.id) === null
  );
  const cox = members.find((member) => member.role === "cox");

  if (cox) {
    return cox.id;
  }

  return (
    members.find((member) => member.role === "rower" && isAdult(member, today))
      ?.id ?? null
  );
};
