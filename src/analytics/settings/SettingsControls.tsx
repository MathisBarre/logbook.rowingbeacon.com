import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { copyText } from "../ai/clipboard";

/**
 * Small controls of the Gestion › Statistiques et IA tab: touch-sized
 * (44 px), no hover-only information (plan 1.7), one focus ring.
 */

/** The steel-blue focus ring of every control of the tab. */
export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-2";

/** Text fields and selects: steel-blue focus, red when invalid. */
export const fieldClass = (invalid = false) =>
  "min-h-11 rounded border bg-white text-base text-gray-900 focus:border-steel-blue-500 focus:ring-steel-blue-500 " +
  (invalid ? "border-error-600" : "border-gray-300");

export const buttonClass = (
  variant: "primary" | "outlined" | "danger" | "dangerLink"
) =>
  "min-h-11 rounded text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed " +
  focusRing +
  " " +
  (variant === "primary"
    ? "px-4 bg-steel-blue-700 text-white border border-steel-blue-700 enabled:hover:bg-steel-blue-800"
    : variant === "danger"
      ? "px-4 border border-error-600 text-error-700 bg-white enabled:hover:bg-error-50"
      : variant === "dangerLink"
        ? "px-2 text-error-700 underline enabled:hover:text-error-800"
        : "px-4 border border-steel-blue-200 bg-steel-blue-50 text-steel-blue-800 enabled:hover:bg-steel-blue-100");

export const SettingsCard = ({
  title,
  description,
  children,
  id,
}: {
  title: string;
  /** One line under the title: what the card is for. */
  description?: ReactNode;
  children: ReactNode;
  id?: string;
}) => (
  <section
    id={id}
    aria-labelledby={id ? `${id}-title` : undefined}
    className="border rounded-lg p-4 flex flex-col gap-4 bg-white scroll-mt-4"
  >
    <div className="flex flex-col gap-1">
      <h2
        id={id ? `${id}-title` : undefined}
        // Focused when another screen sends the user here.
        tabIndex={-1}
        className="font-bold text-lg text-gray-900 focus:outline-none"
      >
        {title}
      </h2>
      {description && <p className="text-sm text-gray-600">{description}</p>}
    </div>
    {children}
  </section>
);

/**
 * An on/off switch with its label; the whole row is the hit target. The
 * state ("Activé") is shown but not part of the name: role="switch"
 * already says it.
 */
