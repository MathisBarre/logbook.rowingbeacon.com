import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Label } from "../Label";
import Button from "../Button";
import { SimpleDialog } from "../SimpleDialog";
import { BoatDamage } from "../../database/repositories/club.types";
import { useDamageStore } from "../../store/damage.store";
import {
  getEarliestFixDate,
  isBeforeDate,
  isInTheFuture,
  parseRepairCost,
} from "../../business/damage.rules";
import { parseDamageDateTime } from "../../business/damageLog.rules";
import {
  formatDate,
  getCurrentDateTime,
  getDateTimeWithoutTimezone,
} from "../../utils/date.utils";
import { DamageRowerField } from "./DamageFields";

type FixDamageFormValues = {
  fixedAt: string;
  fixedByRowerId: string;
  repairNote: string;
  repairCost: string;
};

export const FixDamageDialog = ({
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
      title={t(
        damage?.kind === "unavailable"
          ? "damages.unavailable.fixDialogTitle"
          : "damages.fixDialogTitle"
      )}
    >
      {damage && <FixDamageForm damage={damage} close={onClose} />}
    </SimpleDialog>
  );
};

const FixDamageForm = ({
  damage,
  close,
}: {
  damage: BoatDamage;
  close: () => void;
}) => {
  const { t } = useTranslation();
  const fixDamage = useDamageStore((state) => state.fixDamage);
  // A boat put out of service without a damage has nothing to repair.
  const isUnavailable = damage.kind === "unavailable";
  const earliestFixDate = getEarliestFixDate(damage);

  const form = useForm<FixDamageFormValues>({
    defaultValues: {
      fixedAt: getCurrentDateTime(),
      fixedByRowerId: "",
      // An efa damage may carry a note or a cost while it is still open.
      repairNote: damage.repairNote ?? "",
      repairCost:
        damage.repairCost === null
          ? ""
          : // efa2 costs may carry more decimals than the form accepts.
            String(Math.round(damage.repairCost * 100) / 100),
    },
  });
  const { errors } = form.formState;

  const onSubmit = () => {
    const values = form.getValues();
    const fixedAt = parseDamageDateTime(values.fixedAt);
    const repairCost = isUnavailable
      ? null
      : parseRepairCost(values.repairCost);
    let dateError: string | null = null;
    if (fixedAt === null) {
      dateError = t("damages.errors.dateInvalid");
    } else if (isInTheFuture(fixedAt)) {
      dateError = t("damages.errors.dateInFuture");
    } else if (earliestFixDate && isBeforeDate(fixedAt, earliestFixDate)) {
      dateError = t("damages.errors.fixedBeforeReported", {
        date: formatDate(earliestFixDate),
      });
    }
    if (dateError) {
      form.setError("fixedAt", { message: dateError });
    }
    if (repairCost === "invalid") {
      form.setError("repairCost", { message: t("damages.errors.costInvalid") });
    }
    if (fixedAt === null || dateError || repairCost === "invalid") return;

    fixDamage(damage.id, {
      fixedAt,
      fixedByRowerId: values.fixedByRowerId || null,
      // Left undefined, the note and the cost of the entry are kept as they are.
      ...(isUnavailable
        ? {}
        : { repairNote: values.repairNote.trim() || null, repairCost }),
    });
    toast.success(
      t(isUnavailable ? "damages.unavailable.fixedToast" : "damages.fixedToast")
    );
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
        <div className="grid grid-cols-2 gap-4">
          <Label className="flex flex-col gap-1">
            {t(
              isUnavailable
                ? "damages.unavailable.fixedAt"
                : "damages.fields.fixedAt"
            )}
            <input
              className="input"
              type="datetime-local"
              min={
                earliestFixDate
                  ? getDateTimeWithoutTimezone(earliestFixDate)
                  : undefined
              }
              max={getCurrentDateTime()}
              {...form.register("fixedAt", {
                onChange: () => form.clearErrors("fixedAt"),
              })}
            />
            {errors.fixedAt?.message && (
              <p className="form-error">{errors.fixedAt.message}</p>
            )}
          </Label>
          <DamageRowerField
            label={t(
              isUnavailable
                ? "damages.unavailable.fixedBy"
                : "damages.fields.fixedBy"
            )}
            registration={form.register("fixedByRowerId")}
          />
        </div>

        {!isUnavailable && (
          <>
            <Label className="flex flex-col gap-1">
              <span>
                {t("damages.fields.repairNote")}{" "}
                <span className="font-normal text-gray-500">
                  ({t("common.optional")})
                </span>
              </span>
              <textarea
                rows={3}
                className="input resize-y"
                {...form.register("repairNote")}
              />
            </Label>

            <Label className="flex flex-col gap-1">
              <span>
                {t("damages.fields.repairCost")}{" "}
                <span className="font-normal text-gray-500">
                  ({t("common.optional")})
                </span>
              </span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                {...form.register("repairCost", {
                  onChange: () => form.clearErrors("repairCost"),
                })}
              />
              {errors.repairCost?.message && (
                <p className="form-error">{errors.repairCost.message}</p>
              )}
            </Label>
          </>
        )}
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outlined" onClick={close}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">
          {t(isUnavailable ? "damages.unavailable.fix" : "damages.fix")}
        </Button>
      </div>
    </form>
  );
};
