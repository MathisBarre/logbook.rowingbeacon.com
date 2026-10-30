import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, FlaskConicalIcon } from "lucide-react";
import Button from "../_common/components/Button";
import { enterDemo } from "./demoSession";
import { DEMO_ADMIN_PASSWORD_HINT } from "./demoMode";

const POINTS = ["point1", "point2", "point3"] as const;

/**
 * Onboarding card: try the app on a fictitious club before setting up the
 * real one. Nothing is at risk here (no club yet), so there is no
 * confirmation.
 */
export const TryDemoCard = ({ disabled }: { disabled?: boolean }) => {
  const { t } = useTranslation();
  const [isStarting, setIsStarting] = useState(false);

  return (
    <article className="flex flex-col gap-3 items-start bg-steel-blue-50 border border-steel-blue-200 border-l-4 border-l-steel-blue-700 p-4 rounded text-steel-blue-950 my-4">
      <div className="flex gap-2 items-center">
        <FlaskConicalIcon className="h-5 w-5 text-steel-blue-700" />
        <h2 className="text-base font-medium">{t("demo.try.title")}</h2>
      </div>
      <p className="text-sm">{t("demo.try.description")}</p>
      <ul className="text-sm flex flex-col gap-1">
        {POINTS.map((point) => (
          <li key={point} className="flex gap-2 items-start">
            <CheckIcon className="h-4 w-4 mt-0.5 shrink-0 text-success-600" />
            {t(`demo.try.${point}`)}
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-600">
        {t("demo.try.passwordNote", { password: DEMO_ADMIN_PASSWORD_HINT })}
      </p>
      <Button
        type="button"
        loading={isStarting}
        disabled={disabled}
        onClick={() => {
          setIsStarting(true);
          void enterDemo({ hasRealClub: false }).then((started) => {
            if (!started) setIsStarting(false);
          });
        }}
      >
        {t("demo.try.action")}
      </Button>
    </article>
  );
};
