import i18n from "../i18n/config";

/** Built-in outing types, seeded in the `outing_type` table. */
export const BUILTIN_OUTING_TYPE_CODES = [
  "normal",
  "training",
  "regatta",
  "training_camp",
  "instruction",
  "tour",
  "club_trip",
  "ergometer",
  "motorboat",
] as const;

export const DEFAULT_OUTING_TYPE_CODE = "normal";

export const getOutingTypeLabel = (code: string | null | undefined) => {
  if (!code) {
    return "";
  }

  return (BUILTIN_OUTING_TYPE_CODES as readonly string[]).includes(code)
    ? i18n.t(`outingTypes.${code}`)
    : code;
};
