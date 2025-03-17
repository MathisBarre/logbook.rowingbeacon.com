import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { BoatTypeEnum, getTypeLabel } from "../../_common/business/boat.rules";
import { getBoatNumberOfRowers } from "../../_common/business/boat.rules";
import { useStore } from "zustand";
import { boatLevelConfigStoreCore as _boatLevelConfigStore } from "../../_common/store/boatLevelConfig.store";

interface BoatLevelConfigModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BoatLevelConfigModal({
  isOpen,
  onOpenChange,
}: BoatLevelConfigModalProps) {
  const boatLevelConfigStore = useStore(_boatLevelConfigStore);
  const boatLevelConfig = boatLevelConfigStore.getBoatTypeLevelConfigs();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        title="Configuration des niveaux des bateaux"
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <p>
            <span className="font-bold">Alerte à partir de</span> : afficher une
            alerte lorsque x rameurs ou plus n&apos;ont pas les critères requis
            pour le bateau selectionné
          </p>

          <p>
            <span className="font-bold">Bloquage à partir de</span> : bloquer
            l&apos;utilisation du bateau si x rameurs ou plus n&apos;ont pas les
            critères requis pour le bateau selectionné
          </p>

          <table className="table mt-4">
            <thead>
              <tr>
                <th className="text-left pr-4">Type de bateau</th>
                <th className="text-left pr-4">Alerte</th>
                <th className="text-left pr-4">Bloquage</th>
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
                        <option value="null">ne pas alerter</option>
                        {Array.from({ length: nbOfRowers }, (_, i) => (
                          <option key={i} value={i + 1}>
                            à partir d&apos;au moins {i + 1} rameur(s)
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
                        <option value="null">ne pas bloquer</option>
                        {Array.from({ length: nbOfRowers }, (_, i) => (
                          <option key={i} value={i + 1}>
                            à partir d&apos;au moins {i + 1} rameur(s)
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
