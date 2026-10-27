import { useTranslation } from "react-i18next";
import { Label } from "../../_common/components/Label";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";
import { BoatTypeEnum } from "../../_common/business/boat.rules";
import {
  BoatConfiguration,
  getConfigurationFromLegacyType,
  getDefaultConfiguration,
  getConfigurationError,
  getLegacyTypeFromConfiguration,
  renewChangedConfigurations,
} from "../../_common/business/boatConfiguration.rules";
import { BoatConfigurationsEditor } from "./BoatConfigurationsEditor";
import { useState } from "react";
import { v4 } from "uuid";

type UpdateBoatFormValues = {
  boatName: string;
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
  const { t } = useTranslation();
  const {
    updateBoatName,
    updateBoat,
    toggleBoatIsInMaintenance,
    updateBoatNote,
    getBoatById,
  } = useClubOverviewStore();

  const initialConfigurations: BoatConfiguration[] = getBoatById(boat.id)
    ?.configurations ?? [
    {
      id: v4(),
      ...getConfigurationFromLegacyType(boat.type),
      isDefault: true,
      position: 0,
    },
  ];
  const [configurations, setConfigurations] = useState(initialConfigurations);

  const form = useUpdateBoatForm({
    defaultValues: {
      boatName: boat.name,
      isInMaintenance: boat.isInMaintenance || false,
      note: boat.note || "",
    },
  });

  const hasConfigurationError = configurations.some(
    (configuration) =>
      getConfigurationError(
        configuration,
        configurations,
        initialConfigurations
      ) !== null
  );

  const onSubmit = () => {
    if (hasConfigurationError) return;
    const values = form.getValues();
    const boatName = values.boatName.trim();
    if (boatName === "") {
      form.setError("boatName", { message: t("parameters.nameRequired") });
      return;
    }

    if (boatName !== boat.name) {
      updateBoatName(boat.id, boatName);
    }

    if (
      JSON.stringify(configurations) !== JSON.stringify(initialConfigurations)
    ) {
      updateBoat(boat.id, {
        configurations: renewChangedConfigurations(
          configurations,
          initialConfigurations,
          v4
        ).map((configuration, position) => ({
          ...configuration,
          position,
        })),
        type: getLegacyTypeFromConfiguration(
          getDefaultConfiguration(configurations)
        ),
      });
    }

    if ((boat.isInMaintenance || false) !== values.isInMaintenance) {
      toggleBoatIsInMaintenance(boat.id);
    }

    if ((boat.note || "") !== values.note) {
      updateBoatNote(boat.id, values.note);
    }

    toast.success(t("parameters.boatUpdated"));
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
          {t("boat.name")}
          <input
            className="input"
            type="text"
            {...form.register("boatName", {
              onChange: () => form.clearErrors("boatName"),
            })}
          />
          {form.formState.errors.boatName?.message && (
            <p className="form-error">
              {form.formState.errors.boatName.message}
            </p>
          )}
        </Label>

        <BoatConfigurationsEditor
          configurations={configurations}
          saved={initialConfigurations}
          onChange={setConfigurations}
        />

        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            {...form.register("isInMaintenance")}
          />
          {t("parameters.inMaintenance")}
        </Label>

        <Label className="flex flex-col gap-1">
          {t("parameters.noteDisplayedAtSessionStart")}
          <textarea
            rows={5}
            className="input resize-y"
            {...form.register("note")}
          />
        </Label>
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          className="flex-1"
          disabled={hasConfigurationError}
        >
          {t("parameters.updateBoat")}
        </Button>
      </div>
    </form>
  );
};
