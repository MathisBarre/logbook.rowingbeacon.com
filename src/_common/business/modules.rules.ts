/**
 * Optional modules (ADR 0002): the data model is always complete, a module
 * only shows the screens and fields that use it. Turning a module off never
 * deletes data.
 */
export const MODULE_IDS = [
  "distances",
  "outingTypes",
  "memberProfile",
  "guests",
  "captain",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export type OnboardingProfile = "simple" | "fullClub" | "efaImport";

export const getModulesForProfile = (
  profile: OnboardingProfile
): ModuleId[] => {
  switch (profile) {
    case "simple":
      return [];
    case "fullClub":
    case "efaImport":
      return [...MODULE_IDS];
  }
};

/** Keeps known ids only, in a stable order, without duplicates. */
export const normalizeModuleIds = (value: unknown): ModuleId[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return MODULE_IDS.filter((id) => value.includes(id));
};
