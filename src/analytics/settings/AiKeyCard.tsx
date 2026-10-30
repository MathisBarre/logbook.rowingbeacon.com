import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../_common/components/Alert";
import {
  AI_PROVIDERS,
  AiModel,
  AiProvider,
  KeyStatus,
  OpenAiModel,
} from "../engine/ipc";
import {
  aiDeleteKey,
  aiKeyStatus,
  aiSetKey,
  aiTestKey,
  formatAiError,
  validateBaseUrl,
} from "../ai/aiClient";
import { formatCostUsd, typicalQuestionCostUsd } from "../ai/cost";
import {
  KEY_CONSOLE_URLS,
  MODEL_LABEL_KEYS,
  modelName,
  modelsOf,
  providerName,
} from "../ai/models";
import { openExternal } from "../ai/openExternal";
import {
  aiTargetOf,
  COMPATIBLE_MODEL_MAX_LENGTH,
  useAnalyticsSettingsStore,
} from "../store/analyticsSettings.store";
import {
  AiKeyApi,
  AiKeyMessage,
  createAiKeyController,
} from "./aiKeyController";
import {
  Disclosure,
  FieldError,
  Notice,
  Pill,
  RadioCard,
  SettingsCard,
  Switch,
  TechnicalDetails,
  buttonClass,
  fieldClass,
  focusRing,
} from "./SettingsControls";

const tauriKeyApi: AiKeyApi = {
  status: aiKeyStatus,
  set: aiSetKey,
  remove: aiDeleteKey,
  test: aiTestKey,
};

const COMPATIBLE: AiProvider = "openai_compatible";

type BaseUrlReason = Extract<
  ReturnType<typeof validateBaseUrl>,
  { ok: false }
>["reason"];

/** The model chosen for a provider (each provider keeps its own). */
const useModelOf = (provider: AiProvider) =>
  useAnalyticsSettingsStore(
    (s) => aiTargetOf({ ...s, aiProvider: provider }).model
  );

/**
 * One line: whether a key is stored on this computer, which one (its last
 * 4 characters) and where, never in the club database.
 */
const statusText = (
  provider: AiProvider,
  status: KeyStatus | null,
  t: TFunction
) => {
  const hint = status?.hint ?? null;
  if (provider === COMPATIBLE) {
    if (!status?.stored) return t("analytics.settings.ai.status.noServer");
    const url = status.baseUrl ?? "";
    if (status.hasKey === false)
      return t("analytics.settings.ai.status.serverWithoutKey", { url });
    return hint
      ? t("analytics.settings.ai.status.serverWithKeyHint", { url, hint })
      : t("analytics.settings.ai.status.serverWithKey", { url });
  }
  if (!status?.stored) return t("analytics.settings.ai.status.none");
  const where = status.storage === "file" ? "file" : "keychain";
  return hint
    ? t(`analytics.settings.ai.status.${where}Hint`, { hint })
    : t(`analytics.settings.ai.status.${where}`);
};

