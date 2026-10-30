import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { Pin } from "lucide-react";
import type { ChartSpec } from "../chartSpec";
import type { ParamDef, ParamValue, QueryOrigin, SavedQuery } from "../types";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import { secondaryButtonClass } from "../components/AnalyticsStates";
import { PinDialog } from "./PinDialog";

/** What gets pinned (plan 1.4); a draft is saved as a query first. */
export type PinSource =
  | { kind: "report"; reportId: string }
  | {
      kind: "query";
      queryId?: string;
      draft?: {
        title: string;
        sql: string;
        params: ParamDef[];
        chart: ChartSpec | null;
        /** Default "user"; "ai" for an assistant answer (plan 2.11). */
        origin?: QueryOrigin;
        description?: string | null;
        basedOnReportId?: string | null;
      };
    };

interface PinButtonProps {
  source: PinSource;
  paramValues: Record<string, ParamValue>;
  chartOverride?: ChartSpec | null;
  /**
   * Called with the stored query once a draft was saved (the Explorer
   * then knows its id), even when adding the item failed afterwards.
   */
  onDraftSaved?: (query: SavedQuery) => void;
  /**
   * Awaited once the password is given, before the dialog opens (the
   * Explorer checks its query first); false keeps the dialog closed.
   */
  beforeOpen?: () => Promise<boolean>;
}

/**
 * "Épingler au tableau de bord" (admin, plan 1.6): asks for the password
 * when locked, then opens the pin dialog.
 */
export const PinButton = ({
  source,
  paramValues,
  chartOverride = null,
  onDraftSaved,
  beforeOpen,
}: PinButtonProps) => {
  const { t } = useTranslation();
  const { isUnlocked, unlock } = useAnalyticsAdmin();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          void (async () => {
            if (!(await unlock())) return;
            if (beforeOpen && !(await beforeOpen())) return;
            setOpen(true);
          })();
        }}
      >
        {isUnlocked ? (
          <Pin className="w-5 h-5" aria-hidden />
        ) : (
          <LockClosedIcon className="w-5 h-5" aria-hidden />
        )}
        {t("analytics.common.actions.pin")}
      </button>
      {open && (
        <PinDialog
          open={open}
          onOpenChange={setOpen}
          source={source}
          paramValues={paramValues}
          chartOverride={chartOverride}
          onDraftSaved={onDraftSaved}
        />
      )}
    </>
  );
};
