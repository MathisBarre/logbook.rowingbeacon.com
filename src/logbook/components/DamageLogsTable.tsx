import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BoatDamage } from "../../_common/database/repositories/club.types";
import { useDamageStore } from "../../_common/store/damage.store";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useLocaleStore } from "../../_common/store/locale.store";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import {
  sortDamages,
  sortDamagesChronologically,
  isDamageOpen,
} from "../../_common/business/damage.rules";
import {
  DamageFilter,
  filterDamages,
  formatRepairCost,
} from "../../_common/business/damageLog.rules";
import {
  formatDate,
  getDateOnly,
  getTime,
} from "../../_common/utils/date.utils";
import { cn } from "../../_common/utils/utils";
import { DamageSeverityBadge } from "../../_common/components/damages/DamageSeverityBadge";
import { DamageDescription } from "../../_common/components/damages/DamageFields";
import { EditDamageDialog } from "../../_common/components/damages/EditDamageDialog";
import { FixDamageDialog } from "../../_common/components/damages/FixDamageDialog";

const FILTERS: DamageFilter[] = ["open", "all"];

export function DamageLogsTable() {
  const { t } = useTranslation();
  const damages = useDamageStore((state) => state.damages);
  const [filter, setFilter] = useState<DamageFilter>("open");
  const [editing, setEditing] = useState<BoatDamage | null>(null);
  const [fixing, setFixing] = useState<BoatDamage | null>(null);

  // The open list puts the most serious first; the history is chronological.
  const shown = useMemo(
    () =>
      filter === "open"
        ? filterDamages(sortDamages(damages), filter)
        : sortDamagesChronologically(damages),
    [damages, filter]
  );

  return (
    <>
      <div
        className="flex gap-2 px-12 py-3 border-b"
        role="group"
        aria-label={t("damages.filter.label")}
      >
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "px-3 py-1 rounded text-sm border",
              filter === value
                ? "bg-steel-blue-700 text-white border-steel-blue-700"
                : "bg-steel-blue-50 text-steel-blue-800 border-steel-blue-200 hover:bg-steel-blue-100"
            )}
          >
            {t(`damages.filter.${value}`)}
          </button>
        ))}
      </div>

      <div className="overflow-auto pb-32">
        {shown.length === 0 && (
          <p className="text-center py-16">{t(`damages.empty.${filter}`)}</p>
        )}

        {shown.map((damage) => (
          <DamageRow
            key={damage.id}
            damage={damage}
            onEdit={setEditing}
            onFix={setFixing}
          />
        ))}
      </div>

      <EditDamageDialog damage={editing} onClose={() => setEditing(null)} />
      <FixDamageDialog damage={fixing} onClose={() => setFixing(null)} />
    </>
  );
}

const DamageRow = ({
  damage,
  onEdit,
  onFix,
}: {
  damage: BoatDamage;
  onEdit: (damage: BoatDamage) => void;
  onFix: (damage: BoatDamage) => void;
}) => {
  const { t } = useTranslation();
  const locale = useLocaleStore((state) => state.locale) || "en-US";
  const clubOverview = useClubOverviewStore();
  const reopenDamage = useDamageStore((state) => state.reopenDamage);
  const adminEditSystem = useAdminEditModeSystem();

  const isOpen = isDamageOpen(damage);
  // A boat out of service without a damage is not "repaired", it is back in service.
  const isUnavailable = damage.kind === "unavailable";
  const boatName =
    clubOverview.getBoatById(damage.boatId)?.name || "NAME_NOT_FOUND";
  const editLabel = t("common.edit");
  const fixLabel = t(isUnavailable ? "damages.unavailable.fix" : "damages.fix");
  const reopenLabel = t("damages.reopen");
  const labelOnBoat = (action: string) =>
    t("damages.actionOnBoat", { action, boat: boatName });
  const rowerName = (rowerId: string | null) =>
    rowerId ? clubOverview.getRowerById(rowerId)?.name : undefined;
  const reporter = rowerName(damage.reportedByRowerId);
  const fixer = rowerName(damage.fixedByRowerId);

  // Changing a damage is a manager's job, as removing a session is.
  const withAdminAccess = (action: () => void) => async () => {
    if (await adminEditSystem.askForAdminAccess()) {
      action();
    }
  };

  return (
    <div className="flex even:bg-gray-100 py-6 px-12 items-start relative">
      <div className="mr-12 font-mono tracking-tighter">
        <div className="flex justify-center flex-col items-end text-sm gap-1">
          <p>{getDateOnly(damage.reportedAt)}</p>
          <p>{getTime(damage.reportedAt)}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono tracking-tighter">{boatName}</span>
          <DamageSeverityBadge severity={damage.severity} />
          {!isOpen && (
            <span className="text-xs text-gray-500">
              {t(isUnavailable ? "damages.unavailable.fixed" : "damages.fixed")}
            </span>
          )}
        </div>

        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          <DamageDescription damage={damage} />
        </p>

        {reporter && (
          <p className="text-sm text-gray-400">
            {t("damages.reportedByName", { name: reporter })}
          </p>
        )}

        {damage.fixedAt && (
          <div className="text-sm text-gray-600 border-l-2 border-gray-300 pl-3 flex flex-col gap-1">
            <p>
              {t(
                isUnavailable
                  ? "damages.unavailable.fixedOn"
                  : "damages.fixedOn",
                { date: formatDate(damage.fixedAt) }
              )}
              {fixer && ` · ${t("damages.fixedByName", { name: fixer })}`}
            </p>
            {damage.repairNote && (
              <p className="whitespace-pre-wrap">{damage.repairNote}</p>
            )}
            {damage.repairCost !== null && (
              <p>
                {t("damages.repairCostValue", {
                  cost: formatRepairCost(damage.repairCost, locale),
                })}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-4 text-sm">
          <RowAction
            label={labelOnBoat(editLabel)}
            onClick={withAdminAccess(() => onEdit(damage))}
          >
            {editLabel}
          </RowAction>
          {isOpen ? (
            <RowAction
              label={labelOnBoat(fixLabel)}
              onClick={withAdminAccess(() => onFix(damage))}
            >
              {fixLabel}
            </RowAction>
          ) : (
            <RowAction
              label={labelOnBoat(reopenLabel)}
              onClick={withAdminAccess(() => {
                reopenDamage(damage.id);
                toast.success(
                  t(
                    isUnavailable
                      ? "damages.unavailable.reopened"
                      : "damages.reopened"
                  )
                );
              })}
            >
              {reopenLabel}
            </RowAction>
          )}
        </div>
      </div>
    </div>
  );
};

const RowAction = ({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => Promise<void>;
}) => (
  <button
    type="button"
    aria-label={label}
    onClick={() => void onClick()}
    className="text-steel-blue-700 hover:underline"
  >
    {children}
  </button>
);
