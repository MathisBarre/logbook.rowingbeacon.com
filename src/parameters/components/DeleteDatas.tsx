import { OctagonAlertIcon, SkullIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { useLogout } from "../../_common/utils/logout";
import Button from "../../_common/components/Button";

export const DeleteDatas = () => {
  const { t } = useTranslation();
  const [textareaContent, setTextareaContent] = useState("");
  const adminEditSystem = useAdminEditModeSystem();
  const requiredTextToDelete = t("parameters.deleteConfirmationText");
  const logout = useLogout();
  const [adminPassword, setAdminPassword] = useState("");

  return (
    <div className="text-error-800 flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <OctagonAlertIcon />
        <span className="font-bold text-xl">{t("parameters.warning")}</span>
      </div>
      <p>{t("parameters.deleteAllDataWarning1")}</p>

      <p>{t("parameters.deleteAllDataWarning2")}</p>

      <p>
        {t("parameters.deleteConfirmationInstruction", {
          text: requiredTextToDelete,
        })}
      </p>

      <textarea
        className="input"
        value={textareaContent}
        onChange={(e) => {
          setTextareaContent(e.target.value);
        }}
      />

      <p>{t("parameters.enterAdminPassword")}</p>

      <input
        className="input"
        type="password"
        name="password"
        id="password"
        value={adminPassword}
        onChange={(e) => {
          setAdminPassword(e.target.value);
        }}
      />

      <Button
        type="button"
        variant="primary"
        className="flex gap-2 items-center justify-center"
        color="danger"
        disabled={
          textareaContent !== requiredTextToDelete ||
          !adminEditSystem.isAdminPassword(adminPassword)
        }
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onClick={async () => {
          if (textareaContent !== requiredTextToDelete) {
            return;
          }

          if (!adminEditSystem.isAdminPassword(adminPassword)) {
            return;
          }

          await logout();
        }}
      >
        <SkullIcon />
        {t("parameters.deleteAllData")}
      </Button>
    </div>
  );
};
