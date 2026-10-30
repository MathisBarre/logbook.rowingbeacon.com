import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Label } from "../Label";
import Button from "../Button";
import { SimpleDialog } from "../SimpleDialog";
import {
  BoatDamage,
  DamageSeverity,
} from "../../database/repositories/club.types";
import { useDamageStore } from "../../store/damage.store";
import { DamageRowerField, DamageSeverityField } from "./DamageFields";
import { DamageSeverityBadge } from "./DamageSeverityBadge";

type EditDamageFormValues = {
  severity: DamageSeverity;
  description: string;
  reportedByRowerId: string;
};

export const EditDamageDialog = ({
  damage,
  onClose,
}: {
  damage: BoatDamage | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <SimpleDialog
      modal={true}
      open={damage !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("damages.editDialogTitle")}
    >
      {damage && <EditDamageForm damage={damage} close={onClose} />}
    </SimpleDialog>
  );
};

const EditDamageForm = ({
  damage,
  close,
}: {
  damage: BoatDamage;
  close: () => void;
}) => {
  const { t } = useTranslation();
  const updateDamage = useDamageStore((state) => state.updateDamage);
  // A boat put out of service without a damage has no description to require.
  const isUnavailable = damage.kind === "unavailable";

  const form = useForm<EditDamageFormValues>({
    defaultValues: {
      severity: damage.severity,
      description: damage.description,
      reportedByRowerId: damage.reportedByRowerId ?? "",
    },
  });
  const { errors } = form.formState;

  const onSubmit = () => {
    const values = form.getValues();
    if (!isUnavailable && values.description.trim() === "") {
      form.setError("description", {
        message: t("damages.errors.descriptionRequired"),
      });
      return;
    }

    updateDamage(damage.id, {
      severity: isUnavailable ? damage.severity : values.severity,
      description: values.description.trim(),
      reportedByRowerId: values.reportedByRowerId || null,
    });
    toast.success(t("damages.updated"));
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
        {isUnavailable ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {t("damages.fields.severity")}
            </p>
            <div>
              <DamageSeverityBadge severity={damage.severity} />
            </div>
            <p className="text-sm text-gray-600">
              {t("damages.unavailableSeverityNote")}
            </p>
          </div>
        ) : (
          <DamageSeverityField registration={form.register("severity")} />
        )}

        <Label className="flex flex-col gap-1">
          {isUnavailable ? (
            <span>
              {t("damages.fields.description")}{" "}
              <span className="font-normal text-gray-500">
                ({t("common.optional")})
              </span>
            </span>
          ) : (
            t("damages.fields.description")
          )}
          <textarea
            rows={3}
            className="input resize-y"
            {...form.register("description", {
              onChange: () => form.clearErrors("description"),
            })}
          />
          {errors.description?.message && (
            <p className="form-error">{errors.description.message}</p>
          )}
        </Label>

        <DamageRowerField
          label={t("damages.fields.reportedBy")}
          registration={form.register("reportedByRowerId")}
          currentRowerId={damage.reportedByRowerId}
        />
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outlined" onClick={close}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">{t("common.save")}</Button>
      </div>
    </form>
  );
};