/** The outcome of save, check or delete (field errors go under the fields). */
const MessageNotice = ({
  message,
  provider,
  who,
}: {
  message: AiKeyMessage;
  provider: AiProvider;
  who: string | null;
}) => {
  const { t } = useTranslation();
  const server = provider === COMPATIBLE;
  switch (message.kind) {
    case "saved":
      return (
        <Notice tone="success" announce={false}>
          {t(
            server
              ? "analytics.settings.ai.savedServer"
              : "analytics.settings.ai.saved"
          )}
        </Notice>
      );
    case "deleted":
      return (
        <Notice tone="info" announce={false}>
          {t(
            server
              ? "analytics.settings.ai.deletedServer"
              : "analytics.settings.ai.deleted"
          )}
        </Notice>
      );
    case "testOk":
      return (
        <Notice tone="success" announce={false}>
          {t(
            server
              ? "analytics.settings.ai.testOkServer"
              : "analytics.settings.ai.testOk",
            { model: modelName(message.model) }
          )}
        </Notice>
      );
    case "savedChecked":
      return (
        <Notice tone="success" announce={false}>
          {t(
            server
              ? "analytics.settings.ai.savedCheckedServer"
              : "analytics.settings.ai.savedChecked",
            { model: modelName(message.model) }
          )}
        </Notice>
      );
    case "savedCheckFailed":
      return (
        <Notice tone="error" announce={false}>
          {t(
            server
              ? "analytics.settings.ai.savedCheckFailedServer"
              : "analytics.settings.ai.savedCheckFailed",
            { error: formatAiError(message.error, t, undefined, who) }
          )}
        </Notice>
      );
    case "error":
      return (
        <Notice tone="error" announce={false}>
          {formatAiError(message.error, t, undefined, who)}
        </Notice>
      );
    case "invalidFormat":
    case "invalidUrl":
      return null;
  }
};

/**
 * Where the requests go, in plain words: the provider's own API, or the
 * compatible server (on this computer or not).
 */
const whereKey = (provider: AiProvider, baseUrl: string | null) => {
  if (provider !== COMPATIBLE)
    return `analytics.settings.ai.privacy.where.${provider}`;
  if (!baseUrl) return "analytics.settings.ai.privacy.where.serverUnknown";
  const checked = validateBaseUrl(baseUrl);
  return checked.ok && checked.local
    ? "analytics.settings.ai.privacy.where.serverLocal"
    : "analytics.settings.ai.privacy.where.serverRemote";
};

