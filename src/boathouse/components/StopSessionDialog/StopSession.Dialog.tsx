import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { ZustandSession } from "../../../_common/store/sessions.store";
import { StopSessionForm } from "./StopSession.Form";
import { useTranslation } from "react-i18next";

interface StopSessionDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  session: ZustandSession | undefined;
}

export function StopSessionDialog({
  isOpen,
  setIsOpen,
  session,
}: StopSessionDialogProps) {
  const { t } = useTranslation();

  return (
    <SimpleDialog
      modal
      open={isOpen}
      onOpenChange={(v) => v === false && setIsOpen(false)}
      title={t("session.stop")}
    >
      <StopSessionForm
        afterSubmit={() => setIsOpen(false)}
        afterCancel={() => setIsOpen(false)}
        session={session}
      />
    </SimpleDialog>
  );
}
