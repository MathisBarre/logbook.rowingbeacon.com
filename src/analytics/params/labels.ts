import type { TFunction } from "i18next";
import type { ParamDef } from "../chartSpec";

/**
 * Label of a parameter (plan 2.7), the same everywhere (review E 37):
 * its labelKey, else analytics.params.<name>, else its literal label,
 * else its name.
 */
export const paramLabel = (def: ParamDef, t: TFunction): string => {
  if (def.labelKey)
    return t(def.labelKey, { defaultValue: def.label ?? def.name });
  const known = t(`analytics.params.${def.name}`, { defaultValue: "" });
  if (known) return known;
  return def.label ?? def.name;
};
