import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SimpleDialog } from "../../_common/components/SimpleDialog";

/**
 * Title and description of a query: "Enregistrer" (first save),
 * "Enregistrer sous…" and "Renommer" (plan 1.3).
 */

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 1000;

export type SaveDialogMode = "save" | "saveAs" | "rename";

interface SaveQueryDialogProps {
  open: boolean;
  mode: SaveDialogMode;
  initialTitle: string;
  initialDescription: string | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves with true when saved (the dialog then closes). */
  onSubmit: (title: string, description: string | null) => Promise<boolean>;
}

export const SaveQueryDialog = ({
  open,
  mode,
  initialTitle,
  initialDescription,
  onOpenChange,
  onSubmit,
}: SaveQueryDialogProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setDescription(initialDescription ?? "");
      setTouched(false);
      setBusy(false);
    }
  }, [open, initialTitle, initialDescription]);

  const trimmed = title.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await onSubmit(
      trimmed.slice(0, TITLE_MAX_LENGTH),
      description.trim()
        ? description.trim().slice(0, DESCRIPTION_MAX_LENGTH)
        : null
    );
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  const heading =
    mode === "rename"
      ? t("analytics.explorer.saved.rename")
      : mode === "saveAs"
        ? t("analytics.explorer.saveAs")
        : t("analytics.explorer.saveDialog.title");

  return (
    <SimpleDialog
      open={open}
      onOpenChange={onOpenChange}
      title={heading}
      modal
      className="w-[36rem]"
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
          {t("analytics.explorer.saveDialog.name")}
          <input
            className="min-h-11 rounded border border-gray-300 px-3 text-base font-normal"
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            autoFocus
            // "Enregistrer sous…" proposes "… (copie)": typing replaces it.
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={touched && !trimmed}
          />
          {touched && !trimmed && (
            <span className="text-xs font-normal text-error-700" role="alert">
              {t("analytics.explorer.saveDialog.titleRequired")}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
          {t("analytics.explorer.saveDialog.description")}
          <textarea
            className="min-h-24 rounded border border-gray-300 px-3 py-2 text-base font-normal"
            value={description}
            maxLength={DESCRIPTION_MAX_LENGTH}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="min-h-11 rounded border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50"
            onClick={() => onOpenChange(false)}
          >
            {t("analytics.common.actions.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded bg-steel-blue-700 px-4 text-sm font-medium text-white hover:bg-steel-blue-800 disabled:opacity-60"
          >
            {t("analytics.common.actions.save")}
          </button>
        </div>
      </form>
    </SimpleDialog>
  );
};
