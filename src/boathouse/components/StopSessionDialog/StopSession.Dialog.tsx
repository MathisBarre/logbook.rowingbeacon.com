import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import {
  useSessionsStore,
  ZustandSession,
} from "../../../_common/store/sessions.store";
import { StopSessionForm } from "./StopSession.Form";
import { useTranslation } from "react-i18next";
import { OutingEditorForm } from "../../../logbook/components/OutingEditor/OutingEditor.Form";
import { getOngoingOutingDraft } from "../../../logbook/business/EditOuting/outingDraft.rules";

interface StopSessionDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  session: ZustandSession | undefined;
}

export function StopSessionDialog({
  isOpen,
  setIsOpen,
  session: sessionAtOpening,
}: StopSessionDialogProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);

  // The outing can be corrected from this dialog: show its current state.
  const session =
    useSessionsStore((state) =>
      state.session.find((outing) => outing.id === sessionAtOpening?.id)
    ) ?? sessionAtOpening;

  const close = () => {
    setIsEditing(false);
    setIsOpen(false);
  };

  return (
    <SimpleDialog
      modal
      open={isOpen}
      onOpenChange={(v) => v === false && close()}
      title={t(isEditing ? "outingEditor.editTitle" : "session.stop")}
    >
      {isEditing && session ? (
        // Back to the stop form once saved, which then shows the corrected outing.
        <OutingEditorForm
          mode="ongoing"
          initialDraft={getOngoingOutingDraft(session)}
          onSaved={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StopSessionForm
            afterSubmit={close}
            afterCancel={close}
            session={session}
          />
          {session && (
            <button
              type="button"
              className="self-center flex items-center gap-1 text-sm text-gray-500 hover:text-steel-blue-800 hover:underline"
              onClick={() => setIsEditing(true)}
            >
              <PencilIcon className="h-3.5 w-3.5" />
              {t("outingEditor.editOuting")}
            </button>
          )}
        </div>
      )}
    </SimpleDialog>
  );
}
