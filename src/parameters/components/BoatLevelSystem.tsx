import { useTranslation } from "react-i18next";
import { Label } from "../../_common/components/Label";
import { boatLevelConfigStoreCore } from "../../_common/store/boatLevelConfig.store";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useStore } from "zustand";
import {
  SERIOUSNESS_CATEGORIES,
  SeriousnessCategoryEnum,
} from "../../_common/business/seriousness.rules";
import { AGE_CATEGORIES } from "../../_common/business/ageCategory.rules";
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";

const useBoatLevelSystemForm = ({
  defaultValues,
}: {
  defaultValues: {
    minimalRowerCategory: AgeCategoryEnum | null;
    minimalRowerType: SeriousnessCategoryEnum | null;
  };
}) => {
  const StartSessionFormSchema = z.object({
    minimalRowerCategory: z.enum([
      "null",
      AgeCategoryEnum.J10,
      AgeCategoryEnum.J12,
      AgeCategoryEnum.J14,
      AgeCategoryEnum.J16,
      AgeCategoryEnum.J18,
      AgeCategoryEnum.SENIOR,
    ]),
    minimalRowerType: z.enum([
      "null",
      SeriousnessCategoryEnum.RECREATIONAL,
      SeriousnessCategoryEnum.COMPETITOR,
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
  const { t } = useTranslation();
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

    toast.success(t("parameters.configurationUpdated"));
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
        ℹ️ {t("parameters.boatLevelSystemDescription")}
        <br />
        <br />
        {t("parameters.boatLevelSystemDescription2")}
      </p>

      <div>
        <Label className="flex flex-col gap-1">
          {t("parameters.minimalRowerCategory")}
          <select className="input" {...form.register("minimalRowerCategory")}>
            {AGE_CATEGORIES.map((category) => (
              <option
                key={category.category}
                value={category.category || "null"}
              >
                {category.order} -{" "}
                {category.category || t("parameters.noMinimalCategory")}
              </option>
            ))}
          </select>
        </Label>

        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          {t("parameters.minimalRowerType")}
          <select className="input" {...form.register("minimalRowerType")}>
            {SERIOUSNESS_CATEGORIES.map((type) => (
              <option key={type.type} value={type.type || "null"}>
                {type.order} - {type.label || t("parameters.noMinimalType")}
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
          {t("parameters.updateConfiguration")}
        </Button>
      </div>
    </form>
  );
};
