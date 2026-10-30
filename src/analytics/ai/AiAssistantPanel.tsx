import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChartBarIcon,
  ChatBubbleLeftEllipsisIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  SparklesIcon,
  StopIcon,
} from "@heroicons/react/24/outline";
import { SimpleDialog } from "../../_common/components/SimpleDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../_common/components/Popover";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useModulesStore } from "../../_common/store/modules.store";
import { ChartView, ChartViewMode } from "../charts/ChartView";
import { AnalyticsError, formatAnalyticsError } from "../engine/errors";
import type { AiProvider, KeyStatus } from "../engine/ipc";
import {
  getEditorMaxRows,
  getQueryTimeoutMs,
} from "../engine/activePerformance";
import { createRequest, runQuery } from "../engine/queue";
import { localNow } from "../params/season";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import {
  aiTargetOf,
  useAnalyticsSettingsStore,
} from "../store/analyticsSettings.store";
import type { AiDraft } from "../types";
import { AiKeyCard } from "../settings/AiKeyCard";
import { isConfigured } from "../settings/aiKeyController";
import {
  AiError,
  aiAsk,
  aiErrorDetail,
  aiKeyStatus,
  formatAiError,
  validateBaseUrl,
} from "./aiClient";
import {
  attachAiPanel,
  bindAiPanel,
  useAiAssistantStore,
  useAiController,
} from "./aiAssistant.store";
import type { AiHistoryEntry } from "./aiHistory";
import { copyText } from "./clipboard";
import {
  buildCopyRepairText,
  buildCopyText,
  questionTitle,
} from "./copyPrompt";
import { formatCostUsd, typicalQuestionCostUsd } from "./cost";
import { modelName, providerName } from "./models";
import { buildNameIndex, findNames, replaceNames } from "./nameCheck";
import { openExternal } from "./openExternal";
import { buildSystemPrompt, QUESTION_MAX } from "./promptBuilder";
import { loadPromptContext } from "./promptContext";
import { AiPanelDraft, AiPanelState, defaultValues } from "./useAiAssistant";

interface AiAssistantPanelProps {
  /**
   * A usable answer: the Explorer loads it (WP6). `draft.unverified`: a
   * query that failed, opened for the user to fix; not to run on its own.
   */
  onAnswer: (draft: AiPanelDraft) => void;
  /** The editor's SQL, sent as context of follow-up questions. */
  currentSql: string;
  /**
   * Show the result preview in the answer card (default true). The
   * Explorer passes false when its own results panel shows the run.
   */
  showPreview?: boolean;
  /** "Voir le résultat": scrolls to the Explorer's result (review #13). */
  onShowResult?: () => void;
  /** "Choisir {{name}}": focuses that parameter's value (review #18). */
  onFocusParam?: (name: string) => void;
  /**
   * One row while idle (a query is already in the editor): the question
   * box grows, and the examples and notes appear, on focus or once typed.
   */
  compact?: boolean;
}

/**
 * The draft of the answer shown, to load it again ("Charger dans
 * l'éditeur" after the editor kept its own query): the same draft the
 * assistant handed over. Null without SQL.
 */
export const draftOfState = (
  state: Pick<AiPanelState, "answer" | "chart" | "question">
): AiDraft | null => {
  const { answer, chart } = state;
  if (!answer?.sql || !chart) return null;
  return {
    title: answer.title || questionTitle(state.question),
    sql: answer.sql,
    params: answer.params,
    chart,
    explanation: answer.explanation,
    assumptions: answer.assumptions,
  };
};

/** True when the editor holds this SQL (spaces and line breaks aside). */
export const isSqlInEditor = (answerSql: string, editorSql: string) =>
  answerSql.replace(/\s+/g, " ").trim() ===
  editorSql.replace(/\s+/g, " ").trim();

const EXAMPLES = ["weekend", "youth", "hoursType"] as const;
/** Recent questions offered while idle (the history keeps 10). */
const HISTORY_SHOWN = 5;
/** The counter shows from this length (the limit is QUESTION_MAX). */
const COUNTER_FROM = 1800;
/** After this wait, "Toujours en cours…" replaces "jusqu'à une minute". */
const SLOW_AFTER_S = 30;

const button =
  "min-h-11 px-4 rounded text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ";
const primary =
  button +
  "bg-steel-blue-700 text-white border border-steel-blue-700 enabled:hover:bg-steel-blue-800";
const outlined =
  button +
  "border border-steel-blue-200 bg-steel-blue-50 text-steel-blue-800 enabled:hover:bg-steel-blue-100";
const textButton = button + "px-2 text-steel-blue-700 enabled:hover:underline";
const chip =
  "min-h-11 px-3 rounded-full border border-steel-blue-200 bg-steel-blue-50 text-sm text-steel-blue-900 hover:bg-steel-blue-100 inline-flex items-center gap-2 text-left";

type KeyState = "loading" | "present" | "absent";

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** Message of a failed answer, in the user's language. */
export const describeAiFailure = (
  state: Pick<AiPanelState, "error" | "repairFailed">,
  t: TFunction,
  /** Who was asked ("Anthropic", "OpenAI", the server's host). */
  provider?: string | null,
  /** A compatible server gets "check that it is started" (review #30). */
  providerKind?: AiProvider | null
): string => {
  const { error } = state;
  if (!error) return "";
  if (error instanceof AiError) {
    return formatAiError(error, t, undefined, provider, providerKind);
  }
  const engineMessage = formatAnalyticsError(error, t);
  return state.repairFailed
    ? t("analytics.ai.errors.repair_failed", { message: engineMessage })
    : t("analytics.ai.errors.query", { message: engineMessage });
};

/** The actions an error offers (review #29). */
export type ErrorActions = {
  main: "fixSettings" | "retry" | "editQuestion" | null;
  /** "Copier la demande pour votre IA habituelle". */
  copyForUsual: boolean;
};

export const errorActionsOf = (
  error: AiPanelState["error"],
  canRetry: boolean
): ErrorActions => {
  if (!(error instanceof AiError)) {
    return { main: "editQuestion", copyForUsual: false };
  }
  const copyForUsual = (
    ["network", "overloaded", "rate_limited", "forbidden"] as string[]
  ).includes(error.code);
  switch (error.code) {
    case "invalid_key":
    case "no_key":
    case "forbidden":
    case "model_not_allowed":
    case "model_not_found":
      return { main: "fixSettings", copyForUsual };
    case "network":
    case "timeout":
    case "overloaded":
    case "invalid_response":
    case "internal":
    case "bad_request":
    case "rate_limited":
      return { main: canRetry ? "retry" : null, copyForUsual };
    case "refusal":
    case "truncated":
    case "too_large":
      return { main: "editQuestion", copyForUsual };
    default:
      return { main: null, copyForUsual };
  }
};

/** Chat assistants the copied request can be pasted into (any works). */
const CHAT_ASSISTANTS = [
  { name: "ChatGPT", url: "https://chatgpt.com/" },
  { name: "Claude", url: "https://claude.ai/new" },
  { name: "Le Chat", url: "https://chat.mistral.ai/chat" },
] as const;

type CopyState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "copied"; name: string | null }
  | { kind: "failed"; text: string }
  | { kind: "error"; message: string }
  | { kind: "needQuestion" };

type NameTarget = "question" | "followUp" | "reply";

