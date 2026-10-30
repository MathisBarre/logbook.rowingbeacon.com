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
import { useClubOverviewStore } from "../../store/clubOverview.store";
import { useDamageStore } from "../../store/damage.store";
import { parseDamageDateTime } from "../../business/damageLog.rules";
import { isInTheFuture } from "../../business/damage.rules";
import {
  getCurrentDateTime,
  getDateTimeWithoutTimezone,
} from "../../utils/date.utils";
import { DamageRowerField, DamageSeverityField } from "./DamageFields";

export interface ReportDamageDefaults {
  boatId?: string;
  description?: string;
  outingId?: string | null;
  incidentId?: string | null;
  reportedAt?: string;
}

type ReportDamageFormValues = {
  boatId: string;
  severity: DamageSeverity;
  description: string;
  reportedByRowerId: string;
  reportedAt: string;
};

export const ReportDamageDialog = ({
  open,
  onOpenChange,
  defaults,
  lockBoat,
  onReported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: ReportDamageDefaults;
  /** Opened for one boat: the boat of `defaults` cannot be changed. */
  lockBoat?: boolean;
  onReported?: (damage: BoatDamage) => void;
}) => {
  const { t } = useTranslation();

  return (
    <SimpleDialog
      modal={true}
      open={open}
      onOpenChange={onOpenChange}
      title={t("damages.reportDialogTitle")}
    >
      <ReportDamageForm
        defaults={defaults}
        lockBoat={lockBoat}
        close={() => onOpenChange(false)}
        onReported={onReported}
      />
    </SimpleDialog>
  );
};

const ReportDamageForm = ({
  defaults,
  lockBoat,
  close,
  onReported,
}: {
  defaults?: ReportDamageDefaults;
  lockBoat?: boolean;
  close: () => void;
  onReported?: (damage: BoatDamage) => void;
}) => {
  const { t } = useTranslation();
  const clubOverview = useClubOverviewStore();
  const reportDamage = useDamageStore((state) => state.reportDamage);

  const isBoatLocked = Boolean(lockBoat && defaults?.boatId);
  const boats = clubOverview.getAllBoats();
  const defaultBoat = defaults?.boatId
    ? clubOverview.getBoatById(defaults.boatId)
    : undefined;
  const options = [
    ...(defaultBoat && !boats.some((boat) => boat.id === defaultBoat.id)
      ? [defaultBoat]
      : []),
    ...boats,
  ].sort((a, b) => a.name.localeCompare(b.name));

  const form = useForm<ReportDamageFormValues>({
    defaultValues: {
      boatId: defaults?.boatId ?? "",
      severity: "usable",
      description: defaults?.description ?? "",
      reportedByRowerId: "",
      reportedAt: defaults?.reportedAt
        ? getDateTimeWithoutTimezone(defaults.reportedAt)
        : getCurrentDateTime(),
    },
  });
  const { errors } = form.formState;

  const onSubmit = () => {
    const values = form.getValues();
    // A disabled field is not read back from the form.
    const boatId = isBoatLocked ? (defaults?.boatId ?? "") : values.boatId;
    let valid = true;
    if (boatId === "") {
      form.setError("boatId", { message: t("damages.errors.boatRequired") });
      valid = false;
    }
    if (values.description.trim() === "") {
      form.setError("description", {
        message: t("damages.errors.descriptionRequired"),
      });
      valid = false;
    }
    const reportedAt = parseDamageDateTime(values.reportedAt);
    if (reportedAt === null) {
      form.setError("reportedAt", { message: t("damages.errors.dateInvalid") });
      valid = false;
    } else if (isInTheFuture(reportedAt)) {
      form.setError("reportedAt", {
        message: t("damages.errors.dateInFuture"),
      });
      valid = false;
    }
    if (!valid || reportedAt === null) return;

    const damage = reportDamage({
      boatId,
      severity: values.severity,
      description: values.description,
      reportedAt,
      reportedByRowerId: values.reportedByRowerId || null,
      outingId: defaults?.outingId ?? null,
      incidentId: defaults?.incidentId ?? null,
    });
    toast.success(t("damages.reported"));
    onReported?.(damage);
    close();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-4">
        <Label className="flex flex-col gap-1">
          {t("damages.fields.boat")}
          <select
            className="input"
            disabled={isBoatLocked}
            {...form.register("boatId", {
              onChange: () => form.clearErrors("boatId"),
            })}
          >
            <option value="" disabled>
              {t("damages.fields.chooseBoat")}
            </option>
            {options.map((boat) => (
              <option key={boat.id} value={boat.id}>
                {boat.name}
              </option>
            ))}
          </select>
          {errors.boatId?.message && (
            <p className="form-error">{errors.boatId.message}</p>
          )}
        </Label>

        <DamageSeverityField registration={form.register("severity")} />

        <Label className="flex flex-col gap-1">
          {t("damages.fields.description")}
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

        <div className="grid grid-cols-2 gap-4">
          <DamageRowerField
            label={t("damages.fields.reportedBy")}
            registration={form.register("reportedByRowerId")}
          />
          <Label className="flex flex-col gap-1">
            {t("damages.fields.reportedAt")}
            <input
              className="input"
              type="datetime-local"
              max={getCurrentDateTime()}
              {...form.register("reportedAt", {
                onChange: () => form.clearErrors("reportedAt"),
              })}
            />
            {errors.reportedAt?.message && (
              <p className="form-error">{errors.reportedAt.message}</p>
            )}
          </Label>
        </div>
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outlined" onClick={close}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">{t("damages.report")}</Button>
      </div>
    </form>
  );
};
