import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../_common/components/Button";
import { SimpleAlertDialog } from "../_common/components/SimpleAlertDialog";

/**
 * Confirmation before a switch that restarts the app. `run` resolves with
 * false when the switch did not happen (the error is already shown); on
 * success the webview reloads, so the button just stays busy.
 */
export const DemoConfirmDialog = ({
  isOpen,
  title,
  description,
  confirmLabel,
  run,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<boolean>;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);

  const confirm = async () => {
    setIsBusy(true);
    if (!(await run())) setIsBusy(false);
  };

  return (
    <SimpleAlertDialog
      title={title}
      description={description}
      isOpen={isOpen}
      cancelElement={
        <Button
          type="button"
          variant="outlined"
          disabled={isBusy}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
      }
      confirmElement={
        <Button type="button" loading={isBusy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      }
    />
  );
};
