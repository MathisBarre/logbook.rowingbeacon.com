import { Label } from "../../_common/components/Label";
import {
  boatLevelConfigStoreCore,
  rowerCategories,
  RowerCategoryEnum,
  rowerType,
  RowerTypeEnum,
} from "../../_common/store/boatLevelConfig.store";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useStore } from "zustand";

const useBoatLevelSystemForm = ({
  defaultValues,
}: {
  defaultValues: {
    minimalRowerCategory: RowerCategoryEnum | null;
    minimalRowerType: RowerTypeEnum | null;
  };
}) => {
  const StartSessionFormSchema = z.object({
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

export const BoatLevelSystem = ({ boatId }: { boatId: string }) => {
  const { getBoatLevelConfig, upsertBoatLevelConfig, deleteBoatLevelConfig } =
    useStore(boatLevelConfigStoreCore);

  const boatLevelConfig = getBoatLevelConfig(boatId);
  const form = useBoatLevelSystemForm({
    defaultValues: {
      minimalRowerCategory: boatLevelConfig?.minimalRowerCategory || null,
      minimalRowerType: boatLevelConfig?.minimalRowerType || null,
    },
  });

  const onSubmit = () => {
    /**
     * we should use form.handleSubmit bit it does not work, I don't know why
     */
    const formValues = form.getValues();

    const isActivated =
      formValues.minimalRowerCategory !== "null" ||
      formValues.minimalRowerType !== "null";

    if (isActivated) {
      upsertBoatLevelConfig(boatId, {
        minimalRowerCategory:
          formValues.minimalRowerCategory === "null"
            ? null
            : formValues.minimalRowerCategory,
        minimalRowerType:
          formValues.minimalRowerType === "null"
            ? null
            : formValues.minimalRowerType,
      });

      form.reset({
        minimalRowerCategory: formValues.minimalRowerCategory,
        minimalRowerType: formValues.minimalRowerType,
      });
    } else {
      removeRestrictions();
    }

    toast.success("Configuration mise à jour");
  };

  const removeRestrictions = () => {
    deleteBoatLevelConfig(boatId);

    form.reset({
      minimalRowerCategory: "null",
      minimalRowerType: "null",
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <p className="bg-blue-50 border border-blue-100 p-2 rounded text-sm mb-6">
        ℹ️ Ces paramètres vous permettent de restreindre l&apos;enregistrement
        des sorties du bateau à certains rameurs.
        <br />
        <br />
        Configurer une catégorie et/ou un type de rameur minimal alertera le
        preneur de note ou bloquera l&apos;enregistrement en fonction de la
        configuration globale du système de niveau (présent dans
        &quot;paramètres divers&quot;)
      </p>

      <div>
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
          type="submit"
          className="flex-1"
          disabled={!form.formState.isDirty}
        >
          Mettre à jour la configuration
        </Button>
      </div>
    </form>
  );
};
