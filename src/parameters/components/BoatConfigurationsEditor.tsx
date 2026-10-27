import { v4 } from "uuid";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BoatConfiguration,
  getConfigurationCode,
  getConfigurationError,
  MAX_SEATS,
  Rigging,
} from "../../_common/business/boatConfiguration.rules";

/**
 * Edits the ways a boat can be rigged (4x, 4-…). One of them is the
 * default; the others are offered at departure.
 */
export const BoatConfigurationsEditor = ({
  configurations,
  saved,
  onChange,
}: {
  configurations: BoatConfiguration[];
  /** The configurations as saved, to tell a cleared seat count apart. */
  saved: BoatConfiguration[];
  onChange: (configurations: BoatConfiguration[]) => void;
}) => {
  const { t } = useTranslation();

  const update = (id: string, patch: Partial<BoatConfiguration>) => {
    onChange(
      configurations.map((configuration) =>
        configuration.id === id ? { ...configuration, ...patch } : configuration
      )
    );
  };

  const setDefault = (id: string) => {
    onChange(
      configurations.map((configuration) => ({
        ...configuration,
        isDefault: configuration.id === id,
      }))
    );
  };

  const remove = (id: string) => {
    const remaining = configurations.filter(
      (configuration) => configuration.id !== id
    );
    if (remaining.length > 0 && !remaining.some((c) => c.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    onChange(remaining);
  };

  const add = () => {
    const base = configurations.find((c) => c.isDefault) ?? configurations[0];
    onChange([
      ...configurations,
      {
        id: v4(),
        seats: base?.seats ?? null,
        rigging: null,
        coxed: false,
        isDefault: configurations.length === 0,
        position: Math.max(-1, ...configurations.map((c) => c.position)) + 1,
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">
        {t("boat.configurations")}
        <span className="block text-xs text-gray-500 font-normal">
          {t("boat.configurationsHelp")}
        </span>
      </span>
      {configurations.map((configuration) => {
        const error = getConfigurationError(
          configuration,
          configurations,
          saved
        );
        return (
          <div key={configuration.id} className="flex flex-col gap-1">
            <div
              className={`flex items-center gap-2 border rounded p-2 text-sm ${
                error ? "border-error-500" : ""
              }`}
            >
              <span className="w-12 font-mono font-semibold">
                {getConfigurationCode(configuration) ?? "?"}
              </span>
              <label className="flex items-center gap-1">
                {t("boat.seats")}
                <input
                  type="number"
                  min={1}
                  max={MAX_SEATS}
                  step={1}
                  className="input w-16 py-1"
                  value={configuration.seats ?? ""}
                  onChange={(e) =>
                    update(configuration.id, {
                      seats:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <select
                className="input py-1"
                value={configuration.rigging ?? ""}
                onChange={(e) =>
                  update(configuration.id, {
                    rigging: (e.target.value || null) as Rigging | null,
                  })
                }
              >
                <option value="">{t("boat.riggingUnknown")}</option>
                <option value="scull">{t("boat.riggingScull")}</option>
                <option value="sweep">{t("boat.riggingSweep")}</option>
              </select>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={configuration.coxed}
                  onChange={(e) =>
                    update(configuration.id, { coxed: e.target.checked })
                  }
                />
                {t("boat.coxed")}
              </label>
              <label className="flex items-center gap-1 ml-auto">
                <input
                  type="radio"
                  name="default-configuration"
                  checked={configuration.isDefault}
                  onChange={() => setDefault(configuration.id)}
                />
                {t("boat.defaultConfiguration")}
              </label>
              {configurations.length > 1 && (
                <button
                  type="button"
                  className="p-1 text-gray-500 hover:text-red-600"
                  title={t("boat.removeConfiguration")}
                  onClick={() => remove(configuration.id)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            {error && (
              <p className="form-error">
                {t(`boat.configurationError.${error}`, { max: MAX_SEATS })}
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="self-start flex items-center gap-1 text-sm text-steel-blue-800 hover:underline"
      >
        <PlusIcon className="h-4 w-4" />
        {t("boat.addConfiguration")}
      </button>
    </div>
  );
};
