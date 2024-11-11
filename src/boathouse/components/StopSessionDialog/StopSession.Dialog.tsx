import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { ZustandSession } from "../../../_common/store/sessions.store";
import { StopSessionForm } from "./StopSession.Form";

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
  return (
    <SimpleDialog
      modal={false}
      open={isOpen}
      onOpenChange={(v) => v === false && setIsOpen(false)}
      title="Terminer une sortie"
    >
      <StopSessionForm
        afterSubmit={() => setIsOpen(false)}
        afterCancel={() => setIsOpen(false)}
        session={session}
      />
    </SimpleDialog>
  );
}
