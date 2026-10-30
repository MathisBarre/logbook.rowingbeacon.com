import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ParamDef, ParamValue } from "../types";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { ParamInput } from "./ParamInput";
import { resolveParams } from "./resolveParams";
import { localNow } from "./season";

interface ParamsBarProps {
  defs: ParamDef[];
  values: Record<string, ParamValue>;
  onChange: (values: Record<string, ParamValue>) => void;
  /** Parameters set elsewhere, e.g. ["season"] when the hub selects it. */
  hidden?: string[];
  /** Label of the "current" option of a season control (Explorer). */
  currentLabel?: string;
  /**
   * The labels are drawn elsewhere (Explorer): each control is labelled
   * by `labelledBy(name)`, by default the element with id `param-<name>`.
   */
  hideLabels?: boolean;
  labelledBy?: (name: string) => string;
  /** Accessible name of the group; default "Paramètres du rapport". */
  ariaLabel?: string;
}

/**
 * One control per parameter (plan 1.3 and 2.7), in one row above the
 * chart that wraps on small screens. Invalid or missing required values
 * are flagged under their control (resolveParams); the values the user
 * did not touch keep their defaults.
 */
export const ParamsBar = ({
  defs,
  values,
  onChange,
  hidden = [],
  currentLabel,
  hideLabels = false,
  labelledBy = (name) => `param-${name}`,
  ariaLabel,
}: ParamsBarProps) => {
  const { t } = useTranslation();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const shown = defs.filter((def) => !hidden.includes(def.name));
  const errors = useMemo(
    () =>
      resolveParams(defs, values, { now: localNow(), seasonStartMonth }).errors,
    [defs, values, seasonStartMonth]
  );
  if (shown.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-start gap-x-6 gap-y-3"
      role="group"
      aria-label={ariaLabel ?? t("analytics.params.bar")}
    >
      {shown.map((def) => (
        <ParamInput
          key={def.name}
          def={def}
          value={values[def.name]}
          error={errors.find((e) => e.name === def.name) ?? null}
          onChange={(value) => onChange({ ...values, [def.name]: value })}
          currentLabel={currentLabel}
          labelledBy={hideLabels ? labelledBy(def.name) : undefined}
        />
      ))}
    </div>
  );
};
