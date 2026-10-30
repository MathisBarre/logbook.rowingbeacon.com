import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SimpleDialog } from "../../_common/components/SimpleDialog";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/AnalyticsStates";

/**
 * The Explorer's confirmations (review 39): a real dialog (focus kept
 * inside, Escape cancels, focus starts on "Annuler") with verbs on the
 * buttons instead of the window's "OK", and an optional third choice
 * ("Enregistrer d'abord").
 */

export type ConfirmOutcome = "confirm" | "extra" | "cancel";

export interface ConfirmOptions {
  /** Dialog heading; "Confirmer" by default. */
  title?: string;
  message: string;
  /** The verb of the action, e.g. "Archiver". */
  confirmLabel: string;
  /** The action destroys something: its button is red. */
  danger?: boolean;
  /** A third choice, shown as the main button (e.g. "Enregistrer d'abord"). */
  extraLabel?: string;
}

interface Pending extends ConfirmOptions {
  resolve: (outcome: ConfirmOutcome) => void;
}

const dangerButtonClass =
  secondaryButtonClass.replace("text-steel-blue-800", "text-error-700") +
  " border-error-200";

export const ConfirmDialog = ({
  pending,
  onDone,
}: {
  pending: ConfirmOptions | null;
  onDone: (outcome: ConfirmOutcome) => void;
}) => {
  const { t } = useTranslation();
  if (!pending) return null;
  const confirmClass = pending.extraLabel
    ? pending.danger
      ? dangerButtonClass
      : secondaryButtonClass
    : pending.danger
      ? primaryButtonClass.replace(
          "bg-steel-blue-700 text-white hover:bg-steel-blue-800",
          "bg-error-700 text-white hover:bg-error-800"
        )
      : primaryButtonClass;
  return (
    <SimpleDialog
      open
      modal
      onOpenChange={(open) => !open && onDone("cancel")}
      title={pending.title ?? t("analytics.common.actions.confirm")}
      className="w-[32rem]"
    >
      <div className="flex flex-col gap-6">
        <p className="text-base text-gray-800 whitespace-pre-line">
          {pending.message}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={secondaryButtonClass}
            // Radix keeps a focus that is already inside the dialog.
            autoFocus
            onClick={() => onDone("cancel")}
          >
            {t("analytics.common.actions.cancel")}
          </button>
          <button
            type="button"
            className={confirmClass}
            onClick={() => onDone("confirm")}
          >
            {pending.confirmLabel}
          </button>
          {pending.extraLabel && (
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => onDone("extra")}
            >
              {pending.extraLabel}
            </button>
          )}
        </div>
      </div>
    </SimpleDialog>
  );
};

/**
 * `confirm(options)` resolves with the button chosen; render `dialog`
 * once in the page.
 */
export const useConfirm = () => {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<ConfirmOutcome>((resolve) => {
        // A second question cancels the first.
        current.current?.resolve("cancel");
        const next = { ...options, resolve };
        current.current = next;
        setPending(next);
      }),
    []
  );

  const onDone = useCallback((outcome: ConfirmOutcome) => {
    const open = current.current;
    current.current = null;
    setPending(null);
    open?.resolve(outcome);
  }, []);

  return {
    confirm,
    dialog: <ConfirmDialog pending={pending} onDone={onDone} />,
  };
};
