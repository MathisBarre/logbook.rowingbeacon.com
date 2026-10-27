import { LightbulbIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModuleId } from "../business/modules.rules";
import { useModulesStore } from "../store/modules.store";
import Button from "./Button";

/**
 * Offers a module once, where its need shows up. Either answer hides the
 * suggestion for good; the module stays available in Parameters > Modules.
 */
export const ModuleSuggestion = ({
  id,
  className = "",
}: {
  id: ModuleId;
  className?: string;
}) => {
  const { t } = useTranslation();
  const isVisible = useModulesStore(
    (state) =>
      !state.enabled.includes(id) && !state.dismissedSuggestions.includes(id)
  );
  const enable = useModulesStore((state) => state.enable);
  const dismissSuggestion = useModulesStore((state) => state.dismissSuggestion);

  if (!isVisible) {
    return null;
  }

  return (
    <aside
      className={
        "flex gap-3 items-start bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-blue-950 " +
        className
      }
    >
      <LightbulbIcon className="h-5 w-5 mt-0.5 shrink-0 text-blue-600" />
      <div className="flex-1 flex flex-col gap-2">
        <p className="text-sm">{t(`modules.${id}.suggestion`)}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            className="text-sm py-1"
            onClick={() => enable(id)}
          >
            {t("modules.enable", { name: t(`modules.${id}.name`) })}
          </Button>
          <Button
            type="button"
            variant="outlined"
            className="text-sm py-1"
            onClick={() => dismissSuggestion(id)}
          >
            {t("modules.noThanks")}
          </Button>
        </div>
      </div>
    </aside>
  );
};
