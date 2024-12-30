import { Label } from "../../_common/components/Label";
import {
  rowerCategories,
  RowerCategoryEnum,
  rowerType,
  RowerTypeEnum,
} from "../../_common/store/boatLevelConfig.store";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";

const useBulkUpdateRowerForm = () => {
  const BulkUpdateRowerSchema = z.object({
    category: z.enum([
      "null",
      RowerCategoryEnum.J10,
      RowerCategoryEnum.J12,
      RowerCategoryEnum.J14,
      RowerCategoryEnum.J16,
      RowerCategoryEnum.J18,
      RowerCategoryEnum.SENIOR,
    ]),
    type: z.enum([
      "null",
      RowerTypeEnum.RECREATIONAL,
      RowerTypeEnum.COMPETITOR,
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

    toast.success("Le rameur a été mise à jour");

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
          Catégorie
          <select className="input" {...form.register("category")}>
            {rowerCategories.map((category) => (
              <option
                key={category.category}
                value={category.category || "null"}
              >
                {category.category || "Aucune catégorie"}
              </option>
            ))}
          </select>
        </Label>

        <Label className="flex flex-col gap-1">
          Type
          <select className="input" {...form.register("type")}>
            {rowerType.map((type) => (
              <option key={type.type} value={type.type || "null"}>
                {type.label || "Aucun type"}
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
