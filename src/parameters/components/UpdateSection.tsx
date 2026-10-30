import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import Button from "../../_common/components/Button";
import { useUpdateStore } from "../../_common/update/update.store";
import { checkForUpdate } from "../../_common/update/update.tauri";

export const UpdateSection = () => {
  const { t } = useTranslation();
  const { available, phase, setDialogOpen } = useUpdateStore();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion, (error: unknown) => console.error(error));
  }, []);

  const checkNow = async () => {
    try {
      const found = await checkForUpdate({ manual: true });
      if (found) setDialogOpen(true);
      else toast.success(t("update.upToDate"));
    } catch (error) {
      console.error(error);
      toast.error(t("update.checkFailed"));
    }
  };

  return (
    <section className="flex flex-col h-full">
      <div className="flex-1">
        <h1 className="font-bold text-xl mb-1 text-gray-900">
          {t("update.sectionTitle")}
        </h1>
        <p className="text-gray-500 mb-4">{t("update.sectionDescription")}</p>
        {version && (
          <p className="text-gray-900">
            {t("update.currentVersion", { version })}
          </p>
        )}
        {available && (
          <p className="text-green-600 font-medium">
            {t("update.available", { version: available.version })}
          </p>
        )}
      </div>
      {available ? (
        <Button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full mt-4"
        >
          {t("update.see")}
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => void checkNow()}
          loading={phase === "checking"}
          className="w-full mt-4"
        >
          {t("update.checkNow")}
        </Button>
      )}
    </section>
  );
};
