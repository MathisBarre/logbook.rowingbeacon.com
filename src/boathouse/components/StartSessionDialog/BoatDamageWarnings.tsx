import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";
import { DamageSeverityBadge } from "../../../_common/components/damages/DamageSeverityBadge";
import { getDepartureWarnings } from "../../../_common/business/damage.rules";
import { useDamageStore } from "../../../_common/store/damage.store";
import { useModule } from "../../../_common/store/modules.store";

/** Open damages of the chosen boat: shown, but they do not block the departure. */
export const BoatDamageWarnings = ({ boatId }: { boatId: string }) => {
  const { t } = useTranslation();
  const hasDamages = useModule("damages");
  const damages = useDamageStore((state) => state.damages);
  const warnings = useMemo(
    () => (hasDamages ? getDepartureWarnings(damages, boatId) : []),
    [hasDamages, damages, boatId],
  );

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="text-xs text-yellow-950 bg-yellow-50 border border-yellow-300 rounded p-2">
      <h3 className="font-medium mb-1 flex items-center gap-1">
        <TriangleAlertIcon className="h-4 w-4 text-yellow-700" />
        {t("session.boatDamages")}
      </h3>
      <ul className="flex flex-col gap-1">
        {warnings.map((damage) => (
          <li key={damage.id} className="flex gap-2 items-start">
            <DamageSeverityBadge severity={damage.severity} />
            <span className="whitespace-pre-wrap">{damage.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
