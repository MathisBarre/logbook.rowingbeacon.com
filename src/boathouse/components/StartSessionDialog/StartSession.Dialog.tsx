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
      modal={true}
      open={isOpen}
      onOpenChange={(v) => v === false && setIsOpen(false)}
      title="Commencer une sortie"
    >
      <StartSessionFormDataWrapper
        closeAction={() => setIsOpen(false)}
        defaultBoat={defaultBoat}
      />

      <HelpDiv />
    </SimpleDialog>
  );
}

const HelpDiv = () => {
  return (
    <div className="absolute top-0 w-6 h-6 bg-error-700 w-96 left-[-12rem]">
      super
    </div>
  );
};