export const Switch = ({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) => {
  const { t } = useTranslation();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  return (
    <div className="flex flex-col gap-1">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={
          "min-h-11 flex items-center gap-3 text-left rounded disabled:opacity-50 " +
          focusRing
        }
      >
        <span
          aria-hidden="true"
          className={
            "relative inline-flex h-7 w-12 flex-none rounded-full border-2 transition-colors " +
            (checked
              ? "bg-steel-blue-700 border-steel-blue-700"
              : "bg-gray-200 border-gray-300")
          }
        >
          <span
            className={
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " +
              (checked ? "left-5" : "left-0.5")
            }
          />
        </span>
        <span className="flex flex-col">
          <span id={labelId} className="font-medium text-gray-900">
            {label}
          </span>
          <span aria-hidden="true" className="text-xs text-gray-500">
            {checked ? t("analytics.settings.on") : t("analytics.settings.off")}
          </span>
        </span>
      </button>
      {description && (
        <div id={descriptionId} className="text-sm text-gray-600 pl-[3.75rem]">
          {description}
        </div>
      )}
    </div>
  );
};

export const Notice = ({
  tone,
  children,
  announce = true,
}: {
  tone: "info" | "success" | "warning" | "error";
  children: ReactNode;
  /**
   * False inside an always-present aria-live region (which announces it):
   * a live region mounted with its text is often missed.
   */
  announce?: boolean;
}) => {
  const classes = {
    info: "bg-steel-blue-50 border-steel-blue-200 text-steel-blue-900",
    success: "bg-success-50 border-success-200 text-success-900",
    warning: "bg-yellow-50 border-yellow-300 text-yellow-900",
    error: "bg-error-50 border-error-200 text-error-900",
  }[tone];
  const Icon =
    tone === "warning" || tone === "error"
      ? ExclamationTriangleIcon
      : tone === "success"
        ? CheckIcon
        : InformationCircleIcon;
  return (
    <div
      role={announce ? (tone === "error" ? "alert" : "status") : undefined}
      className={`flex gap-2 items-start rounded border p-3 text-sm ${classes}`}
    >
      <Icon className="h-5 w-5 flex-none" aria-hidden="true" />
      <div className="flex-1">{children}</div>
    </div>
  );
};

/** The error of one field, under it (`id` goes in its aria-describedby). */
export const FieldError = ({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) => (
  <p id={id} className="flex gap-1 items-start text-sm text-error-700">
    <ExclamationTriangleIcon className="h-5 w-5 flex-none" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

/** A folded section with a visible chevron (one style for the whole tab). */
export const Disclosure = ({
  summary,
  defaultOpen = false,
  children,
  tone = "white",
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** "plain": no box (technical details under an error). */
  tone?: "white" | "plain";
}) => {
  // Only the first render decides: a later change (picking "Auto" inside
  // it) must not fold the section under the user's finger.
  const [initiallyOpen] = useState(defaultOpen);
  return (
    <details
      open={initiallyOpen || undefined}
      className={
        "group text-sm " +
        (tone === "white" ? "rounded border border-gray-200 bg-white" : "")
      }
    >
      <summary
        className={
          "min-h-11 flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden font-medium text-steel-blue-800 rounded " +
          (tone === "white" ? "px-3 " : "") +
          focusRing
        }
      >
        <ChevronRightIcon
          className="h-4 w-4 flex-none transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <div
        className={
          "flex flex-col gap-3 " + (tone === "white" ? "px-3 pb-3" : "pb-2")
        }
      >
        {children}
      </div>
    </details>
  );
};

/** One option of a radio group, as a bordered card. */
export const RadioCard = ({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** A pill after the title ("conseillé", "Clé enregistrée"). */
  badge?: ReactNode;
}) => {
  const descriptionId = useId();
  return (
    <label
      className={
        "min-h-11 flex items-start gap-3 rounded border px-3 py-2 cursor-pointer " +
        (checked
          ? "border-steel-blue-700 bg-steel-blue-50"
          : "border-gray-200 bg-white hover:bg-gray-50")
      }
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-0.5 h-5 w-5 flex-none text-steel-blue-700 focus:ring-steel-blue-500"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-gray-900">
          {title}
          {badge}
        </span>
        {description && (
          <span id={descriptionId} className="text-sm text-gray-600">
            {description}
          </span>
        )}
      </span>
    </label>
  );
};

/** The small pill of a RadioCard. */
export const Pill = ({
  tone,
  children,
}: {
  tone: "success" | "info";
  children: ReactNode;
}) => (
  <span
    className={
      "ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium align-middle " +
      (tone === "success"
        ? "bg-success-50 text-success-800"
        : "bg-steel-blue-100 text-steel-blue-800")
    }
  >
    {children}
  </span>
);

/** A block of text to copy (configuration, command), selectable too. */
export const CopyBlock = ({
  text,
  label,
}: {
  text: string;
  /** What is copied ("Claude Desktop"), for the group and its button. */
  label: string;
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const copy = async () => {
    const ok = await copyText(text);
    setCopied(ok ? "copied" : "failed");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2500);
  };
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <pre
        tabIndex={0}
        className={
          "max-w-full overflow-x-auto rounded bg-gray-900 text-gray-50 p-3 text-xs font-mono whitespace-pre select-all " +
          focusRing
        }
      >
        {text}
      </pre>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className={buttonClass("outlined")}
          aria-label={t("analytics.settings.mcp.copyLabel", { name: label })}
          onClick={() => void copy()}
        >
          {copied === "copied" ? (
            <CheckIcon className="h-5 w-5" aria-hidden="true" />
          ) : (
            <ClipboardDocumentIcon className="h-5 w-5" aria-hidden="true" />
          )}
          {copied === "copied"
            ? t("analytics.settings.mcp.copied")
            : t("analytics.settings.mcp.copy")}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied === "copied" ? t("analytics.settings.mcp.copied") : ""}
        </span>
        {copied === "failed" && (
          <span role="alert" className="text-sm text-error-700">
            {t("analytics.settings.mcp.copyFailed")}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * The raw (English) message of a failure, folded away: the sentence above
 * it says what to do, the details help whoever looks into it.
 */
export const TechnicalDetails = ({ message }: { message: string }) => {
  const { t } = useTranslation();
  if (!message.trim()) return null;
  return (
    <Disclosure tone="plain" summary={t("analytics.settings.technicalDetails")}>
      <code className="block whitespace-pre-wrap break-words font-mono text-xs text-gray-600">
        {message}
      </code>
    </Disclosure>
  );
};
