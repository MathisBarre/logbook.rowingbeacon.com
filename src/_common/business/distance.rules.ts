import i18n from "../i18n/config";

/** Distances are stored in metres, entered and shown in kilometres. */

/** Longest outing accepted, multi-day tours included. */
export const MAX_KILOMETRES = 10000;

const KILOMETRES_PATTERN = /^\d+(?:[.,]\d+)?$/;

/** Empty, or a plain number of km such as "12", "12.5" or "12,5". */
export const isValidKilometreInput = (input: string) => {
  const trimmed = input.trim();
  if (trimmed === "") return true;
  return (
    KILOMETRES_PATTERN.test(trimmed) &&
    Number(trimmed.replace(",", ".")) <= MAX_KILOMETRES
  );
};

/** Metres for a km input; null when empty or invalid. */
export const parseKilometres = (input: string): number | null => {
  const trimmed = input.trim();

  if (trimmed === "" || !isValidKilometreInput(trimmed)) {
    return null;
  }

  return Math.round(Number(trimmed.replace(",", ".")) * 1000);
};

export const metresToKilometres = (metres: number | null | undefined) =>
  metres === null || metres === undefined ? null : metres / 1000;

/** Value for a km text field, e.g. 12500 → "12.5". */
export const toKilometreInput = (metres: number | null | undefined) => {
  const kilometres = metresToKilometres(metres);
  return kilometres === null ? "" : String(kilometres);
};

export const formatKilometres = (
  metres: number | null | undefined,
  locale: string = i18n.language
) => {
  const kilometres = metresToKilometres(metres);

  if (kilometres === null) {
    return "";
  }

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    kilometres
  )} km`;
};
