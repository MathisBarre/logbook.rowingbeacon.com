import { UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Label } from "../Label";
import {
  BoatDamage,
  DamageSeverity,
} from "../../database/repositories/club.types";
import { DAMAGE_SEVERITIES } from "../../business/damage.rules";
import { getDamageDescription } from "../../business/damageLog.rules";
import { useClubOverviewStore } from "../../store/clubOverview.store";
import { DamageSeverityBadge } from "./DamageSeverityBadge";

export const DamageSeverityField = ({
  registration,
  disabled,
}: {
  registration: UseFormRegisterReturn;
  disabled?: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium mb-1">
        {t("damages.fields.severity")}
      </legend>
      {DAMAGE_SEVERITIES.map((severity: DamageSeverity) => (
        <label
          key={severity}
          className="flex items-start gap-3 border rounded p-2 cursor-pointer has-[:checked]:border-steel-blue-600 has-[:checked]:bg-steel-blue-50"
        >
          <input
            type="radio"
            className="mt-1"
            value={severity}
            {...registration}
          />
          <span className="flex flex-col gap-1 items-start">
            <DamageSeverityBadge severity={severity} />
            <span className="text-sm text-gray-600">
              {t(`damages.severityHelp.${severity}`)}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
};

/** Active rowers, plus the one already chosen when they were archived since. */
export const DamageRowerField = ({
  label,
  registration,
  currentRowerId,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  currentRowerId?: string | null;
}) => {
  const { t } = useTranslation();
  const store = useClubOverviewStore();
  const rowers = store.getAllRowers();
  const current = currentRowerId
    ? store.getRowerById(currentRowerId)
    : undefined;
  const options = [
    ...(current && !rowers.some((rower) => rower.id === current.id)
      ? [current]
      : []),
    ...rowers,
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Label className="flex flex-col gap-1">
      <span>
        {label}{" "}
        <span className="font-normal text-gray-500">
          ({t("common.optional")})
        </span>
      </span>
      <select className="input" {...registration}>
        <option value="">{t("damages.fields.notSpecified")}</option>
        {options.map((rower) => (
          <option key={rower.id} value={rower.id}>
            {rower.name}
          </option>
        ))}
      </select>
    </Label>
  );
};

/** The description, or a generic text for an entry that has none. */
export const DamageDescription = ({ damage }: { damage: BoatDamage }) => {
  const { t } = useTranslation();

  return (
    <>
      {getDamageDescription(damage) ??
        (damage.kind === "unavailable"
          ? t("damages.unavailableDescription")
          : t("damages.noDescription"))}
    </>
  );
};
