import { Label } from "../../_common/components/Label";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";
import {
  boathTypeWithLabel,
  BoatTypeEnum,
} from "../../_common/business/boat.rules";

type UpdateBoatFormValues = {
  boatName: string;
  boatType: BoatTypeEnum;
  isInMaintenance: boolean;
  note: string;
};

const useUpdateBoatForm = ({
  defaultValues,
}: {
  defaultValues: UpdateBoatFormValues;
}) => {
  const UpdateBoatFormSchema = z.object({
    boatName: z.string(),
    boatType: z.nativeEnum(BoatTypeEnum),
    isInMaintenance: z.boolean(),
    note: z.string(),
  });

  const form = useForm<UpdateBoatFormValues>({
    resolver: zodResolver(UpdateBoatFormSchema),
    defaultValues,
  });

  return form;
};

export const UpdateBoat = ({
  boat,
  close,
}: {
  boat: {
    id: string;
    name: string;
    type?: BoatTypeEnum;
    isInMaintenance?: boolean;
    note?: string;
  };
  close: () => void;
}) => {
  const {
    updateBoatName,
    updateBoatType,
    toggleBoatIsInMaintenance,
    updateBoatNote,
  } = useClubOverviewStore();

  const form = useUpdateBoatForm({
    defaultValues: {
      boatName: boat.name,
      boatType: boat.type || BoatTypeEnum.OTHER,
      isInMaintenance: boat.isInMaintenance || false,
      note: boat.note || "",
    },
  });

  const onSubmit = () => {
    const values = form.getValues();

    if (values.boatName !== boat.name) {
      updateBoatName(boat.id, values.boatName);
    }

    if ((boat.type || BoatTypeEnum.OTHER) !== values.boatType) {
      updateBoatType(boat.id, values.boatType);
    }

    if ((boat.isInMaintenance || false) !== values.isInMaintenance) {
      toggleBoatIsInMaintenance(boat.id);
    }

    if ((boat.note || "") !== values.note) {
      updateBoatNote(boat.id, values.note);
    }

    toast.success("Le bateau a été mis à jour");
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
          <input className="input" type="text" {...form.register("boatName")} />
        </Label>

        <Label className="flex flex-col gap-1">
          Type
          <select className="input" {...form.register("boatType")}>
            {boathTypeWithLabel.map((type) => (
              <option key={type.type} value={type.type}>
                {type.label}
              </option>
            ))}
          </select>
        </Label>

        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            {...form.register("isInMaintenance")}
          />
          En maintenance
        </Label>

        <Label className="flex flex-col gap-1">
          Note (affichée au début d&apos;une séance)
          <textarea
            rows={5}
            className="input resize-y"
            {...form.register("note")}
          />
        </Label>
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button type="submit" className="flex-1">
          Mettre à jour le bateau
        </Button>
      </div>
    </form>
  );
};
