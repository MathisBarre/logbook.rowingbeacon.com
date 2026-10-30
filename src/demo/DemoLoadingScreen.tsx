import { useTranslation } from "react-i18next";
import { AnimatedLoadingIcon } from "../_common/components/Loading";

/** Shown while demo.db is filled with a fresh demo club (a few seconds). */
export const DemoLoadingScreen = () => {
  const { t } = useTranslation();

  return (
    <div className="h-screen flex items-center justify-center flex-col gap-3 p-4 text-center">
      <div className="flex font-medium items-center text-lg">
        <AnimatedLoadingIcon />
        <p>{t("demo.loading.title")}</p>
      </div>
      <p className="text-sm text-gray-500 max-w-md">
        {t("demo.loading.description")}
      </p>
    </div>
  );
};
