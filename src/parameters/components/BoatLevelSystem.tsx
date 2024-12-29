import clsx from "clsx";
import { Label } from "../../_common/components/Label";
import {
  rowerCategories,
  RowerCategoryEnum,
  rowerType,
  RowerTypeEnum,
  useBoatLevelConfigStore,
} from "../../_common/store/boatLevelConfig.store";

export const BoatLevelSystem = ({ boatId }: { boatId: string }) => {
  const {
    getBoatLevelConfig,
    addBoatLevelConfig,
    deleteBoatLevelConfig,
    updateBoatLevelConfig,
    boatLevelConfigs,
  } = useBoatLevelConfigStore();

  console.log(boatLevelConfigs);

  const boatLevelConfig = getBoatLevelConfig(boatId);

  const activeBoatLevelConfig = () => {
    addBoatLevelConfig({
      boatId,
      minimalRowerCategory: null,
      minimalRowerType: null,
    });
  };

  const activated = boatLevelConfig !== undefined;

  return (
    <div>
      <label className="flex gap-2 items-center">
        <input
          type="checkbox"
          name=""
          id=""
          checked={activated}
          onChange={(e) => {
            const value = e.target.checked;

            if (value) {
              activeBoatLevelConfig();
            } else {
              deleteBoatLevelConfig(boatId);
            }
          }}
          className="input"
        />
        restreindre l&apos;usage de ce bateau
      </label>

      <p className="text-xs leading-5 mt-1">
        ⚠️ En restreignant l&apos;usage du bateau, les rameurs sans catégorie ou
        niveau ne pourront pas l&apos;utiliser
      </p>

      <div className={clsx(!activated && "hidden")}>
        <div className="h-4" />

        <hr />

        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Catégorie rameur minimale
          <select
            className="input"
            value={boatLevelConfig?.minimalRowerCategory || "null"}
            onChange={(e) => {
              const value = e.target.value as RowerCategoryEnum | "null";
              updateBoatLevelConfig(boatId, {
                minimalRowerCategory: value === "null" ? null : value,
              });
            }}
          >
            {rowerCategories.map((category, i) => (
              <option
                key={category.category}
                value={category.category || "null"}
              >
                {i} - {category.category || "Aucune catégorie minimale"}
              </option>
            ))}
          </select>
        </Label>

        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Niveau rameur minimale
          <select
            className="input"
            value={boatLevelConfig?.minimalRowerType || "null"}
            onChange={(e) => {
              const value = e.target.value as RowerTypeEnum | "null";
              updateBoatLevelConfig(boatId, {
                minimalRowerType: value === "null" ? null : value,
              });
            }}
          >
            {rowerType.map((type, i) => (
              <option key={type.type} value={type.type || "null"}>
                {i} - {type.type || "Aucun niveau minimal"}
              </option>
            ))}
          </select>
        </Label>
      </div>
    </div>
  );
};
