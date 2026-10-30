import { useDamageStore } from "../../_common/store/damage.store";
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
import { useEffect, useState } from "react";
import { v4 } from "uuid";
import { useModule } from "../../_common/store/modules.store";
import { BoatDamage } from "../../_common/database/repositories/club.types";
import {
  getOpenDamagesOfBoat,
  isBoatUnusable,
  isDamageOpen,
} from "../../_common/business/damage.rules";
import { DamageSeverityBadge } from "../../_common/components/damages/DamageSeverityBadge";
import { ReportDamageDialog } from "../../_common/components/damages/ReportDamageDialog";
import { FixDamageDialog } from "../../_common/components/damages/FixDamageDialog";
import { DamageDescription } from "../../_common/components/damages/DamageFields";

type UpdateBoatFormValues = {
  boatName: string;
  isInMaintenance: boolean;
  note: string;
};

/** The damages (not the plain "out of service" entries) that stop the boat. */
const hasOpenUnusableDamageIn = (openDamages: BoatDamage[]) =>
  openDamages.some(
    (damage) => damage.kind === "damage" && damage.severity === "unusable"
  );

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
  const { updateBoatName, updateBoat, updateBoatNote, getBoatById } =
    useClubOverviewStore();
  const setBoatOutOfService = useDamageStore(
    (state) => state.setBoatOutOfService
  );

  const hasDamages = useModule("damages");
  const damages = useDamageStore((state) => state.damages);
  const openDamages = getOpenDamagesOfBoat(damages, boat.id);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [fixing, setFixing] = useState<BoatDamage | null>(null);
  // With the module, a real damage is repaired with its details, not by
  // unticking the box: the box stays ticked until it is marked repaired.
  const hasOpenUnusableDamage = hasOpenUnusableDamageIn(openDamages);
  const isOutOfServiceLocked = hasDamages && hasOpenUnusableDamage;

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

  useEffect(() => {
    if (isOutOfServiceLocked) form.setValue("isInMaintenance", true);
  }, [isOutOfServiceLocked, form]);

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

    // A damage declared or repaired from this form may have changed the state since.
    const currentDamages = useDamageStore.getState().damages;
    const isOutOfService = isBoatUnusable(currentDamages, boat.id);
    const isLocked =
      hasDamages &&
      hasOpenUnusableDamageIn(getOpenDamagesOfBoat(currentDamages, boat.id));
    // A boat still flagged from before the damages module has no entry to close.
    const hasLegacyFlag = !isOutOfService && Boolean(boat.isInMaintenance);
    if (
      !isLocked &&
      (isOutOfService !== values.isInMaintenance ||
        (hasLegacyFlag && !values.isInMaintenance))
    ) {
      setBoatOutOfService(boat.id, values.isInMaintenance);
    }

    if ((boat.note || "") !== values.note) {
      updateBoatNote(boat.id, values.note);
    }

    toast.success(t("parameters.boatUpdated"));
    close();
  };

  return (
    <>
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
              disabled={isOutOfServiceLocked}
              {...form.register("isInMaintenance")}
            />
            {t("parameters.inMaintenance")}
          </Label>

          {hasDamages && (
            <div className="flex flex-col gap-2 -mt-2">
              {isOutOfServiceLocked && (
                <p className="text-sm text-gray-600">
                  {t("damages.outOfServiceLocked")}
                </p>
              )}
              <p className="text-sm font-medium">{t("damages.openOnBoat")}</p>
              {openDamages.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {t("damages.noOpenOnBoat")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {openDamages.map((damage) => (
                    <li key={damage.id} className="flex items-start gap-2">
                      <DamageSeverityBadge severity={damage.severity} />
                      <span className="text-sm text-gray-700 flex-1">
                        <DamageDescription damage={damage} />
                      </span>
                      <button
                        type="button"
                        className="text-sm text-steel-blue-700 hover:underline"
                        onClick={() => setFixing(damage)}
                      >
                        {t(
                          damage.kind === "unavailable"
                            ? "damages.unavailable.fix"
                            : "damages.fix"
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  type="button"
                  variant="outlined"
                  className="text-sm py-1"
                  onClick={() => setIsReportOpen(true)}
                >
                  {t("damages.report")}
                </Button>
              </div>
            </div>
          )}

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

      {hasDamages && (
        <ReportDamageDialog
          open={isReportOpen}
          onOpenChange={setIsReportOpen}
          defaults={{ boatId: boat.id }}
          lockBoat
          onReported={(damage) => {
            // Only a damage that stops the boat changes the box.
            if (damage.severity === "unusable") {
              form.setValue("isInMaintenance", true);
            }
          }}
        />
      )}

      {hasDamages && (
        <FixDamageDialog
          damage={fixing}
          onClose={() => {
            const current = useDamageStore.getState().damages;
            const wasFixed = current.some(
              (damage) => damage.id === fixing?.id && !isDamageOpen(damage)
            );
            setFixing(null);
            // Repairing what stopped the boat unticks the box.
            if (wasFixed && fixing?.severity === "unusable") {
              form.setValue(
                "isInMaintenance",
                isBoatUnusable(current, boat.id)
              );
            }
          }}
        />
      )}
    </>
  );
};
