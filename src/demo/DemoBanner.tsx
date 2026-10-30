import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlaskConicalIcon,
  ListChecksIcon,
  LogOutIcon,
  RotateCcwIcon,
} from "lucide-react";
import Button from "../_common/components/Button";
import { DemoConfirmDialog } from "./DemoConfirmDialog";
import { exitDemo, resetDemo } from "./demoSession";
import {
  DEMO_ADMIN_PASSWORD_HINT,
  getDemoExitLabelKey,
  readDemoState,
} from "./demoMode";
import { useDemoStore } from "./demo.store";

const SMALL_BUTTON = "h-7 px-2 py-0 text-xs gap-1";

/** Permanent, compact bar on every page while the demo club is open. */
export const DemoBanner = () => {
  const { t } = useTranslation();
  const openGuide = useDemoStore((state) => state.openGuide);
  const [confirming, setConfirming] = useState<"reset" | "exit" | null>(null);
  const [hadRealClub] = useState(() => readDemoState().hadRealClub);
  const exitLabelKey = getDemoExitLabelKey(hadRealClub);

  return (
    <>
      <div
        role="region"
        aria-label={t("demo.banner.title")}
        className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 min-h-9 px-2 py-1 rounded border border-yellow-700 bg-yellow-100 text-yellow-900 text-sm"
      >
        <p className="flex items-center gap-2">
          <FlaskConicalIcon className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{t("demo.banner.title")}</span>
            {" · "}
            {t("demo.banner.fictionalClub")}
            {" · "}
            {t("demo.banner.adminPassword", {
              password: DEMO_ADMIN_PASSWORD_HINT,
            })}
          </span>
        </p>
        <div className="flex gap-1 ml-auto">
          <Button
            type="button"
            variant="outlined"
            className={SMALL_BUTTON}
            onClick={openGuide}
          >
            <ListChecksIcon className="h-3.5 w-3.5" />
            {t("demo.banner.guide")}
          </Button>
          <Button
            type="button"
            variant="outlined"
            className={SMALL_BUTTON}
            onClick={() => setConfirming("reset")}
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
            {t("demo.banner.reset")}
          </Button>
          <Button
            type="button"
            className={SMALL_BUTTON}
            onClick={() => setConfirming("exit")}
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            {t(exitLabelKey)}
          </Button>
        </div>
      </div>

      <DemoConfirmDialog
        isOpen={confirming === "reset"}
        title={t("demo.reset.title")}
        description={t("demo.reset.description")}
        confirmLabel={t("demo.reset.confirm")}
        run={resetDemo}
        onClose={() => setConfirming(null)}
      />
      <DemoConfirmDialog
        isOpen={confirming === "exit"}
        title={t("demo.exit.title")}
        description={t(
          hadRealClub ? "demo.exit.backToClub" : "demo.exit.createClub"
        )}
        confirmLabel={t(exitLabelKey)}
        run={exitDemo}
        onClose={() => setConfirming(null)}
      />
    </>
  );
};
