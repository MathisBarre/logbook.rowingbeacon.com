import { useTranslation } from "react-i18next";
import { Label } from "../../_common/components/Label";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";
import {
  SERIOUSNESS_CATEGORIES,
  SeriousnessCategoryEnum,
} from "../../_common/business/seriousness.rules";
import { AGE_CATEGORIES } from "../../_common/business/ageCategory.rules";
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";

const useBulkUpdateRowerForm = () => {
  const BulkUpdateRowerSchema = z.object({
    category: z.enum([
      "null",
      AgeCategoryEnum.J10,
      AgeCategoryEnum.J12,
      AgeCategoryEnum.J14,
      AgeCategoryEnum.J16,
      AgeCategoryEnum.J18,
      AgeCategoryEnum.SENIOR,
    ]),
    type: z.enum([
      "null",
      SeriousnessCategoryEnum.RECREATIONAL,
      SeriousnessCategoryEnum.COMPETITOR,
    ]),
  });

  type UpdateRowerFormValues = z.infer<typeof BulkUpdateRowerSchema>;

  const form = useForm<UpdateRowerFormValues>({
    resolver: zodResolver(BulkUpdateRowerSchema),
  });

  return form;
};

export const BulkUpdateRower = ({
  rowersIds,
  close,
}: {
  rowersIds: string[];
  close: () => void;
}) => {
  const { t } = useTranslation();
  const { updateRowers } = useClubOverviewStore();
  const form = useBulkUpdateRowerForm();

  const onSubmit = () => {
    const formValue = form.getValues();

    const newValues = {
      category: formValue.category === "null" ? undefined : formValue.category,
      type: formValue.type === "null" ? undefined : formValue.type,
    };

    updateRowers(rowersIds, newValues);

    form.reset(newValues);

    toast.success(t("parameters.rowersUpdated"));

    close();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-4">
        <Label className="flex flex-col gap-1">
          {t("rower.category")}
          <select className="input" {...form.register("category")}>
            {AGE_CATEGORIES.map((category) => (
              <option
                key={category.category}
                value={category.category || "null"}
              >
                {category.category || t("parameters.noCategory")}
              </option>
            ))}
          </select>
        </Label>

        <Label className="flex flex-col gap-1">
          {t("parameters.type")}
          <select className="input" {...form.register("type")}>
            {SERIOUSNESS_CATEGORIES.map((type) => (
              <option key={type.type} value={type.type || "null"}>
                {type.translationKey
                  ? t(type.translationKey)
                  : t("parameters.noType")}
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
