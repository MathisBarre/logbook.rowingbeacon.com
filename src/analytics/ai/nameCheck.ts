/**
 * The local check that keeps rowers' names out of a question (review #35):
 * the AI must never receive a person's name, and the volunteer is told
 * before anything is sent or copied. Nothing here leaves the computer.
 *
 * Matching is accent- and case-insensitive, on whole words of at least 3
 * letters; a word that is also part of a boat or route name ("Mistral",
 * "Loire") is ignored, since the AI may know those (club assets).
 */

const MIN_WORD = 3;

/** "Élodie" → "elodie". */
export const foldText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

const wordsOf = (text: string) =>
  [...foldText(text).matchAll(WORD)]
    .map((m) => m[0])
    .filter((w) => w.length >= MIN_WORD);

export interface NamePerson {
  firstName: string;
  lastName: string;
}

export interface NameMatch {
  /** The words of the question that are a rower's name, as written. */
  words: string[];
}

export interface NameIndex {
  /** Folded first and last names (and their parts) of the rowers. */
  names: Set<string>;
}

/** The index of the rowers' names, minus words used by boats or routes. */
export const buildNameIndex = (
  people: NamePerson[],
  assetNames: string[] = []
): NameIndex => {
  const assets = new Set(assetNames.flatMap(wordsOf));
  const names = new Set<string>();
  for (const person of people) {
    for (const part of [person.firstName, person.lastName]) {
      const whole = foldText(part.trim());
      if (whole.length >= MIN_WORD && !assets.has(whole)) names.add(whole);
      // "Le Goff", "Marie-Anne": each part counts as a name too.
      for (const word of wordsOf(part)) {
        if (!assets.has(word)) names.add(word);
      }
    }
  }
  return { names };
};

/** The rowers' names a text contains, in order, each once (as written). */
export const findNames = (text: string, index: NameIndex): string[] => {
  if (index.names.size === 0) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WORD)) {
    const written = match[0];
    const folded = foldText(written);
    if (folded.length < MIN_WORD || seen.has(folded)) continue;
    const parts = folded.split(/['’-]/).filter((p) => p.length >= MIN_WORD);
    if (index.names.has(folded) || parts.some((p) => index.names.has(p))) {
      seen.add(folded);
      found.push(written);
    }
  }
  return found;
};

/**
 * The text with each matched name replaced by `replacement` ("un rameur");
 * a first name followed by a last name becomes one replacement.
 */
export const replaceNames = (
  text: string,
  names: string[],
  replacement: string
): string => {
  if (names.length === 0) return text;
  const folded = new Set(names.map(foldText));
  let out = "";
  let last = 0;
  let previousWasName = false;
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const between = text.slice(last, start);
    const isName = folded.has(foldText(match[0]));
    if (isName && previousWasName && /^\s+$/.test(between)) {
      // "Anouk Abgrall": the last name joins the first one's replacement.
    } else {
      // "d'Anouk" keeps its elision: "d'un rameur".
      const elision = /^(\p{L}{1,2}['’])/u.exec(match[0])?.[1] ?? "";
      out += between + (isName ? elision + replacement : match[0]);
    }
    last = start + match[0].length;
    previousWasName = isName;
  }
  return out + text.slice(last);
};
