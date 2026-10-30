import { getNewGuestName } from "../../../_common/business/crew.rules";

export interface SeatFill {
  /** Rowing seats still to fill. */
  remaining: number;
  /** Rowers picked beyond the number of seats. */
  overflow: number;
  /** Every rowing seat is filled, and nobody too many. */
  complete: boolean;
  /** The configuration has a cox and none is picked yet. */
  coxMissing: boolean;
}

/**
 * What is left to fill in the boat, from the number of rowing seats and the
 * crew picked so far. The cox is apart: it is not one of the seats.
 */
export const getSeatFill = ({
  seats,
  rowersCount,
  coxed,
  hasCox,
}: {
  seats: number;
  rowersCount: number;
  coxed: boolean;
  hasCox: boolean;
}): SeatFill => ({
  remaining: Math.max(0, seats - rowersCount),
  overflow: Math.max(0, rowersCount - seats),
  complete: rowersCount === seats,
  coxMissing: coxed && !hasCox,
});

/** Missing from older system webviews (Safari before 14.1): fall back to code points. */
const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Whole characters: an accent, a flag or a composed emoji stays in one piece. */
const splitGraphemes = (word: string) =>
  graphemes
    ? Array.from(graphemes.segment(word), (part) => part.segment)
    : Array.from(word);

/** "ß" would become "SS": keep a character whose capital is longer. */
const toCapital = (character: string) => {
  const capital = character.toUpperCase();
  return capital.length === character.length ? capital : character;
};

/** "Jean-Pierre Martin Dupont" gives "JD": first and last words' initials. */
export const getInitials = (name: string) => {
  const words = name.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) {
    return "?";
  }
  const initials =
    words.length === 1
      ? splitGraphemes(first).slice(0, 2)
      : [splitGraphemes(first)[0] ?? "", splitGraphemes(last)[0] ?? ""];
  return initials.map(toCapital).join("");
};

export interface SeatMember {
  /** Plain name: the select label also carries category and level. */
  name: string;
  initials: string;
  isGuest: boolean;
}

/** Guests are typed names (new guest ids) or guest records of the club. */
export const toSeatMember = (
  option: { id: string; name: string },
  rowers: { id: string; name: string; status?: string }[],
): SeatMember => {
  const typedGuestName = getNewGuestName(option.id);
  const rower = rowers.find((candidate) => candidate.id === option.id);
  const name = typedGuestName ?? rower?.name ?? option.name;
  return {
    name,
    initials: getInitials(name),
    isGuest: typedGuestName !== null || rower?.status === "guest",
  };
};
