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
  } = useBoatLevelConfigStore();

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

      <p className="text-sm mt-2 bg-yellow-50 border border-yellow-200 p-2 rounded">
        ⚠️ La restriction ne fonctionnera correctement que si la catégorie et le
        type des rameurs est correctement renseigné. S&apos;il n&apos;est pas
        renseigné pour un rameur, le système considera que le rameur est de la
        catégorie et le type la plus basse (niveau 0).
      </p>

      <div className={clsx(!activated && "hidden")}>
        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Catégorie de rameur minimale
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
            {rowerCategories.map((category) => (
              <option
                key={category.category}
                value={category.category || "null"}
              >
                {category.order} -{" "}
                {category.category || "Aucune catégorie minimale"}
              </option>
            ))}
          </select>
        </Label>

        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Type de rameur minimale
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
            {rowerType.map((type) => (
              <option key={type.type} value={type.type || "null"}>
                {type.order} - {type.type || "Aucun niveau minimal"}
              </option>
            ))}
          </select>
        </Label>
      </div>
    </div>
  );
};
