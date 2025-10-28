import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { StartSessionFormDataWrapper } from "./StartSessionForm.DataWrapper";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  return (
    <SimpleDialog
      modal={true}
      open={isOpen}
      onOpenChange={(v) => v === false && setIsOpen(false)}
      title={t("session.start")}
    >
      <StartSessionFormDataWrapper
        closeAction={() => setIsOpen(false)}
        defaultBoat={defaultBoat}
      />
    </SimpleDialog>
  );
}