/** What goes to the provider, point by point (plain words, plan 2.4). */
export const PrivacyDetails = ({
  shareAssets,
  provider = "anthropic",
  baseUrl = null,
}: {
  shareAssets: boolean;
  provider?: AiProvider;
  /** The compatible server's address, when one is saved. */
  baseUrl?: string | null;
}) => {
  const { t } = useTranslation();
  const who =
    providerName(provider, baseUrl) ?? t("analytics.ai.providers.server");
  const host = providerName(COMPATIBLE, baseUrl) ?? "";
  const sent = [
    "question",
    "schema",
    "context",
    ...(shareAssets ? ["assets"] : []),
    "errors",
  ];
  return (
    <Disclosure summary={t("analytics.settings.ai.privacy.details")}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="font-medium text-gray-900 mb-1">
            {t("analytics.settings.ai.privacy.sentTitle", { provider: who })}
          </h4>
          <ul className="list-disc pl-5 text-gray-700 flex flex-col gap-1">
            {sent.map((key) => (
              <li key={key}>
                {t(`analytics.settings.ai.privacy.sent.${key}`)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-medium text-gray-900 mb-1">
            {t("analytics.settings.ai.privacy.neverTitle")}
          </h4>
          <ul className="list-disc pl-5 text-gray-700 flex flex-col gap-1">
            {["people", "outings", "password"].map((key) => (
              <li key={key}>
                {t(`analytics.settings.ai.privacy.never.${key}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="md:col-span-2 text-gray-700">
          {t(whereKey(provider, baseUrl), { host })}
        </p>
        <p className="md:col-span-2 text-gray-600">
          {t("analytics.settings.ai.privacy.copyPaste")}
        </p>
      </div>
    </Disclosure>
  );
};

/**
 * The three providers, as radio cards; a pill marks those with a key on
 * this computer (each keeps its own key).
 */
const ProviderChoice = ({
  provider,
  statuses,
  onChange,
}: {
  provider: AiProvider;
  statuses: Partial<Record<AiProvider, KeyStatus>>;
  onChange: (provider: AiProvider) => void;
}) => {
  const { t } = useTranslation();
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby="analytics-ai-provider-help"
    >
      <legend className="font-medium text-gray-900">
        {t("analytics.settings.ai.provider.label")}
      </legend>
      <p id="analytics-ai-provider-help" className="text-sm text-gray-600">
        {t("analytics.settings.ai.provider.help")}
      </p>
      {AI_PROVIDERS.map((id) => (
        <RadioCard
          key={id}
          name="analytics-ai-provider"
          value={id}
          checked={provider === id}
          onChange={() => onChange(id)}
          title={t(`analytics.settings.ai.provider.${id}`)}
          description={t(`analytics.settings.ai.provider.${id}Help`)}
          badge={
            statuses[id]?.stored ? (
              <Pill tone="success">
                {t(
                  id === COMPATIBLE
                    ? "analytics.settings.ai.provider.configuredServer"
                    : "analytics.settings.ai.provider.configured"
                )}
              </Pill>
            ) : null
          }
        />
      ))}
    </fieldset>
  );
};

/** The model list of Anthropic or OpenAI, each with its estimated cost. */
const ModelSelect = ({ provider }: { provider: AiProvider }) => {
  const { t, i18n } = useTranslation();
  const model = useModelOf(provider);
  const setAiModel = useAnalyticsSettingsStore((s) => s.setAiModel);
  const setAiOpenAiModel = useAnalyticsSettingsStore((s) => s.setAiOpenAiModel);
  const cost = typicalQuestionCostUsd(provider, model);
  const optionLabel = (id: string) => {
    const label = t(MODEL_LABEL_KEYS[id as AiModel | OpenAiModel]);
    const each = typicalQuestionCostUsd(provider, id);
    return each === null
      ? label
      : `${label} · ≈ ${formatCostUsd(each, i18n.language)}`;
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="analytics-ai-model" className="font-medium text-gray-900">
        {t("analytics.settings.ai.model")}
      </label>
      <select
        id="analytics-ai-model"
        aria-describedby={cost !== null ? "analytics-ai-model-cost" : undefined}
        className={fieldClass() + " max-w-xl pl-3 pr-10"}
        value={model}
        onChange={(event) =>
          provider === "anthropic"
            ? setAiModel(event.target.value as AiModel)
            : setAiOpenAiModel(event.target.value as OpenAiModel)
        }
      >
        {modelsOf(provider).map((id) => (
          <option key={id} value={id}>
            {optionLabel(id)}
          </option>
        ))}
      </select>
      {cost !== null && (
        <span id="analytics-ai-model-cost" className="text-sm text-gray-600">
          {t("analytics.settings.ai.costPerQuestion", {
            cost: formatCostUsd(cost, i18n.language),
            provider: providerName(provider),
          })}
        </span>
      )}
    </div>
  );
};

/** "console.anthropic.com ↗" inside the key's help sentence. */
const ConsoleLink = ({
  url,
  children,
}: {
  url: string;
  children?: ReactNode;
}) => (
  <button
    type="button"
    className={
      "inline-flex items-center gap-1 font-medium text-steel-blue-700 underline rounded " +
      focusRing
    }
    onClick={() => void openExternal(url)}
  >
    {children}
    <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
  </button>
);

/**
 * The key (and, for a compatible server, its address and model) of one
 * provider on this computer, in the order a newcomer fills them: status,
 * address, key, model, then one "Enregistrer et vérifier". The field
 * never shows a stored key: the Rust side only returns whether one is
 * stored, where, its last 4 characters and the server's address.
 */
const ProviderKeyForm = ({
  api,
  provider,
  onStatusChange,
}: {
  api: AiKeyApi;
  provider: AiProvider;
  onStatusChange?: (provider: AiProvider, status: KeyStatus) => void;
}) => {
  const { t } = useTranslation();
  const controller = useMemo(
    () => createAiKeyController(api, provider),
    [api, provider]
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  );
  const [draft, setDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [urlBlurError, setUrlBlurError] = useState<BaseUrlReason | null>(null);
  const [keyRequired, setKeyRequired] = useState(false);
  const [modelRequired, setModelRequired] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);

  const compatible = provider === COMPATIBLE;
  const model = useModelOf(provider);
  const setAiCompatibleModel = useAnalyticsSettingsStore(
    (s) => s.setAiCompatibleModel
  );
  // The compatible server's model, typed freely, saved when the field
  // loses focus (or on Enter, or with the button), trimmed then.
  const [modelDraft, setModelDraft] = useState(model);
  useEffect(() => setModelDraft(model), [model]);
  const commitModel = () => {
    if (modelDraft !== model) setAiCompatibleModel(modelDraft);
    const saved = useAnalyticsSettingsStore.getState().aiCompatibleModel;
    setModelDraft(saved);
    if (saved.trim() !== "") setModelRequired(false);
    return saved;
  };

  useEffect(() => {
    void controller.load();
  }, [controller]);
  useEffect(() => {
    if (state.status) onStatusChange?.(provider, state.status);
  }, [state.status, provider, onStatusChange]);

  const stored = state.status?.stored === true;
  const savedUrl = state.status?.baseUrl ?? null;
  const url = urlDraft ?? savedUrl ?? "";
  const checkedUrl = validateBaseUrl(url);
  const urlChanged = compatible && stored && url.trim() !== (savedUrl ?? "");
  const busy = state.busy !== null && state.busy !== "loading";
  const desktopOnly = state.statusError?.code === "desktop_only";
  const who = providerName(provider, savedUrl);
  const consoleUrl = KEY_CONSOLE_URLS[provider];
  const typed = compatible
    ? draft.trim() !== "" || urlChanged
    : draft.trim() !== "";
  // Stored and nothing new typed: only "Vérifier"; otherwise only the
  // primary action. No dead (disabled) buttons.
  const showCheck = stored && !typed;

  const message = state.message;
  const urlReason =
    urlBlurError ?? (message?.kind === "invalidUrl" ? message.reason : null);
  const keyError = keyRequired
    ? t("analytics.settings.ai.keyRequired")
    : message?.kind === "invalidFormat"
      ? t(
          message.reason === "anthropicKey"
            ? "analytics.settings.ai.invalidFormat.anthropicKey"
            : `analytics.settings.ai.invalidFormat.${provider}`
        )
      : null;

  const onUrlBlur = () => {
    if (url.trim() === "") return setUrlBlurError(null);
    const checked = validateBaseUrl(url);
    setUrlBlurError(checked.ok ? null : checked.reason);
  };

  const submit = async () => {
    let target = model;
    if (compatible) {
      target = commitModel();
      if (target.trim() === "") {
        setModelRequired(true);
        modelRef.current?.focus();
        return;
      }
    } else if (draft.trim() === "") {
      setKeyRequired(true);
      keyRef.current?.focus();
      return;
    }
    const ok = await controller.saveAndTest(
      draft,
      compatible ? url : undefined,
      target
    );
    if (ok) {
      setDraft("");
      setUrlDraft(null);
    }
    // The submit button is gone or disabled: keep the focus in the form.
    if (controller.getState().message?.kind === "invalidUrl") {
      urlRef.current?.focus();
    } else {
      keyRef.current?.focus();
    }
  };

  const check = () => {
    let target = model;
    if (compatible) {
      target = commitModel();
      if (target.trim() === "") {
        setModelRequired(true);
        modelRef.current?.focus();
        return;
      }
    }
    void controller.test(target);
  };

  const primaryLabel =
    state.busy === "save"
      ? t("analytics.settings.ai.saving")
      : state.busy === "test"
        ? t("analytics.settings.ai.testing")
        : t("analytics.settings.ai.save");

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p className="flex items-start gap-2 text-sm py-2 min-w-0 flex-1">
            {stored ? (
              <CheckCircleIcon
                className="h-5 w-5 flex-none text-success-700"
                aria-hidden="true"
              />
            ) : (
              <KeyIcon
                className="h-5 w-5 flex-none text-gray-500"
                aria-hidden="true"
              />
            )}
            <span
              aria-live="polite"
              className={
                (stored ? "text-success-800" : "text-gray-700") + " break-words"
              }
            >
              {state.busy === "loading"
                ? t("analytics.settings.ai.status.loading")
                : state.statusError
                  ? desktopOnly
                    ? t("analytics.common.states.desktopOnly")
                    : t("analytics.settings.ai.status.error")
                  : statusText(provider, state.status, t)}
            </span>
          </p>
          {stored && !desktopOnly && (
            <button
              type="button"
              className={buttonClass("dangerLink")}
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t(
                compatible
                  ? "analytics.settings.ai.deleteServer"
                  : "analytics.settings.ai.delete"
              )}
            </button>
          )}
        </div>
        {state.busy !== "loading" && state.statusError && !desktopOnly && (
          <div className="flex flex-col gap-1 items-start">
            <button
              type="button"
              className={buttonClass("outlined")}
              onClick={() => void controller.load()}
            >
              {t("analytics.settings.retry")}
            </button>
            <TechnicalDetails message={state.statusError.message} />
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {compatible && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="analytics-ai-base-url"
              className="font-medium text-gray-900"
            >
              {t("analytics.settings.ai.baseUrl.label")}
            </label>
            <input
              ref={urlRef}
              id="analytics-ai-base-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              aria-invalid={urlReason !== null || undefined}
              aria-describedby={
                (urlReason ? "analytics-ai-base-url-error " : "") +
                "analytics-ai-base-url-help"
              }
              className={
                fieldClass(urlReason !== null) +
                " w-full max-w-xl px-3 font-mono placeholder:font-sans"
              }
              placeholder={t("analytics.settings.ai.baseUrl.placeholder")}
              value={url}
              disabled={desktopOnly}
              onChange={(event) => {
                setUrlDraft(event.target.value);
                setUrlBlurError(null);
                controller.clearMessage();
              }}
              onBlur={onUrlBlur}
            />
            {urlReason && (
              <FieldError id="analytics-ai-base-url-error">
                {t(`analytics.settings.ai.baseUrl.invalid.${urlReason}`)}
              </FieldError>
            )}
            <span
              id="analytics-ai-base-url-help"
              className="text-sm text-gray-600"
            >
              {t("analytics.settings.ai.baseUrl.help")}
            </span>
            {checkedUrl.ok && checkedUrl.local && (
              <Notice tone="info">
                {t("analytics.settings.ai.baseUrl.local")}
              </Notice>
            )}
            {checkedUrl.ok && !checkedUrl.local && (
              <Notice tone="warning">
                {t("analytics.settings.ai.baseUrl.remote", {
                  host: providerName(COMPATIBLE, checkedUrl.url) ?? "",
                })}
              </Notice>
            )}
            {urlChanged && (
              <p className="text-sm text-gray-700">
                {t("analytics.settings.ai.baseUrl.changed")}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="analytics-ai-key"
            className="font-medium text-gray-900"
          >
            {t(`analytics.settings.ai.key.${provider}`)}
          </label>
          {consoleUrl && (
            <p
              id="analytics-ai-key-help"
              className="text-sm text-gray-600 -mt-0.5"
            >
              <Trans
                i18nKey={`analytics.settings.ai.createKey.${provider}`}
                components={{ site: <ConsoleLink url={consoleUrl} /> }}
              />
            </p>
          )}
          <input
            ref={keyRef}
            id="analytics-ai-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={keyError !== null || undefined}
            aria-describedby={
              [
                keyError ? "analytics-ai-key-error" : null,
                consoleUrl ? "analytics-ai-key-help" : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className={
              fieldClass(keyError !== null) +
              " w-full max-w-xl px-3 font-mono placeholder:font-sans"
            }
            placeholder={
              stored && !compatible
                ? t("analytics.settings.ai.replacePlaceholder")
                : t(`analytics.settings.ai.keyPlaceholder.${provider}`)
            }
            value={draft}
            disabled={desktopOnly}
            onChange={(event) => {
              setDraft(event.target.value);
              setKeyRequired(false);
              controller.clearMessage();
            }}
          />
          {keyError && (
            <FieldError id="analytics-ai-key-error">{keyError}</FieldError>
          )}
          {!stored && state.busy !== "loading" && (
            <p className="text-sm text-gray-600">
              {t("analytics.settings.ai.noKeyHint")}
            </p>
          )}
        </div>

        {compatible ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="analytics-ai-compatible-model"
              className="font-medium text-gray-900"
            >
              {t("analytics.settings.ai.compatibleModel.label")}
            </label>
            <input
              ref={modelRef}
              id="analytics-ai-compatible-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              maxLength={COMPATIBLE_MODEL_MAX_LENGTH}
              aria-invalid={modelRequired || undefined}
              aria-describedby={
                (modelRequired ? "analytics-ai-compatible-model-error " : "") +
                "analytics-ai-compatible-model-help"
              }
              className={
                fieldClass(modelRequired) +
                " w-full max-w-xl px-3 font-mono placeholder:font-sans"
              }
              placeholder={t(
                "analytics.settings.ai.compatibleModel.placeholder"
              )}
              value={modelDraft}
              onChange={(event) => {
                setModelDraft(event.target.value);
                setModelRequired(false);
              }}
              onBlur={() => void commitModel()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitModel();
                }
              }}
            />
            {modelRequired && (
              <FieldError id="analytics-ai-compatible-model-error">
                {t("analytics.settings.ai.compatibleModel.required")}
              </FieldError>
            )}
            <span
              id="analytics-ai-compatible-model-help"
              className="text-sm text-gray-600"
            >
              {t("analytics.settings.ai.compatibleModel.help")}{" "}
              {t("analytics.settings.ai.billedServer")}
            </span>
          </div>
        ) : (
          <ModelSelect provider={provider} />
        )}

        <div className="flex flex-wrap gap-2">
          {showCheck ? (
            <button
              type="button"
              className={buttonClass("outlined")}
              disabled={busy || desktopOnly}
              onClick={check}
            >
              {state.busy === "test"
                ? t("analytics.settings.ai.testing")
                : t("analytics.settings.ai.test")}
            </button>
          ) : (
            <button
              type="submit"
              className={buttonClass("primary")}
              disabled={busy || desktopOnly}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </form>
      {/* Always present, so that screen readers announce each outcome. */}
      <div aria-live="polite" className="empty:hidden">
        {message && (
          <MessageNotice message={message} provider={provider} who={who} />
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {compatible
                ? t("analytics.settings.ai.deleteTitleServer")
                : t("analytics.settings.ai.deleteTitle", {
                    provider: who ?? "",
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                compatible
                  ? "analytics.settings.ai.deleteConfirmServer"
                  : "analytics.settings.ai.deleteConfirm",
                { provider: who ?? "" }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogPrimitive.Cancel asChild>
              <button type="button" className={buttonClass("outlined")}>
                {t("analytics.common.actions.cancel")}
              </button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <button
                type="button"
                className={buttonClass("danger")}
                onClick={() => {
                  void controller.remove().then(() => keyRef.current?.focus());
                }}
              >
                {t(
                  compatible
                    ? "analytics.settings.ai.deleteServer"
                    : "analytics.settings.ai.delete"
                )}
              </button>
            </AlertDialogPrimitive.Action>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

/**
 * Card 3: the built-in assistant's provider, its key on this computer,
 * the model and what is sent (plan 1.3; ADR 0008 "AI providers"). Each
 * provider keeps its own key: switching does not delete any, and a pill
 * shows which ones have a key.
 */
export const AiKeyCard = ({
  api = tauriKeyApi,
  onStatusChange,
  provider: shown,
  embedded = false,
}: {
  api?: AiKeyApi;
  /** Told when a provider's key status is known or changes (AI panel). */
  onStatusChange?: (provider: AiProvider, status: KeyStatus) => void;
  /** The provider shown; the stored choice by default (tests pass one). */
  provider?: AiProvider;
  /** Inside a dialog that has its own title: no card box, no title. */
  embedded?: boolean;
}) => {
  const { t } = useTranslation();
  const chosen = useAnalyticsSettingsStore((s) => s.aiProvider);
  const provider = shown ?? chosen;
  const setProvider = useAnalyticsSettingsStore((s) => s.setAiProvider);
  const shareAssets = useAnalyticsSettingsStore((s) => s.aiShareAssetNames);
  const setShareAssets = useAnalyticsSettingsStore(
    (s) => s.setAiShareAssetNames
  );
  const [statuses, setStatuses] = useState<
    Partial<Record<AiProvider, KeyStatus>>
  >({});

  // Every provider's status, for the pills and the "no key" warning.
  useEffect(() => {
    let alive = true;
    for (const id of AI_PROVIDERS) {
      api.status(id).then(
        (status) => {
          if (alive) setStatuses((all) => ({ ...all, [id]: status }));
        },
        () => undefined
      );
    }
    return () => {
      alive = false;
    };
  }, [api]);

  const onStatus = useCallback(
    (changed: AiProvider, status: KeyStatus) => {
      setStatuses((all) => ({ ...all, [changed]: status }));
      onStatusChange?.(changed, status);
    },
    [onStatusChange]
  );
  const baseUrl = statuses[COMPATIBLE]?.baseUrl ?? null;
  const nameOf = (id: AiProvider) =>
    providerName(id, id === COMPATIBLE ? baseUrl : null) ??
    t("analytics.ai.providers.server");
  const who = nameOf(provider);
  const selected = statuses[provider];
  const configured =
    selected && !selected.stored
      ? AI_PROVIDERS.find((id) => id !== provider && statuses[id]?.stored)
      : undefined;

  const content = (
    <>
      <ProviderChoice
        provider={provider}
        statuses={statuses}
        onChange={setProvider}
      />
      {configured && (
        <Notice tone="warning">
          <div className="flex flex-col gap-2 items-start">
            <span>
              {t("analytics.settings.ai.provider.mismatch", { provider: who })}
            </span>
            <button
              type="button"
              className={buttonClass("outlined")}
              onClick={() => setProvider(configured)}
            >
              {t("analytics.settings.ai.provider.switchBack", {
                provider: nameOf(configured),
              })}
            </button>
          </div>
        </Notice>
      )}
      <ProviderKeyForm
        key={provider}
        api={api}
        provider={provider}
        onStatusChange={onStatus}
      />

      <div className="flex flex-col gap-3 border-t border-gray-200 pt-4">
        <h3 className="font-medium text-gray-900">
          {t("analytics.settings.ai.privacy.title")}
        </h3>
        <Switch
          id="analytics-ai-share-assets"
          checked={shareAssets}
          onChange={setShareAssets}
          label={t("analytics.settings.ai.shareAssets")}
          description={t("analytics.settings.ai.shareAssetsHelp")}
        />
        <p className="text-sm text-gray-700">
          {t("analytics.settings.ai.whatIsSent", { provider: who })}
        </p>
        <PrivacyDetails
          shareAssets={shareAssets}
          provider={provider}
          baseUrl={provider === COMPATIBLE ? baseUrl : null}
        />
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-4">{content}</div>;
  }
  return (
    <SettingsCard
      id="analytics-ai"
      title={t("analytics.settings.ai.title")}
      description={t("analytics.settings.ai.description")}
    >
      {content}
    </SettingsCard>
  );
};
