import { useTranslation } from "react-i18next";
import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import type {
  OutingDraft,
  OutingEditorMode,
} from "../../business/EditOuting/outingDraft";
import { OutingEditorForm } from "./OutingEditor.Form";

export const getOutingEditorTitle = (
  mode: OutingEditorMode,
  t: (key: string) => string
) => t(mode === "past" ? "outingEditor.pastTitle" : "outingEditor.editTitle");

interface OutingEditorDialogProps {
  mode: OutingEditorMode;
  /** The dialog is open while a draft is given. */
  initialDraft: OutingDraft | null;
  onClose: () => void;
  onSaved?: () => void;
}

export const OutingEditorDialog = ({
  mode,
  initialDraft,
  onClose,
  onSaved,
}: OutingEditorDialogProps) => {
  const { t } = useTranslation();

  return (
    <SimpleDialog
      modal
      open={initialDraft !== null}
      onOpenChange={(open) => !open && onClose()}
      title={getOutingEditorTitle(mode, t)}
    >
      {initialDraft && (
        <OutingEditorForm
          mode={mode}
          initialDraft={initialDraft}
          onSaved={(stillOpen) => {
            onSaved?.();
            // Closed while saving, then maybe reopened for another outing.
            if (stillOpen) onClose();
          }}
          onCancel={onClose}
        />
      )}
    </SimpleDialog>
  );
};
