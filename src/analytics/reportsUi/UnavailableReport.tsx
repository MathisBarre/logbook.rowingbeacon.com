import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PuzzlePieceIcon } from "@heroicons/react/24/outline";
import {
  MODULE_IDS,
  type ModuleId,
} from "../../_common/business/modules.rules";
import { confirm } from "../../_common/components/WindowConfirm";
import { useModulesStore } from "../../_common/store/modules.store";
import useNavigationStore from "../../_common/store/navigation.store";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import type { ReportAvailability } from "../types";
import { requestParametersPage } from "./parametersRequest";

type Unavailable = Extract<ReportAvailability, { available: false }>;

/** Focus ring and disabled look shared by the report buttons (review K 54). */
export const actionButtonClass =
  "min-h-11 min-w-11 px-4 rounded text-sm font-medium border border-steel-blue-200 bg-steel-blue-50 text-steel-blue-800 hover:bg-steel-blue-100 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

/** True when the app knows the module, so it can be turned on. */
export const isKnownModule = (module: string): module is ModuleId =>
  (MODULE_IDS as readonly string[]).includes(module);

/**
 * True when the report can never run in this version: its data is not
 * recorded, or its module does not exist yet (review D 29).
 */
export const cannotEverRun = (availability: Unavailable): boolean =>
  availability.reason === "table" || !isKnownModule(availability.module);

/** Why a report cannot run, as one sentence. */
export const useUnavailableReason = () => {
  const { t } = useTranslation();
  return (availability: Unavailable): string =>
    availability.reason === "module" && isKnownModule(availability.module)
      ? t("analytics.common.unavailable.module", {
          module: t(`modules.${availability.module}.name`, {
            defaultValue: availability.module,
          }),
        })
      : t("analytics.reports.unavailable.data");
};

/**
 * "Activer le module …" (review G 43): unlock, say what the module adds,
 * turn it on here (the report then runs in place), and offer Gestion in
 * the toast.
 */
export const EnableModuleButton = ({ module }: { module: string }) => {
  const { t } = useTranslation();
  const { unlock } = useAnalyticsAdmin();
  if (!isKnownModule(module)) return null;
  const name = t(`modules.${module}.name`, { defaultValue: module });
  const enable = async () => {
    if (!(await unlock())) return;
    const accepted = await confirm({
      title: t("analytics.reports.module.confirmTitle", { module: name }),
      message: t("analytics.reports.module.confirmMessage", {
        adds: t(`modules.${module}.adds`, { defaultValue: "" }),
      }).trim(),
    }).catch(() => false);
    if (!accepted) return;
    useModulesStore.getState().enable(module);
    toast.success(t("analytics.reports.module.enabled", { module: name }), {
      action: {
        label: t("analytics.reports.module.seeInSettings"),
        onClick: () => {
          requestParametersPage("modules");
          useNavigationStore.getState().setPage("parameters");
        },
      },
    });
  };
  return (
    <button
      type="button"
      className={actionButtonClass}
      onClick={() => void enable()}
    >
      <PuzzlePieceIcon className="w-5 h-5" aria-hidden />
      {t("analytics.common.unavailable.enableModule", { module: name })}
    </button>
  );
};

/** What a module adds ("Ajoute une distance aux parcours…"), or null. */
export const useModuleAdds = () => {
  const { t } = useTranslation();
  return (availability: Unavailable): string | null =>
    availability.reason === "module" && isKnownModule(availability.module)
      ? t(`modules.${availability.module}.adds`, { defaultValue: "" }) || null
      : null;
};

/**
 * A report whose module is off or whose data does not exist in this
 * version (plan 1.5 "Unavailable"): the reason, what the module adds and
 * the action that turns it on.
 */
export const UnavailableReport = ({
  availability,
}: {
  availability: Unavailable;
}) => {
  const reason = useUnavailableReason();
  const adds = useModuleAdds()(availability);
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center h-full">
      <PuzzlePieceIcon className="w-8 h-8 text-gray-500" aria-hidden />
      <p className="text-sm font-medium text-gray-900 max-w-prose">
        {reason(availability)}
      </p>
      {adds && <p className="text-sm text-gray-600 max-w-prose">{adds}</p>}
      {availability.reason === "module" && (
        <EnableModuleButton module={availability.module} />
      )}
    </div>
  );
};
