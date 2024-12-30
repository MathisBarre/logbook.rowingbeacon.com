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
import { Rower } from "../../_common/types/rower.type";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";

const useUpdateRowerForm = ({
  defaultValues,
}: {
  defaultValues: {
    rowerName?: string;
    category: RowerCategoryEnum | null;
    type: RowerTypeEnum | null;
  };
}) => {
  const StartSessionFormSchema = z.object({
    rowerName: z.string(),
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

  type UpdateRowerFormValues = z.infer<typeof StartSessionFormSchema>;

  const form = useForm<UpdateRowerFormValues>({
    resolver: zodResolver(StartSessionFormSchema),
    defaultValues: {
      rowerName: defaultValues.rowerName || "",
      category: defaultValues.category || "null",
      type: defaultValues.type || "null",
    },
  });

  return form;
};

export const UpdateRower = ({
  rower,
  close,
}: {
  rower: Rower;
  close: () => void;
}) => {
  const { updateRower } = useClubOverviewStore();
  const form = useUpdateRowerForm({
    defaultValues: {
      rowerName: rower.name,
      category: rower.category || null,
      type: rower.type || null,
    },
  });

  const onSubmit = () => {
    const formValue = form.getValues();

    const newValues = {
      name: formValue.rowerName,
      category: formValue.category === "null" ? undefined : formValue.category,
      type: formValue.type === "null" ? undefined : formValue.type,
    };

    updateRower(rower.id, newValues);

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
          Nom
          <input
            className="input"
            type="text"
            {...form.register("rowerName")}
          />
        </Label>

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
