import { useTranslation } from "react-i18next";
import { Label } from "../../../_common/components/Label";
import {
  BoatConfiguration,
  getConfigurationCode,
} from "../../../_common/business/boatConfiguration.rules";

/** Rigging choice at departure, shown only for boats with several. */
export const ConfigurationSection = ({
  configurations,
  value,
  onChange,
}: {
  configurations: BoatConfiguration[];
  value: string | null;
  onChange: (configurationId: string) => void;
}) => {
  const { t } = useTranslation();

  if (configurations.length < 2) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <Label>{t("session.configuration")}</Label>
      <div className="flex gap-2">
        {[...configurations]
          .sort((a, b) => a.position - b.position)
          .map((configuration) => (
            <button
              key={configuration.id}
              type="button"
              onClick={() => onChange(configuration.id)}
              className={
                "px-4 py-2 rounded border text-sm font-medium" +
                (configuration.id === value
                  ? " bg-steel-blue-800 text-white border-steel-blue-800"
                  : " bg-white hover:bg-gray-50")
              }
            >
              {getConfigurationCode(configuration) ?? t("common.other")}
            </button>
          ))}
      </div>
    </div>
  );
};
