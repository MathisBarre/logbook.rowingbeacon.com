import clsx from "clsx";
import { Label } from "../../_common/components/Label";
import {
  rowerCategories,
  RowerCategoryEnum,
  rowerType,
  RowerTypeEnum,
  useBoatLevelConfigStore,
} from "../../_common/store/boatLevelConfig.store";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const useBoatLevelSystemForm = ({
  defaultValues,
}: {
  defaultValues: {
    minimalRowerCategory: RowerCategoryEnum | null;
    minimalRowerType: RowerTypeEnum | null;
  };
}) => {
  const StartSessionFormSchema = z.object({
    isActivated: z.boolean(),
    minimalRowerCategory: z.enum([
      "null",
      RowerCategoryEnum.J10,
      RowerCategoryEnum.J12,
      RowerCategoryEnum.J14,
      RowerCategoryEnum.J16,
      RowerCategoryEnum.J18,
      RowerCategoryEnum.SENIOR,
    ]),
    minimalRowerType: z.enum([
      "null",
      RowerTypeEnum.RECREATIONAL,
      RowerTypeEnum.COMPETITOR,
    ]),
  });

  type StartSessionFormValues = z.infer<typeof StartSessionFormSchema>;

  const form = useForm<StartSessionFormValues>({
    resolver: zodResolver(StartSessionFormSchema),
    defaultValues: {
      minimalRowerCategory: defaultValues.minimalRowerCategory || "null",
      minimalRowerType: defaultValues.minimalRowerType || "null",
    },
  });

  return form;
};

export const BoatLevelSystem = ({
  boatId,
  close,
}: {
  boatId: string;
  close: () => void;
}) => {
  const { getBoatLevelConfig } = useBoatLevelConfigStore();
  const boatLevelConfig = getBoatLevelConfig(boatId);
  const form = useBoatLevelSystemForm({
    defaultValues: {
      minimalRowerCategory: boatLevelConfig?.minimalRowerCategory || null,
      minimalRowerType: boatLevelConfig?.minimalRowerType || null,
    },
  });

  return (
    <div>
      <label className="flex gap-2 items-center">
        <input
          type="checkbox"
          className="input"
          {...form.register("isActivated")}
        />
        restreindre l&apos;usage de ce bateau
      </label>

      <p className="text-sm mt-2 bg-yellow-50 border border-yellow-200 p-2 rounded">
        ⚠️ La restriction ne fonctionnera correctement que si la catégorie et le
        type des rameurs est correctement renseigné. S&apos;il n&apos;est pas
        renseigné pour un rameur, le système considera que le rameur est de la
        catégorie et le type la plus basse (niveau 0).
      </p>

      <div className={clsx(!form.watch("isActivated") && "hidden")}>
        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Catégorie de rameur minimale
          <select className="input" {...form.register("minimalRowerCategory")}>
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
          <select className="input" {...form.register("minimalRowerType")}>
            {rowerType.map((type) => (
              <option key={type.type} value={type.type || "null"}>
                {type.order} - {type.label || "Aucun type minimal"}
              </option>
            ))}
          </select>
        </Label>
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          onClick={close}
          className="flex-1"
          variant="outlined"
        >
          Annuler les changements
        </Button>
        <Button type="submit" className="flex-1">
          Mettre à jour la configuration
        </Button>
      </div>
    </div>
  );
};
