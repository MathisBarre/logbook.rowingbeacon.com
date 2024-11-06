import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { StartSessionFormDataWrapper } from "./StartSessionForm.DataWrapper";

interface StartSessionDialogProps {
  isOpen: boolean;
  setIsOpen: (
    isOpen:
      | {
          id: string;
          name: string;
        }
      | false
  ) => void;
  defaultBoat: {
    id: string;
    name: string;
  };
}

export function StartSessionDialog({
  isOpen,
  setIsOpen,
  defaultBoat,
}: StartSessionDialogProps) {
  return (
    <SimpleDialog
      modal={false}
      open={isOpen}
      onOpenChange={(v) => v === false && setIsOpen(false)}
      title="Commencer une sortie"
      subtitle="Entrez les informations de la sortie"
    >
      <StartSessionFormDataWrapper
        closeAction={() => setIsOpen(false)}
        defaultBoat={defaultBoat}
      />
    </SimpleDialog>
  );
}