interface NameAlert {
  names: string[];
  target: NameTarget;
  mode: "send" | "copy";
  proceed: () => void;
}

/** Month and weekday names of the app language: never a rower's name. */
const calendarWords = (locale: string): string[] => {
  try {
    const months = Array.from({ length: 12 }, (_, m) =>
      new Intl.DateTimeFormat(locale, { month: "long" }).format(
        new Date(2026, m, 1)
      )
    );
    const days = Array.from({ length: 7 }, (_, d) =>
      new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
        new Date(2026, 5, 1 + d)
      )
    );
    return [...months, ...days];
  } catch {
    return [];
  }
};

/**
 * The AI question box at the top of the Explorer (plan 1.3 and 2.11).
 * With the club's key, the question goes to the chosen provider
 * (Anthropic, OpenAI or a compatible server) through the Rust proxy;
 * without one, the same request is copied for the user's usual AI
 * (ChatGPT, Claude, Le Chat…) and the answer pasted back. Either way the
 * SQL runs on the read-only engine before `onAnswer` hands it to the
 * editor: nothing is saved here. The conversation lives in
 * `aiAssistant.store`, so it survives a look at another tab.
 */
export const AiAssistantPanel = ({
  onAnswer,
  currentSql,
  showPreview = true,
  onShowResult,
  onFocusParam,
  compact = false,
}: AiAssistantPanelProps) => {
  const { t, i18n } = useTranslation();
  const provider = useAnalyticsSettingsStore((s) => s.aiProvider);
  const model = useAnalyticsSettingsStore((s) => aiTargetOf(s).model);
  const shareAssets = useAnalyticsSettingsStore((s) => s.aiShareAssetNames);
  const setAiProvider = useAnalyticsSettingsStore((s) => s.setAiProvider);
  const question = useAiAssistantStore((s) => s.question);
  const setQuestion = useAiAssistantStore((s) => s.setQuestion);
  const followUp = useAiAssistantStore((s) => s.followUp);
  const setFollowUp = useAiAssistantStore((s) => s.setFollowUp);
  const history = useAiAssistantStore((s) => s.history);
  const pasteOpen = useAiAssistantStore((s) => s.pasteOpen);
  const usualAi = useAiAssistantStore((s) => s.usualAi);
  /** The key status of a provider (null: it could not be read). */
  const [key, setKey] = useState<{
    provider: AiProvider;
    status: KeyStatus | null;
  } | null>(null);
  /** Other providers with a usable stored key (review #22). */
  const [otherKeys, setOtherKeys] = useState<AiProvider[]>([]);
  const [reply, setReply] = useState("");
  const [keyDialog, setKeyDialog] = useState(false);
  const [nameAlert, setNameAlert] = useState<NameAlert | null>(null);
  const [focused, setFocused] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const answerTitleRef = useRef<HTMLHeadingElement>(null);
  const errorActionsRef = useRef<HTMLDivElement>(null);
  const followUpRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);

  const buildSystem = useCallback(
    async (signal?: AbortSignal) => {
      const settings = useAnalyticsSettingsStore.getState();
      const context = await loadPromptContext({
        locale: i18n.language,
        seasonStartMonth: settings.seasonStartMonth,
        enabledModules: useModulesStore.getState().enabled,
        shareAssetNames: settings.aiShareAssetNames,
        t,
        signal,
      });
      return buildSystemPrompt(context);
    },
    [i18n.language, t]
  );

  bindAiPanel({
    buildSystem,
    ask: aiAsk,
    run: (sql, values, signal) =>
      runQuery(
        createRequest({
          sql,
          params: values,
          // The performance profile's limits (Gestion › Statistiques et
          // IA › Performances), like the Explorer's own runs.
          maxRows: getEditorMaxRows(),
          timeoutMs: getQueryTimeoutMs(),
          useCache: false,
        }),
        // Free SQL: alone in the queue (memory budget).
        { priority: "high", signal, exclusive: true }
      ),
    getTarget: () => aiTargetOf(useAnalyticsSettingsStore.getState()),
    getParamContext: () => ({
      now: localNow(),
      seasonStartMonth: useAnalyticsSettingsStore.getState().seasonStartMonth,
    }),
  });
  const { state, controller } = useAiController();

  // Answers reach this panel while it is mounted; one that arrived while
  // another tab was shown is handed over now (review #8).
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  useEffect(() => {
    const detach = attachAiPanel((draft) => onAnswerRef.current(draft));
    const pending = useAiAssistantStore.getState().takePendingDraft();
    if (pending) onAnswerRef.current(pending);
    return detach;
  }, []);

  // "Demander à l'IA" in Rapports: the question fills the box, unsent.
  const pendingAiQuestion = useAnalyticsHubStore((s) => s.pendingAiQuestion);
  useEffect(() => {
    if (pendingAiQuestion === null) return;
    const text = useAnalyticsHubStore.getState().takePendingAiQuestion();
    if (text === null) return;
    const current = controller.getState();
    if (current.status !== "generating" && current.status !== "idle") {
      controller.reset();
    }
    if (text !== "") setQuestion(text);
    // After the tab's render, so the box exists.
    requestAnimationFrame(() => {
      const box = questionRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }, [pendingAiQuestion, controller, setQuestion]);

  useEffect(() => {
    let alive = true;
    aiKeyStatus(provider).then(
      (status) => {
        if (alive) setKey({ provider, status });
      },
      () => {
        if (alive) setKey({ provider, status: null });
      }
    );
    return () => {
      alive = false;
    };
  }, [provider]);

  const keyState: KeyState =
    key?.provider !== provider
      ? "loading"
      : isConfigured(provider, key.status, model)
        ? "present"
        : "absent";
  const keyUnreadable = key?.provider === provider && key.status === null;

  // Without a key for this provider: another one may have its key stored.
  useEffect(() => {
    if (keyState !== "absent") {
      setOtherKeys([]);
      return;
    }
    let alive = true;
    const others = (
      ["anthropic", "openai", "openai_compatible"] as AiProvider[]
    ).filter((p) => p !== provider);
    void Promise.all(
      others.map((p) =>
        aiKeyStatus(p).then(
          (status) => {
            const settings = useAnalyticsSettingsStore.getState();
            const target = aiTargetOf({ ...settings, aiProvider: p });
            return isConfigured(p, status, target.model) ? p : null;
          },
          () => null
        )
      )
    ).then((found) => {
      if (alive) setOtherKeys(found.filter((p): p is AiProvider => !!p));
    });
    return () => {
      alive = false;
    };
  }, [keyState, provider]);

  /** Providers whose key status the open dialog already reported once. */
  const dialogSeen = useRef(new Set<AiProvider>());
  const onKeyStatus = useCallback(
    (changed: AiProvider, status: KeyStatus) => {
      const settings = useAnalyticsSettingsStore.getState();
      if (changed !== settings.aiProvider) return;
      setKey({ provider: changed, status });
      // The first report is the status as the dialog found it; a later
      // one with a usable key is a save (review #28).
      if (!dialogSeen.current.has(changed)) {
        dialogSeen.current.add(changed);
        return;
      }
      if (isConfigured(changed, status, aiTargetOf(settings).model)) {
        setKeyDialog(false);
        toast.success(t("analytics.ai.keyDialog.saved"));
        requestAnimationFrame(() => questionRef.current?.focus());
      }
    },
    [t]
  );
  const openKeyDialog = () => {
    dialogSeen.current = new Set();
    setKeyDialog(true);
  };

  const baseUrl =
    key?.provider === "openai_compatible"
      ? (key.status?.baseUrl ?? null)
      : null;
  const localServer =
    provider === "openai_compatible" &&
    baseUrl !== null &&
    (() => {
      const checked = validateBaseUrl(baseUrl);
      return checked.ok && checked.local;
    })();
  const answeredProvider = state.provider ?? provider;
  const answeredBy =
    answeredProvider === "openai_compatible" && localServer
      ? t("analytics.ai.providers.local")
      : (providerName(answeredProvider, baseUrl) ??
        t("analytics.ai.providers.server"));
  /** For the error messages: "Anthropic", "OpenAI", the server's host. */
  const errorProvider =
    providerName(answeredProvider, baseUrl) ??
    t("analytics.ai.providers.server");

  const generating = state.status === "generating";
  const hasKey = keyState === "present";
  /** The copy-paste path: no key, or chosen after an error. */
  const copyMode = keyState === "absent" || usualAi;
  const tooLong = question.length > QUESTION_MAX;
  /** An answer or a clarification is on screen (or being followed up). */
  const inConversation =
    state.status === "answer" ||
    state.status === "clarification" ||
    (generating &&
      (state.answer !== null || state.turns.length > 0) &&
      state.source !== "paste");

  // The rowers' names, checked before a question leaves the computer.
  const rowers = useClubOverviewStore((s) => s.clubOverview.rowers);
  const boats = useClubOverviewStore((s) => s.clubOverview.boats);
  const routes = useClubOverviewStore((s) => s.clubOverview.routes);
  const nameIndex = useMemo(
    () =>
      buildNameIndex(
        (rowers ?? []).filter((r) => !r.archivedAt && !r.anonymizedAt),
        [
          ...(boats ?? []).map((b) => b.name),
          ...(routes ?? []).map((r) => r.name),
          ...calendarWords(i18n.language),
        ]
      ),
    [rowers, boats, routes, i18n.language]
  );

  /** Runs `proceed`, unless the text holds a rower's name (review #35). */
  const guardNames = (
    text: string,
    target: NameTarget,
    mode: "send" | "copy",
    proceed: () => void
  ) => {
    const names = findNames(text, nameIndex);
    if (names.length === 0) {
      setNameAlert(null);
      proceed();
      return;
    }
    setNameAlert({ names, target, mode, proceed });
  };

  const textOf = (target: NameTarget) =>
    target === "question" ? question : target === "followUp" ? followUp : reply;
  const setTextOf = (target: NameTarget, text: string) => {
    if (target === "question") setQuestion(text);
    else if (target === "followUp") setFollowUp(text);
    else setReply(text);
  };
  const focusTarget = (target: NameTarget) =>
    (target === "question"
      ? questionRef
      : target === "followUp"
        ? followUpRef
        : replyRef
    ).current?.focus();

  /* -- Copy for the usual AI (review #22-#26) ----------------------------- */

  const [copyState, setCopyState] = useState<CopyState>({ kind: "idle" });
  // An old "Demande copiée" must not survive a new question (review #23).
  useEffect(() => {
    setCopyState({ kind: "idle" });
  }, [question]);

  const copyRequest = async (assistant?: { name: string; url: string }) => {
    const text = question.trim() !== "" ? question : state.question;
    if (text.trim() === "") {
      setCopyState({ kind: "needQuestion" });
      questionRef.current?.focus();
      return;
    }
    useAiAssistantStore.getState().openPaste();
    setCopyState({ kind: "building" });
    try {
      const full = buildCopyText(
        await buildSystem(),
        text,
        t("analytics.ai.copy.header")
      );
      const copied = await copyText(full);
      setCopyState(
        copied
          ? { kind: "copied", name: assistant?.name ?? null }
          : { kind: "failed", text: full }
      );
      if (assistant) void openExternal(assistant.url);
    } catch (error) {
      setCopyState({
        kind: "error",
        message:
          error instanceof AnalyticsError
            ? formatAnalyticsError(error, t)
            : error instanceof AiError
              ? formatAiError(error, t)
              : String(error),
      });
    }
  };
  const copyGuarded = (assistant?: { name: string; url: string }) => {
    const text = question.trim() !== "" ? question : state.question;
    guardNames(text, "question", "copy", () => void copyRequest(assistant));
  };

  /* -- Send ---------------------------------------------------------------- */

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (generating || tooLong || question.trim() === "") return;
    if (hasKey && !usualAi) {
      guardNames(question, "question", "send", () => {
        setNameAlert(null);
        void controller.ask(question);
      });
    } else if (copyMode) {
      copyGuarded();
    }
  };

  const editQuestion = () => {
    setQuestion(state.question || question);
    controller.reset();
    setNameAlert(null);
    requestAnimationFrame(() => questionRef.current?.focus());
  };
  const newQuestion = () => {
    controller.reset();
    setQuestion("");
    setFollowUp("");
    setReply("");
    setNameAlert(null);
    useAiAssistantStore.setState({ usualAi: false });
    requestAnimationFrame(() => questionRef.current?.focus());
  };

  // The focus follows the result (review #14), once per result: not when
  // the panel mounts again on an answer already seen.
  const handledRun = useRef(state.runId);
  useEffect(() => {
    if (state.runId === handledRun.current) return;
    handledRun.current = state.runId;
    requestAnimationFrame(() => {
      if (state.status === "answer") answerTitleRef.current?.focus();
      else if (state.status === "clarification") {
        (
          document.querySelector<HTMLElement>("[data-ai-choice]") ??
          replyRef.current
        )?.focus();
      } else if (state.status === "error") {
        errorActionsRef.current?.querySelector("button")?.focus();
      }
    });
  }, [state.runId, state.status]);

  /* -- Notes ------------------------------------------------------------- */

  const providerLabel =
    provider === "anthropic" || provider === "openai"
      ? t(`analytics.settings.ai.provider.${provider}`)
      : (providerName(provider, baseUrl) ?? t("analytics.ai.providers.server"));
  const typicalCost = hasKey ? typicalQuestionCostUsd(provider, model) : null;
  const privacyLine = copyMode
    ? t(
        shareAssets
          ? "analytics.ai.privacy.lineCopyAssets"
          : "analytics.ai.privacy.lineCopy"
      )
    : localServer
      ? t("analytics.ai.privacy.lineLocal", {
          host: providerName(provider, baseUrl) ?? "",
        })
      : t(
          shareAssets
            ? "analytics.ai.privacy.lineAssets"
            : "analytics.ai.privacy.line",
          { provider: providerLabel }
        );
  const privacy = (
    <PrivacyNote
      line={privacyLine}
      cost={
        typicalCost !== null && !inConversation && !copyMode
          ? t("analytics.ai.privacy.typicalCost", {
              cost: formatCostUsd(typicalCost, i18n.language),
            })
          : null
      }
      copyMode={copyMode}
      provider={providerLabel}
      shareAssets={shareAssets}
    />
  );

  const nameNotice = (target: NameTarget) =>
    nameAlert?.target === target ? (
      <NameNotice
        alert={nameAlert}
        provider={providerLabel}
        onReplace={() => {
          setTextOf(
            target,
            replaceNames(
              textOf(target),
              nameAlert.names,
              t("analytics.ai.names.replacement")
            )
          );
          setNameAlert(null);
          focusTarget(target);
        }}
        onProceed={() => {
          setNameAlert(null);
          nameAlert.proceed();
        }}
      />
    ) : null;

  const ctrlKey = isMac() ? "⌘" : t("analytics.explorer.editor.keys.ctrl");
  const sendKeys = `${ctrlKey} + ${t("analytics.explorer.editor.keys.enter")}`;
  const showCounter = question.length >= COUNTER_FROM;
  const nf = new Intl.NumberFormat(i18n.language);

  /** Compact and idle: one row until the box is used. */
  const collapsed =
    compact &&
    keyState !== "absent" &&
    state.status === "idle" &&
    !focused &&
    question.trim() === "";
  const showIntro = !compact || !collapsed;

  const recent = history.slice(0, HISTORY_SHOWN);
  const showChips = state.status === "idle" && !collapsed && !inConversation;

  /** Chips keep the focus in the box (the compact panel stays open). */
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  const pasteOnly =
    copyMode &&
    (state.status === "answer" || state.status === "clarification") &&
    state.source === "paste";

  return (
    <section
      aria-labelledby="analytics-ai-title"
      className="rounded-lg border border-steel-blue-200 bg-white p-3 flex flex-col gap-3"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <div
        className={
          collapsed
            ? "flex flex-wrap items-center gap-x-3 gap-y-2"
            : "flex flex-col gap-1"
        }
      >
        <h2
          id="analytics-ai-title"
          className="flex items-center gap-2 text-base font-semibold text-gray-900"
        >
          <SparklesIcon
            className="h-5 w-5 flex-none text-steel-blue-700"
            aria-hidden="true"
          />
          {t("analytics.ai.questionLabel")}
        </h2>
        {showIntro && !inConversation && (
          <p className="text-sm text-gray-700">{t("analytics.ai.intro")}</p>
        )}
        {collapsed && (
          <form
            className="flex flex-1 min-w-[16rem] items-center gap-2"
            onSubmit={submit}
          >
            <QuestionBox
              ref={questionRef}
              rows={1}
              value={question}
              onChange={setQuestion}
              onSubmit={submit}
              invalid={false}
              describedBy={undefined}
            />
            <AskButton
              keyState={keyState}
              generating={false}
              disabled={question.trim() === ""}
            />
          </form>
        )}
      </div>

      {!collapsed &&
        (inConversation ? (
          <QuestionSummary
            question={state.question}
            disabled={generating}
            onEdit={editQuestion}
            onNew={newQuestion}
          />
        ) : (
          <form className="flex flex-col gap-2" onSubmit={submit}>
            <QuestionBox
              ref={questionRef}
              rows={compact ? 3 : 2}
              value={question}
              onChange={(text) => {
                setQuestion(text);
                if (nameAlert?.target === "question") setNameAlert(null);
              }}
              onSubmit={submit}
              invalid={tooLong}
              describedBy={
                [
                  showCounter ? "analytics-ai-counter" : null,
                  keyState !== "loading" ? "analytics-ai-shortcut" : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              {!copyMode && (
                <AskButton
                  keyState={keyState}
                  generating={generating}
                  disabled={generating || tooLong || question.trim() === ""}
                />
              )}
              {generating && (
                <button
                  type="button"
                  className={outlined}
                  onClick={() => controller.cancel()}
                >
                  <StopIcon className="h-5 w-5" aria-hidden="true" />
                  {t("analytics.common.actions.stop")}
                </button>
              )}
              {state.status !== "idle" && !generating && (
                <button
                  type="button"
                  className={textButton}
                  onClick={newQuestion}
                >
                  {t("analytics.ai.newQuestion")}
                </button>
              )}
              {keyState !== "loading" && !generating && (
                <span
                  id="analytics-ai-shortcut"
                  className="text-xs text-gray-600"
                >
                  {t(
                    copyMode
                      ? "analytics.ai.shortcutCopy"
                      : "analytics.ai.shortcut",
                    { keys: sendKeys }
                  )}
                </span>
              )}
              {showCounter && (
                <span
                  id="analytics-ai-counter"
                  className={
                    "ml-auto text-xs tabular-nums " +
                    (tooLong ? "text-error-700 font-medium" : "text-gray-600")
                  }
                >
                  {t("analytics.ai.counter", {
                    count: nf.format(question.length) as unknown as number,
                    max: nf.format(QUESTION_MAX) as unknown as number,
                  })}
                </span>
              )}
            </div>
          </form>
        ))}

      {nameNotice("question")}

      {generating && state.startedAt !== null && (
        <GeneratingLine phase={state.phase} startedAt={state.startedAt} />
      )}
      {state.stopped && (
        <p role="status" className="text-sm text-gray-700">
          {t("analytics.ai.stopped")}
        </p>
      )}

      {showChips && recent.length > 0 && (
        <HistoryChips
          entries={recent}
          locale={i18n.language}
          onMouseDown={keepFocus}
          onPick={(entry) => {
            setQuestion(entry.question);
            void controller.replay(entry.question, entry.draft, entry.at);
          }}
        />
      )}
      {showChips && (
        <div
          role="group"
          aria-labelledby="analytics-ai-examples"
          className="flex flex-col gap-2"
        >
          <p id="analytics-ai-examples" className="text-sm text-gray-700">
            {t("analytics.ai.examples.title")}
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className={chip}
                onMouseDown={keepFocus}
                onClick={() => {
                  setQuestion(t(`analytics.ai.examples.${example}`));
                  questionRef.current?.focus();
                }}
              >
                <SparklesIcon
                  className="h-4 w-4 flex-none text-steel-blue-700"
                  aria-hidden="true"
                />
                {t(`analytics.ai.examples.${example}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {!collapsed && !inConversation && privacy}

      {copyMode &&
        (state.status !== "generating" || state.source === "paste") && (
          <UsualAiSteps
            pasteOnly={pasteOnly}
            pasteOpen={pasteOpen || pasteOnly}
            copyState={copyState}
            busy={generating}
            tooLong={tooLong}
            keyUnreadable={keyUnreadable && !usualAi}
            showKeyFooter={!usualAi}
            otherKeys={otherKeys}
            onCopy={(assistant) => copyGuarded(assistant)}
            onRevealPaste={() => useAiAssistantStore.getState().openPaste()}
            onConfigure={openKeyDialog}
            onUseProvider={(p) => setAiProvider(p)}
            onPaste={async (text) => {
              const ok = await controller.applyPaste(
                text,
                state.source === "paste" && state.question
                  ? state.question
                  : question
              );
              if (ok) setCopyState({ kind: "idle" });
              return ok;
            }}
          />
        )}

      {state.status === "clarification" && state.clarification && (
        <ClarificationCard
          state={state}
          canReply={state.source === "api"}
          reply={reply}
          setReply={(text) => {
            setReply(text);
            if (nameAlert?.target === "reply") setNameAlert(null);
          }}
          replyRef={replyRef}
          locale={i18n.language}
          provider={errorProvider}
          notice={nameNotice("reply")}
          onReply={(text) =>
            guardNames(text, "reply", "send", () => {
              setReply("");
              void controller.reply(text);
            })
          }
          onChoice={(text) => {
            setReply("");
            setNameAlert(null);
            void controller.reply(text);
          }}
        />
      )}

      {state.status === "error" && (
        <ErrorCard
          state={state}
          provider={errorProvider}
          actionsRef={errorActionsRef}
          canRetry={state.source === "api" && hasKey}
          onRetry={() => void controller.retry()}
          onFixSettings={openKeyDialog}
          onEditQuestion={editQuestion}
          onCopyForUsual={() => {
            useAiAssistantStore.setState({ usualAi: true });
            copyGuarded();
          }}
          onOpenFailed={() => controller.openFailed()}
        />
      )}

      {(state.status === "answer" || (generating && state.answer)) &&
        state.answer &&
        state.result &&
        state.chart && (
          <AnswerCard
            state={state}
            titleRef={answerTitleRef}
            showPreview={showPreview}
            dimmed={generating}
            locale={i18n.language}
            model={model}
            answeredBy={answeredBy}
            costProvider={errorProvider}
            followUp={followUp}
            setFollowUp={(text) => {
              setFollowUp(text);
              if (nameAlert?.target === "followUp") setNameAlert(null);
            }}
            followUpRef={followUpRef}
            canRefine={state.source !== "paste" && hasKey && !usualAi}
            notice={nameNotice("followUp")}
            inEditor={isSqlInEditor(state.answer.sql ?? "", currentSql)}
            onShowResult={onShowResult}
            onFocusParam={onFocusParam}
            onLoad={() => {
              const draft = draftOfState(state);
              if (draft) onAnswer(draft);
            }}
            onRefine={() =>
              guardNames(followUp, "followUp", "send", () => {
                void controller.refine(followUp, currentSql);
                setFollowUp("");
              })
            }
          />
        )}

      {inConversation && privacy}

      {keyDialog && (
        <SimpleDialog
          open={keyDialog}
          onOpenChange={setKeyDialog}
          title={t("analytics.ai.keyDialog.title")}
          modal
          className="max-w-2xl w-full max-h-[90vh] overflow-auto"
        >
          <AiKeyCard embedded onStatusChange={onKeyStatus} />
        </SimpleDialog>
      )}
    </section>
  );
};

/* ---------------------------------------------------------------------- */

const QuestionBox = forwardRef<
  HTMLTextAreaElement,
  {
    rows: number;
    value: string;
    onChange: (text: string) => void;
    onSubmit: (event: { preventDefault: () => void }) => void;
    invalid: boolean;
    describedBy: string | undefined;
  }
>(function QuestionBox(
  { rows, value, onChange, onSubmit, invalid, describedBy },
  ref
) {
  const { t } = useTranslation();
  return (
    <textarea
      id="analytics-ai-question"
      ref={ref}
      rows={rows}
      value={value}
      placeholder={t("analytics.ai.placeholder")}
      aria-labelledby="analytics-ai-title"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          onSubmit(event);
        }
      }}
      className={
        "w-full rounded border p-3 text-base resize-y " +
        (rows === 1 ? "min-h-11 flex-1 py-2 resize-none " : "") +
        (invalid ? "border-error-500" : "border-gray-300")
      }
    />
  );
});

const AskButton = ({
  keyState,
  generating,
  disabled,
}: {
  keyState: KeyState;
  generating: boolean;
  disabled: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="submit"
      className={primary + " flex-none"}
      // While the key status loads, the button holds its place (review #12).
      disabled={disabled || keyState !== "present"}
    >
      <SparklesIcon className="h-5 w-5" aria-hidden="true" />
      {generating ? t("analytics.ai.generating") : t("analytics.ai.ask")}
    </button>
  );
};

/** The question asked, in place of the box while an answer is shown. */
const QuestionSummary = ({
  question,
  disabled,
  onEdit,
  onNew,
}: {
  question: string;
  disabled: boolean;
  onEdit: () => void;
  onNew: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="mr-auto min-w-0 flex-1 basis-64 text-base text-gray-900 line-clamp-2 break-words">
        <span className="sr-only">{t("analytics.ai.askedQuestion")} : </span>«{" "}
        {question} »
      </p>
      <button
        type="button"
        className={textButton}
        onClick={onEdit}
        disabled={disabled}
      >
        {t("analytics.ai.editQuestion")}
      </button>
      <button
        type="button"
        className={textButton}
        onClick={onNew}
        disabled={disabled}
      >
        {t("analytics.ai.newQuestion")}
      </button>
    </div>
  );
};

const GeneratingLine = ({
  phase,
  startedAt,
}: {
  phase: AiPanelState["phase"];
  startedAt: number;
}) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-steel-blue-800">
      <ArrowPathIcon className="h-5 w-5 animate-spin" aria-hidden="true" />
      {/* The live region announces the phase, not every second. */}
      <span role="status" aria-live="polite">
        {t(`analytics.ai.status.${phase ?? "asking"}`)}
      </span>
      <span className="tabular-nums" aria-hidden="true">
        {t("analytics.ai.status.elapsed", { seconds })}
      </span>
      <span className="text-gray-600">
        {seconds >= SLOW_AFTER_S
          ? t("analytics.ai.status.slower")
          : t("analytics.ai.status.slow")}
      </span>
    </div>
  );
};

/** "Sans noms de personnes…", what is sent, and the details (review #36). */
const PrivacyNote = ({
  line,
  cost,
  copyMode,
  provider,
  shareAssets,
}: {
  line: string;
  cost: string | null;
  copyMode: boolean;
  provider: string;
  shareAssets: boolean;
}) => {
  const { t } = useTranslation();
  const sent = ["question", "schema", "context", "errors"];
  if (shareAssets) sent.splice(3, 0, "assets");
  return (
    <div className="flex gap-2 items-start text-sm text-gray-600">
      <InformationCircleIcon
        className="h-5 w-5 flex-none text-gray-500"
        aria-hidden="true"
      />
      <p>
        {t("analytics.ai.privacy.noNames")} {line}
        {cost && ` ${cost}`}{" "}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline font-medium text-steel-blue-700 underline rounded min-h-6"
            >
              {t("analytics.ai.privacy.details")}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-gray-200 p-4 text-sm text-gray-800 flex flex-col gap-2"
          >
            <p className="font-medium text-gray-900">
              {copyMode
                ? t("analytics.settings.ai.privacy.copyPaste")
                : t("analytics.settings.ai.privacy.sentTitle", { provider })}
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              {sent.map((item) => (
                <li key={item}>
                  {t(`analytics.settings.ai.privacy.sent.${item}`)}
                </li>
              ))}
            </ul>
            <p className="font-medium text-gray-900">
              {t("analytics.settings.ai.privacy.neverTitle")}
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              {["people", "outings", "password"].map((item) => (
                <li key={item}>
                  {t(`analytics.settings.ai.privacy.never.${item}`)}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </p>
    </div>
  );
};

const NameNotice = ({
  alert,
  provider,
  onReplace,
  onProceed,
}: {
  alert: NameAlert;
  provider: string;
  onReplace: () => void;
  onProceed: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="rounded border border-yellow-300 bg-yellow-50 p-3 flex flex-col gap-2 text-sm text-yellow-900"
    >
      <p className="flex gap-2 items-start">
        <ExclamationTriangleIcon
          className="h-5 w-5 flex-none text-yellow-700"
          aria-hidden="true"
        />
        <span>
          {t(
            alert.mode === "copy"
              ? "analytics.ai.names.foundCopy"
              : "analytics.ai.names.found",
            { name: alert.names.join(" "), provider }
          )}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={onReplace}>
          {t("analytics.ai.names.replace")}
        </button>
        <button type="button" className={outlined} onClick={onProceed}>
          {t(
            alert.mode === "copy"
              ? "analytics.ai.names.copyAnyway"
              : "analytics.ai.names.sendAnyway"
          )}
        </button>
      </div>
    </div>
  );
};

const HistoryChips = ({
  entries,
  locale,
  onPick,
  onMouseDown,
}: {
  entries: AiHistoryEntry[];
  locale: string;
  onPick: (entry: AiHistoryEntry) => void;
  onMouseDown: (event: React.MouseEvent) => void;
}) => {
  const { t } = useTranslation();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <div
      role="group"
      aria-labelledby="analytics-ai-history"
      className="flex flex-col gap-2"
    >
      <p
        id="analytics-ai-history"
        className="flex items-center gap-1 text-sm text-gray-700"
      >
        <ClockIcon className="h-4 w-4" aria-hidden="true" />
        {t("analytics.ai.history.title")}
      </p>
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <button
            key={entry.at + entry.question}
            type="button"
            className={
              "min-h-11 px-3 rounded-full border border-gray-300 bg-white text-sm text-gray-800 hover:bg-gray-50 inline-flex items-center gap-2 text-left max-w-full"
            }
            title={date.format(new Date(entry.at))}
            onMouseDown={onMouseDown}
            onClick={() => onPick(entry)}
          >
            <span className="truncate">{entry.question}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/** "Utiliser votre IA habituelle": copy, open, paste (review #22). */
const UsualAiSteps = ({
  pasteOnly,
  pasteOpen,
  copyState,
  busy,
  tooLong,
  keyUnreadable,
  showKeyFooter,
  otherKeys,
  onCopy,
  onRevealPaste,
  onConfigure,
  onUseProvider,
  onPaste,
}: {
  /** An answer or a question of the AI is shown: only step 3 stays. */
  pasteOnly: boolean;
  pasteOpen: boolean;
  copyState: CopyState;
  busy: boolean;
  tooLong: boolean;
  keyUnreadable: boolean;
  showKeyFooter: boolean;
  otherKeys: AiProvider[];
  onCopy: (assistant?: { name: string; url: string }) => void;
  onRevealPaste: () => void;
  onConfigure: () => void;
  onUseProvider: (provider: AiProvider) => void;
  onPaste: (text: string) => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  const [paste, setPaste] = useState("");
  const [invalid, setInvalid] = useState(false);
  const step = (n: number) => (
    <span
      className="flex-none h-6 w-6 rounded-full bg-steel-blue-700 text-white text-sm font-medium inline-flex items-center justify-center"
      aria-hidden="true"
    >
      {n}
    </span>
  );

  const pasteForm = (
    <form
      className="flex flex-col gap-2 min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        void onPaste(paste).then((ok) => {
          setInvalid(!ok);
          if (ok) setPaste("");
        });
      }}
    >
      <label
        htmlFor="analytics-ai-paste"
        className="text-sm font-medium text-gray-900"
      >
        {t("analytics.ai.paste.label")}
      </label>
      <p id="analytics-ai-paste-help" className="text-sm text-gray-700">
        {t("analytics.ai.steps.pasteHelp")}
      </p>
      <textarea
        id="analytics-ai-paste"
        rows={3}
        value={paste}
        aria-describedby={
          "analytics-ai-paste-help" +
          (invalid ? " analytics-ai-paste-invalid" : "")
        }
        aria-invalid={invalid || undefined}
        placeholder={t("analytics.ai.paste.placeholder")}
        onChange={(event) => {
          setPaste(event.target.value);
          setInvalid(false);
        }}
        className="w-full rounded border border-gray-300 p-2 text-base"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className={paste.trim() === "" ? outlined : primary}
          disabled={busy || paste.trim() === ""}
        >
          {t("analytics.ai.paste.apply")}
        </button>
      </div>
      {invalid && (
        <p
          id="analytics-ai-paste-invalid"
          role="alert"
          className="text-sm text-error-700"
        >
          {t("analytics.ai.paste.invalid")}
        </p>
      )}
    </form>
  );

  if (pasteOnly) {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 p-3 flex gap-2">
        {pasteForm}
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 flex flex-col gap-3">
      <h3 className="font-medium text-gray-900">
        {t("analytics.ai.steps.title")}
      </h3>
      <ol className="flex flex-col gap-3">
        <li className="flex gap-2 items-start">
          {step(1)}
          <div className="flex flex-col gap-2 min-w-0">
            <p className="text-sm text-gray-900">
              {t("analytics.ai.steps.copy")}
            </p>
            <div>
              <button
                type="button"
                className={primary}
                disabled={copyState.kind === "building" || tooLong}
                onClick={() => onCopy()}
              >
                <ClipboardDocumentIcon className="h-5 w-5" aria-hidden="true" />
                {t("analytics.ai.copy.button")}
              </button>
            </div>
            <CopyFeedback state={copyState} />
          </div>
        </li>
        <li className="flex gap-2 items-start">
          {step(2)}
          <div className="flex flex-col gap-2 min-w-0">
            <p className="text-sm text-gray-900">
              {t("analytics.ai.steps.open")}
            </p>
            <div className="flex flex-wrap gap-2">
              {CHAT_ASSISTANTS.map((assistant) => (
                <button
                  key={assistant.name}
                  type="button"
                  className={outlined}
                  disabled={copyState.kind === "building" || tooLong}
                  onClick={() => onCopy(assistant)}
                >
                  {t("analytics.ai.copy.open", { name: assistant.name })}
                  <ArrowTopRightOnSquareIcon
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        </li>
        {pasteOpen && (
          <li className="flex gap-2 items-start">
            {step(3)}
            {pasteForm}
          </li>
        )}
      </ol>
      {!pasteOpen && (
        <div>
          <button type="button" className={textButton} onClick={onRevealPaste}>
            {t("analytics.ai.steps.alreadyHave")}
          </button>
        </div>
      )}
      {showKeyFooter && (
        <div className="border-t border-gray-200 pt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
          {keyUnreadable ? (
            <p className="text-error-700">
              {t("analytics.settings.ai.status.error")}
            </p>
          ) : (
            <p>{t("analytics.ai.steps.addKey")}</p>
          )}
          <button type="button" className={textButton} onClick={onConfigure}>
            {t("analytics.ai.steps.configure")}
          </button>
          {otherKeys.map((other) => (
            <button
              key={other}
              type="button"
              className={outlined}
              onClick={() => onUseProvider(other)}
            >
              {t("analytics.ai.steps.useStored", {
                provider:
                  other === "openai_compatible"
                    ? t("analytics.ai.providers.server")
                    : t(`analytics.settings.ai.provider.${other}`),
              })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CopyFeedback = ({ state }: { state: CopyState }) => {
  const { t } = useTranslation();
  switch (state.kind) {
    case "copied":
      return (
        <p role="status" className="text-sm text-success-800">
          {state.name
            ? t("analytics.ai.copy.doneIn", { name: state.name })
            : t("analytics.ai.copy.done")}
        </p>
      );
    case "needQuestion":
      return (
        <p role="alert" className="text-sm text-error-700">
          {t("analytics.ai.copy.needQuestion")}
        </p>
      );
    case "error":
      return (
        <p role="alert" className="text-sm text-error-700">
          {state.message}
        </p>
      );
    case "failed":
      return (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-sm text-error-700">
            {t("analytics.ai.copy.failed")}
          </p>
          <textarea
            readOnly
            rows={6}
            value={state.text}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded border border-gray-300 p-2 font-mono text-xs"
          />
        </div>
      );
    default:
      return null;
  }
};

const CostLine = ({
  usd,
  locale,
  provider,
  children,
}: {
  usd: number | null;
  locale: string;
  provider: string;
  children?: ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <span className="text-sm text-gray-600">
      {usd !== null && (
        <span
          title={t("analytics.ai.answer.costTitle", { provider })}
          className="underline decoration-dotted decoration-gray-400 underline-offset-2"
        >
          {t("analytics.ai.answer.cost", {
            cost: formatCostUsd(usd, locale),
          })}
        </span>
      )}
      {usd !== null && children ? " · " : null}
      {children}
    </span>
  );
};

const ClarificationCard = ({
  state,
  canReply,
  reply,
  setReply,
  replyRef,
  locale,
  provider,
  notice,
  onReply,
  onChoice,
}: {
  state: AiPanelState;
  canReply: boolean;
  reply: string;
  setReply: (text: string) => void;
  replyRef: React.RefObject<HTMLInputElement>;
  locale: string;
  provider: string;
  notice: ReactNode;
  onReply: (text: string) => void;
  onChoice: (text: string) => void;
}) => {
  const { t } = useTranslation();
  const choices = canReply ? state.choices : [];
  return (
    <div
      role="region"
      aria-labelledby="analytics-ai-clarification-title"
      className="rounded border border-steel-blue-300 bg-steel-blue-50 p-3 flex flex-col gap-2"
    >
      <h3
        id="analytics-ai-clarification-title"
        className="flex items-center gap-2 font-medium text-steel-blue-900"
      >
        <ChatBubbleLeftEllipsisIcon className="h-5 w-5" aria-hidden="true" />
        {t("analytics.ai.clarification.title")}
      </h3>
      <TurnList turns={state.turns} />
      {state.clarificationContext && (
        <p className="text-sm text-gray-700">{state.clarificationContext}</p>
      )}
      <p className="text-base text-gray-900">{state.clarification}</p>
      {canReply ? (
        <>
          {choices.length > 0 && (
            <div
              role="group"
              aria-label={t("analytics.ai.clarification.choices")}
              className="flex flex-wrap gap-2"
            >
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  data-ai-choice
                  className={
                    button +
                    "border border-steel-blue-700 bg-white text-steel-blue-800 hover:bg-steel-blue-100"
                  }
                  onClick={() => onChoice(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim() !== "") onReply(reply);
            }}
          >
            <label
              htmlFor="analytics-ai-reply"
              className={
                choices.length > 0 ? "text-sm text-gray-700" : "sr-only"
              }
            >
              {choices.length > 0
                ? t("analytics.ai.clarification.other")
                : t("analytics.ai.clarification.answer")}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="analytics-ai-reply"
                ref={replyRef}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder={t("analytics.ai.clarification.placeholder")}
                className="min-h-11 flex-1 min-w-[12rem] rounded border border-gray-300 px-3 text-base"
              />
              <button
                type="submit"
                className={choices.length > 0 ? outlined : primary}
                disabled={reply.trim() === ""}
              >
                {t("analytics.ai.clarification.answer")}
              </button>
            </div>
          </form>
          {notice}
        </>
      ) : (
        <p className="text-sm text-gray-700">
          {t("analytics.ai.paste.clarification")}
        </p>
      )}
      {state.source === "api" && state.conversationCostUsd !== null && (
        <div className="flex justify-end">
          <CostLine
            usd={state.conversationCostUsd}
            locale={locale}
            provider={provider}
          />
        </div>
      )}
    </div>
  );
};

const RETRY_FALLBACK_S = 30;

const ErrorCard = ({
  state,
  provider,
  actionsRef,
  canRetry,
  onRetry,
  onFixSettings,
  onEditQuestion,
  onCopyForUsual,
  onOpenFailed,
}: {
  state: AiPanelState;
  /** Who was asked, for the messages that name it. */
  provider: string;
  actionsRef: React.RefObject<HTMLDivElement>;
  canRetry: boolean;
  onRetry: () => void;
  onFixSettings: () => void;
  onEditQuestion: () => void;
  onCopyForUsual: () => void;
  onOpenFailed: () => void;
}) => {
  const { t } = useTranslation();
  const [repairCopied, setRepairCopied] = useState<boolean | null>(null);
  const repairText = state.repairText;
  const error = state.error;
  const actions = errorActionsOf(error, canRetry);
  const rateLimited = error instanceof AiError && error.code === "rate_limited";
  const [wait, setWait] = useState(() =>
    rateLimited && error instanceof AiError
      ? (error.retryAfterSeconds ?? RETRY_FALLBACK_S)
      : 0
  );
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  const detail = error instanceof AiError ? aiErrorDetail(error) : null;

  return (
    <div className="rounded border border-error-200 bg-error-50 p-3 flex flex-col gap-2">
      <p role="alert" className="flex gap-2 items-start text-sm text-error-900">
        <ExclamationTriangleIcon
          className="h-5 w-5 flex-none"
          aria-hidden="true"
        />
        <span className="break-words">
          {describeAiFailure(state, t, provider, state.provider)}
        </span>
      </p>
      {detail && (
        <details className="text-sm text-gray-700 pl-7">
          <summary className="cursor-pointer min-h-6">
            {t("analytics.ai.actions.technical")}
          </summary>
          <p className="mt-1 text-xs font-mono break-words">{detail}</p>
        </details>
      )}
      <div ref={actionsRef} className="flex flex-wrap gap-2">
        {actions.main === "fixSettings" && (
          <button type="button" className={primary} onClick={onFixSettings}>
            {t("analytics.ai.actions.fixSettings")}
          </button>
        )}
        {actions.main === "retry" && (
          <button
            type="button"
            className={primary}
            onClick={onRetry}
            disabled={wait > 0}
          >
            <ArrowPathIcon className="h-5 w-5" aria-hidden="true" />
            {wait > 0
              ? t("analytics.ai.actions.retryIn", { seconds: wait })
              : t("analytics.common.actions.retry")}
          </button>
        )}
        {actions.main === "editQuestion" && (
          <button type="button" className={primary} onClick={onEditQuestion}>
            {t("analytics.ai.editQuestion")}
          </button>
        )}
        {state.failedDraft && (
          <button type="button" className={outlined} onClick={onOpenFailed}>
            {t("analytics.ai.actions.openInEditor")}
          </button>
        )}
        {actions.copyForUsual && state.source === "api" && (
          <button type="button" className={outlined} onClick={onCopyForUsual}>
            <ClipboardDocumentIcon className="h-5 w-5" aria-hidden="true" />
            {t("analytics.ai.actions.copyForUsual")}
          </button>
        )}
        {repairText && (
          <button
            type="button"
            className={outlined}
            onClick={() =>
              void copyText(buildCopyRepairText(repairText)).then(
                setRepairCopied
              )
            }
          >
            <ClipboardDocumentIcon className="h-5 w-5" aria-hidden="true" />
            {t("analytics.ai.paste.copyRepair")}
          </button>
        )}
      </div>
      {repairCopied === true && (
        <p role="status" className="text-sm text-gray-800">
          {t("analytics.ai.paste.repairCopied")}
        </p>
      )}
      {repairCopied === false && repairText && (
        <textarea
          readOnly
          rows={3}
          value={buildCopyRepairText(repairText)}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded border border-gray-300 p-2 font-mono text-xs"
        />
      )}
    </div>
  );
};

/** "Précisé : les sorties", "Affiné : seulement les jeunes" (review #6). */
const TurnList = ({ turns }: { turns: AiPanelState["turns"] }) => {
  const { t } = useTranslation();
  if (turns.length === 0) return null;
  return (
    <ul className="flex flex-col text-sm text-gray-600">
      {turns.map((turn, index) => (
        <li key={index} className="break-words">
          {t(
            turn.kind === "reply"
              ? "analytics.ai.answer.clarified"
              : "analytics.ai.answer.refined",
            { text: turn.text }
          )}
        </li>
      ))}
    </ul>
  );
};

const AnswerCard = ({
  state,
  titleRef,
  showPreview,
  dimmed,
  locale,
  model,
  answeredBy,
  costProvider,
  followUp,
  setFollowUp,
  followUpRef,
  canRefine,
  notice,
  inEditor,
  onShowResult,
  onFocusParam,
  onLoad,
  onRefine,
}: {
  state: AiPanelState;
  titleRef: React.RefObject<HTMLHeadingElement>;
  showPreview: boolean;
  dimmed: boolean;
  locale: string;
  model: string;
  /** "Anthropic", "OpenAI", the server's host or "the server on this computer". */
  answeredBy: string;
  /** Whose account the cost is billed on. */
  costProvider: string;
  followUp: string;
  setFollowUp: (text: string) => void;
  followUpRef: React.RefObject<HTMLInputElement>;
  canRefine: boolean;
  notice: ReactNode;
  /** The editor holds this answer's SQL. */
  inEditor: boolean;
  onShowResult?: () => void;
  onFocusParam?: (name: string) => void;
  /** Loads the answer into the editor (it asks before losing changes). */
  onLoad: () => void;
  onRefine: () => void;
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ChartViewMode>("chart");
  const answer = state.answer;
  const result = state.result;
  const chart = state.chart;
  if (!answer || !result || !chart) return null;
  const seasonStartMonth =
    useAnalyticsSettingsStore.getState().seasonStartMonth;
  const values = defaultValues(answer.params, {
    now: localNow(),
    seasonStartMonth,
  }).values;
  const title = answer.title || state.question;

  return (
    <article
      aria-busy={dimmed}
      aria-labelledby="analytics-ai-answer-title"
      className={
        "rounded border border-steel-blue-200 p-3 flex flex-col gap-3" +
        (dimmed ? " opacity-60" : "")
      }
    >
      <header className="flex flex-col gap-1">
        <p className="flex items-center gap-1 text-xs font-medium text-steel-blue-700">
          <SparklesIcon className="h-4 w-4" aria-hidden="true" />
          {t("analytics.ai.answer.eyebrow")}
        </p>
        <h3
          id="analytics-ai-answer-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-lg font-bold text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
        >
          {title}
        </h3>
        <TurnList turns={state.turns} />
        {state.replayedAt && (
          <p className="text-sm text-gray-600">
            {t("analytics.ai.history.replayed", {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: "long",
              }).format(new Date(state.replayedAt)),
            })}
          </p>
        )}
        {answer.explanation && (
          <p className="text-sm text-gray-700">{answer.explanation}</p>
        )}
      </header>
      {answer.assumptions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900">
            {t("analytics.ai.answer.assumptions")}
          </h4>
          <ul className="list-disc pl-5 text-sm text-gray-700">
            {answer.assumptions.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {state.repaired && (
        <p className="text-sm text-gray-600">
          {t("analytics.ai.answer.repaired")}
        </p>
      )}
      {state.needsValues.length > 0 && (
        <div
          role="status"
          className="rounded border border-yellow-300 bg-yellow-50 p-2 flex flex-col gap-2 text-sm text-yellow-900"
        >
          <p>
            {t("analytics.ai.answer.needsValues", {
              names: state.needsValues.map((p) => p.label ?? p.name).join(", "),
            })}
          </p>
          {onFocusParam && (
            <div className="flex flex-wrap gap-2">
              {state.needsValues.map((param) => (
                <button
                  key={param.name}
                  type="button"
                  className={outlined}
                  disabled={dimmed}
                  onClick={() => onFocusParam(param.name)}
                >
                  {t("analytics.ai.answer.chooseParam", {
                    name: param.label ?? param.name,
                  })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showPreview && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-medium text-gray-900">
              {t("analytics.ai.answer.preview")}
            </h4>
            <span className="text-sm text-gray-600">
              {t("analytics.ai.answer.rows", {
                count: result.rows.length,
                ms: Math.round(result.elapsedMs),
              })}
            </span>
          </div>
          <div className="max-w-full overflow-x-auto">
            <ChartView
              spec={chart}
              result={result}
              params={values}
              height={260}
              mode={mode}
              onModeChange={setMode}
            />
          </div>
        </div>
      )}
      {inEditor || dimmed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-steel-blue-900 flex-1 basis-72">
            {t("analytics.ai.answer.inEditor")}
          </p>
          {onShowResult && (
            <button
              type="button"
              className={outlined}
              onClick={onShowResult}
              disabled={dimmed}
            >
              <ChartBarIcon className="h-5 w-5" aria-hidden="true" />
              {t("analytics.ai.answer.showResult")}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-gray-700">
            {t("analytics.ai.answer.notLoaded")}
          </p>
          <button type="button" className={outlined} onClick={onLoad}>
            {t("analytics.ai.answer.load")}
          </button>
        </div>
      )}

      {canRefine ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (followUp.trim() !== "" && !dimmed) onRefine();
          }}
        >
          <label htmlFor="analytics-ai-refine" className="sr-only">
            {t("analytics.ai.refine.label")}
          </label>
          <input
            id="analytics-ai-refine"
            ref={followUpRef}
            value={followUp}
            onChange={(event) => setFollowUp(event.target.value)}
            placeholder={t("analytics.ai.refine.placeholder")}
            className="min-h-11 flex-1 min-w-[12rem] rounded border border-gray-300 px-3 text-base"
          />
          <button
            type="submit"
            className={primary}
            disabled={dimmed || followUp.trim() === ""}
          >
            {t("analytics.ai.refine.button")}
          </button>
        </form>
      ) : (
        state.source === "paste" && (
          <p className="text-sm text-gray-700">
            {t("analytics.ai.refine.pasted")}
          </p>
        )
      )}
      {notice}

      {state.source !== "paste" && state.source !== "history" && (
        <footer className="flex flex-wrap items-center justify-end gap-2">
          <CostLine
            usd={state.conversationCostUsd}
            locale={locale}
            provider={costProvider}
          >
            {t("analytics.ai.answer.answeredBy", {
              provider: answeredBy,
              model: modelName(state.model ?? model),
            })}
          </CostLine>
        </footer>
      )}
    </article>
  );
};
