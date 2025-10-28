import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { BoatTypeEnum, getTypeLabel } from "../../_common/business/boat.rules";
import { getBoatNumberOfRowers } from "../../_common/business/boat.rules";
import { useBoatLevelConfigStore } from "../../_common/store/boatLevelConfig.store";
import Button from "../../_common/components/Button";

interface BoatLevelConfigModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BoatLevelConfigModal({
  isOpen,
  onOpenChange,
}: BoatLevelConfigModalProps) {
  const { t } = useTranslation();
  const boatLevelConfigStore = useBoatLevelConfigStore();
  const boatLevelConfig = boatLevelConfigStore.getBoatTypeLevelConfigs();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("parameters.boatLevelConfiguration")}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <p>
            <span className="font-bold">{t("parameters.alertFrom")}</span> :{" "}
            {t("parameters.alertFromDescription")}
          </p>

          <p>
            <span className="font-bold">{t("parameters.blockFrom")}</span> :{" "}
            {t("parameters.blockFromDescription")}
          </p>

          <table className="mt-4 w-full">
            <thead>
              <tr>
                <th className="text-left pr-4">{t("parameters.boatType")}</th>
                <th className="text-left pr-4">{t("parameters.alert")}</th>
                <th className="text-left pr-4">{t("parameters.block")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(boatLevelConfig).map(([type, config]) => {
                const nbOfRowers = getBoatNumberOfRowers(type as BoatTypeEnum);

                if (!nbOfRowers) {
                  return null;
                }

                return (
                  <tr key={type}>
                    <td>{getTypeLabel(type as BoatTypeEnum)}</td>
                    <td>
                      <select
                        className="w-full input"
                        value={config.alertFrom || "null"}
                        onChange={(e) => {
                          const value = parseInt(e.target.value);

                          boatLevelConfigStore.updateBoatTypeLevelConfigs(
                            type as Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
                            {
                              ...config,
                              alertFrom: value === 0 ? null : value,
                            }
                          );
                        }}
                      >
                        <option value="null">
                          {t("parameters.doNotAlert")}
                        </option>
                        {Array.from({ length: nbOfRowers }, (_, i) => (
                          <option key={i} value={i + 1}>
                            {t("parameters.fromAtLeastRowers", {
                              count: i + 1,
                            })}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="w-full input"
                        value={config.blockFrom || "null"}
                        onChange={(e) => {
                          const value = parseInt(e.target.value);

                          boatLevelConfigStore.updateBoatTypeLevelConfigs(
                            type as Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
                            {
                              ...config,
                              blockFrom: value === 0 ? null : value,
                            }
                          );
                        }}
                      >
                        <option value="null">
                          {t("parameters.doNotBlock")}
                        </option>
                        {Array.from({ length: nbOfRowers }, (_, i) => (
                          <option key={i} value={i + 1}>
                            {t("parameters.fromAtLeastRowers", {
                              count: i + 1,
                            })}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-end mt-6">
            <Button
              type="button"
              variant="outlined"
              onClick={() => {
                boatLevelConfigStore.resetBoatTypeLevelConfigs();
              }}
            >
              {t("parameters.resetBoatTypeConfiguration")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
