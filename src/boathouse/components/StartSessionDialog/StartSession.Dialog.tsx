import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import {
  ageCategories,
  seriousnessCategories,
} from "../../../_common/store/boatLevelConfig.business";
import { cn } from "../../../_common/utils/utils";
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
    </SimpleDialog>
  );
}
