import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { seriousnessCategories } from "../../../_common/store/boatLevelConfig.business";
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
      <p>Ce bateau necéssite d'un niveau minimum</p>
      {seriousnessCategories}
      <p>Ce bateau necéssite un type minimum</p>
      <div className="h-4" />
      <StartSessionFormDataWrapper
        closeAction={() => setIsOpen(false)}
        defaultBoat={defaultBoat}
      />
    </SimpleDialog>
  );
}
