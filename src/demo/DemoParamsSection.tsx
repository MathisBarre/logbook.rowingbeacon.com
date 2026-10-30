import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../_common/components/Button";
import { DemoConfirmDialog } from "./DemoConfirmDialog";
import { enterDemo, resetDemo } from "./demoSession";
import { DEMO_ADMIN_PASSWORD_HINT, isDemoMode } from "./demoMode";

/**
 * Gestion > Paramètres divers: try the demo (real club kept aside), or,
 * while in demo, reset it (it replaces "delete all data").
 */
export const DemoParamsSection = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const inDemo = isDemoMode();

  return (
    <section className="flex flex-col h-full">
      <div className="flex-1">
        <h1 className="font-bold text-xl mb-1 text-gray-900">
          {t(inDemo ? "demo.params.inDemoTitle" : "demo.params.title")}
        </h1>
        <p className="text-gray-500 mb-4">
          {t(
            inDemo ? "demo.params.inDemoDescription" : "demo.params.description"
          )}
        </p>
      </div>
      <Button
        type="button"
        variant={inDemo ? "outlined" : "primary"}
        onClick={() => setIsOpen(true)}
        className="w-full mt-4"
      >
        {t(inDemo ? "demo.banner.reset" : "demo.params.action")}
      </Button>

      <DemoConfirmDialog
        isOpen={isOpen}
        title={t(inDemo ? "demo.reset.title" : "demo.params.confirmTitle")}
        description={
          inDemo
            ? t("demo.reset.description")
            : t("demo.params.confirmDescription", {
                password: DEMO_ADMIN_PASSWORD_HINT,
              })
        }
        confirmLabel={t(inDemo ? "demo.reset.confirm" : "demo.params.confirm")}
        run={() => (inDemo ? resetDemo() : enterDemo({ hasRealClub: true }))}
        onClose={() => setIsOpen(false)}
      />
    </section>
  );
};
