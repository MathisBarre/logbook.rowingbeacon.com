import { OctagonAlertIcon, SkullIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { useLogout } from "../../_common/utils/logout";
import Button from "../../_common/components/Button";
import { aiKeyStatus } from "../../analytics/ai/aiClient";
import { AI_PROVIDERS } from "../../analytics/engine/ipc";

/**
 * Whether an AI key (Anthropic, OpenAI or a compatible server's) is
 * stored on this computer: it outlives the club data (system keychain),
 * so the user chooses whether it goes too.
 */
const useStoredAiKey = () => {
  const [stored, setStored] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    for (const provider of AI_PROVIDERS) {
      aiKeyStatus(provider).then(
        (status) => live && status.stored && setStored(true),
        () => undefined
      );
    }
    return () => {
      live = false;
    };
  }, []);
  return stored;
};

export const DeleteDatas = () => {
  const { t } = useTranslation();
  const [textareaContent, setTextareaContent] = useState("");
  const adminEditSystem = useAdminEditModeSystem();
  const requiredTextToDelete = t("parameters.deleteConfirmationText");
  const logout = useLogout();
  const [adminPassword, setAdminPassword] = useState("");
  const aiKeyStored = useStoredAiKey();
  const [deleteAiKey, setDeleteAiKey] = useState(false);

  return (
    <div className="text-error-800 flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <OctagonAlertIcon />
        <span className="font-bold text-xl">{t("parameters.warning")}</span>
      </div>
      <p>{t("parameters.deleteAllDataWarning1")}</p>

      <p>{t("parameters.deleteAllDataWarning2")}</p>

      {aiKeyStored && (
        <label className="flex items-start gap-3 min-h-11 py-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-5 w-5 mt-0.5 shrink-0"
            checked={deleteAiKey}
            onChange={(e) => {
              setDeleteAiKey(e.target.checked);
            }}
          />
          <span>{t("parameters.deleteAiKeyToo")}</span>
        </label>
      )}

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

          await logout({ deleteAiKey: aiKeyStored && deleteAiKey });
        }}
      >
        <SkullIcon />
        {t("parameters.deleteAllData")}
      </Button>
    </div>
  );
};
