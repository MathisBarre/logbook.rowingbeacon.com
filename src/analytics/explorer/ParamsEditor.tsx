import { useTranslation } from "react-i18next";
import { ParamType } from "../chartSpec";
import type { ParamDef, ParamValue } from "../types";
import { ParamsBar } from "../params/ParamsBar";

/**
 * The parameters of the query (plan 1.3): one row per `:name` found in the
 * SQL, as a grid (review 23): the name, its value (WP4's control for that
 * type, which also flags a missing or invalid value), then the type,
 * guessed from the name and changeable, smaller because it is rarely
 * touched. Values are kept while the SQL is edited. The page renders it
 * only when the query has parameters (review 2).
 *
 * The name is the control's label (no second "Saison" label above it,
 * review 23) and a "current" season reads "Saison choisie en haut
 * (2025-2026)" (review 19).
 *
 * Each value cell carries `data-param` so the AI panel can bring the user
 * to a parameter ("Choisir la valeur de :boat").
 */

interface ParamsEditorProps {
  params: ParamDef[];
  values: Record<string, ParamValue>;
  onTypeChange: (name: string, type: ParamType) => void;
  onValuesChange: (values: Record<string, ParamValue>) => void;
  /**
   * Label of the "current" season option: the season chosen at the top of
   * the hub, which the query follows (review 19).
   */
  currentSeasonLabel?: string;
}

/** "choice" needs options, which only prebuilt reports define. */
const EDITABLE_TYPES: ParamType[] = ParamType.options.filter(
  (type) => type !== "choice"
);

export const paramLabelId = (name: string) => `param-${name}`;

export const ParamsEditor = ({
  params,
  values,
  onTypeChange,
  onValuesChange,
  currentSeasonLabel,
}: ParamsEditorProps) => {
  const { t } = useTranslation();
  if (params.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="explorer-params-title"
    >
      <h3
        id="explorer-params-title"
        className="text-sm font-semibold text-gray-800"
      >
        {t("analytics.explorer.params.title")}
      </h3>
      <ul className="flex flex-col gap-2">
        {params.map((def) => {
          const types = EDITABLE_TYPES.includes(def.type)
            ? EDITABLE_TYPES
            : [...EDITABLE_TYPES, def.type];
          const typeId = `param-type-${def.name}`;
          return (
            <li
              key={def.name}
              className="grid grid-cols-1 items-center gap-x-3 gap-y-2 rounded border border-gray-200 bg-white px-3 py-2 sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_auto]"
            >
              <code
                id={paramLabelId(def.name)}
                className="font-mono text-sm text-steel-blue-800 break-all"
              >
                :{def.name}
              </code>
              <div className="min-w-0" data-param={def.name}>
                <ParamsBar
                  defs={[def]}
                  values={values}
                  currentLabel={currentSeasonLabel}
                  hideLabels
                  labelledBy={paramLabelId}
                  ariaLabel={`:${def.name}`}
                  onChange={(next) =>
                    onValuesChange({ [def.name]: next[def.name] ?? null })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={typeId} className="text-xs text-gray-500">
                  {t("analytics.explorer.params.type")}
                </label>
                <select
                  id={typeId}
                  className="min-h-11 rounded border border-gray-300 bg-white pl-2 pr-8 text-xs text-gray-900"
                  value={def.type}
                  onChange={(event) =>
                    onTypeChange(def.name, event.target.value as ParamType)
                  }
                >
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {t(`analytics.params.types.${type}`)}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
