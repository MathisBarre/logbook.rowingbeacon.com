import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Button from "../_common/components/Button";
import { Checkbox } from "../_common/components/Checkbox";
import { Dialog, DialogContent } from "../_common/components/Dialog/Dialog";
import { unlockWith } from "../analytics/access/useAnalyticsAdmin";
import { useAnalyticsHubStore } from "../analytics/store/analyticsHub.store";
import { useAdminEditModeSystem } from "../_common/store/adminEditMode.system";
import { useModulesStore } from "../_common/store/modules.store";
import useNavigationStore from "../_common/store/navigation.store";
import { useDemoStore } from "./demo.store";
import {
  countDone,
  DemoGuideStep,
  getGuideGroups,
  stepNeedsAdmin,
} from "./demoGuide";
import { consumeDemoGuidePending, DEMO_ADMIN_PASSWORD_HINT } from "./demoMode";

/** The dialog closes before a password prompt: its focus trap would hold it. */
const WAIT_FOR_DIALOG_CLOSE_MS = 150;

/** "What to try?": a checklist of guided tours through the demo club. */
export const DemoGuideDialog = () => {
  const { t } = useTranslation();
  const isOpen = useDemoStore((state) => state.isGuideOpen);
  const doneStepIds = useDemoStore((state) => state.doneStepIds);
  const { openGuide, closeGuide, toggleStep, requestParametersTab } =
    useDemoStore.getState();
  const enabledModules = useModulesStore((state) => state.enabled);
  const setPage = useNavigationStore((state) => state.setPage);
  const adminEditSystem = useAdminEditModeSystem();

  // Right after entering the demo, once.
  useEffect(() => {
    if (consumeDemoGuidePending()) openGuide();
  }, [openGuide]);

  const groups = getGuideGroups((module) => enabledModules.includes(module));
  const steps = groups.flatMap(({ steps: groupSteps }) => groupSteps);

  const go = async (step: DemoGuideStep) => {
    closeGuide();
    if (step.page === "parameters") {
      await new Promise((resolve) =>
        setTimeout(resolve, WAIT_FOR_DIALOG_CLOSE_MS)
      );
      // Same password as the Gestion button: the demo shows how it works.
      if (!(await adminEditSystem.askForAdminAccess())) return;
      requestParametersTab(step.parametersTab ?? null);
    }
    if (step.analyticsTab) {
      useAnalyticsHubStore.getState().setTab(step.analyticsTab);
    }
    setPage(step.page);
    if (step.analyticsTab === "explorer") {
      // The Explorer is behind the admin password: ask for it on arrival,
      // with the same password, so the step lands on the tool, not a padlock.
      // (Refused or cancelled: the tab stays locked, with its own button.)
      await new Promise((resolve) =>
        setTimeout(resolve, WAIT_FOR_DIALOG_CLOSE_MS)
      );
      await unlockWith(() => adminEditSystem.askForAdminAccess());
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => (open ? openGuide() : closeGuide())}
    >
      <DialogContent
        title={t("demo.guide.title")}
        subtitle={t("demo.guide.subtitle")}
        className="max-w-3xl"
      >
        <div className="flex flex-col gap-6">
          <p className="text-sm font-medium text-steel-blue-800">
            {t("demo.guide.progress", {
              done: countDone(doneStepIds, steps),
              total: steps.length,
            })}
          </p>
          {groups.map(({ group, steps: groupSteps }) => (
            <section key={group} className="flex flex-col">
              <h2 className="font-bold text-lg text-gray-900 border-b pb-1">
                {t(`demo.guide.groups.${group}`)}
              </h2>
              <ul>
                {groupSteps.map((step) => (
                  <li
                    key={step.id}
                    className="flex items-start gap-3 py-3 border-b last:border-b-0"
                  >
                    <Checkbox
                      id={`demo-step-${step.id}`}
                      className="mt-0.5 h-5 w-5 border-steel-blue-800 data-[state=checked]:bg-steel-blue-800 data-[state=checked]:text-white"
                      checked={doneStepIds.includes(step.id)}
                      onCheckedChange={() => toggleStep(step.id)}
                    />
                    <label
                      htmlFor={`demo-step-${step.id}`}
                      className="flex-1 cursor-pointer"
                    >
                      <span className="block font-medium text-gray-900">
                        {t(`demo.guide.steps.${step.id}.title`)}
                      </span>
                      <span className="block text-sm text-gray-600">
                        {t(`demo.guide.steps.${step.id}.description`)}
                      </span>
                      {stepNeedsAdmin(step) && (
                        <span className="block text-xs text-gray-500 mt-1">
                          {t("demo.guide.adminHint", {
                            password: DEMO_ADMIN_PASSWORD_HINT,
                          })}
                        </span>
                      )}
                    </label>
                    <Button
                      type="button"
                      variant="outlined"
                      className="shrink-0"
                      onClick={() => void go(step)}
                    >
                      {t("demo.guide.go")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
