import { v4 as uuidv4 } from "uuid";
import type { ChartSpec } from "../chartSpec";
import { AnalyticsError } from "../engine/errors";
import type {
  AiAskRequest,
  AiAskResponse,
  AiMessage,
  AiProvider,
} from "../engine/ipc";
import { ParamContext, resolveParams } from "../params/resolveParams";
import type { AiDraft, ParamDef, ParamValue, QueryResult } from "../types";
import { AiError } from "./aiClient";
import { AI_RESPONSE_JSON_SCHEMA } from "./aiSchema";
import type { AiAnswer } from "./aiResponse";
import { parsePastedAnswer, questionTitle } from "./copyPrompt";
import { estimateCostUsd } from "./cost";
import type { AiTarget } from "./models";
import { QUESTION_MAX } from "./promptBuilder";
import {
  AiOutcome,
  AiPhase,
  chartForResult,
  REPAIRABLE_CODES,
  repairMessage,
  runAiConversation,
} from "./repairLoop";

/**
 * State machine of the assistant panel (plan 1.3 "AI assistant"): idle,
 * generating, answer, clarification, error. Written as a plain controller
 * so tests drive it without a DOM; `useAiAssistant` binds it to React.
 *
 * Guarantee: `onAnswer` is called only with SQL that just ran without an
 * error in the read-only engine, so the user always sees the result
 * before saving or pinning anything (nothing is saved here).
 */

/**
 * Opus 5.5 and Sonnet 5.5 always think, and thinking counts toward
 * `max_tokens`: 16,000 (the cap Rust allows) keeps hard questions from
 * ending as "truncated". Only the tokens used are billed.
 */
const AI_MAX_TOKENS = 16_000;

/**
 * Where the answer shown comes from: the API, an answer pasted from the
 * user's usual AI, or the history of this computer (replayed locally).
 */
export type AiSource = "api" | "paste" | "history";

/** What the user added after the question (review #6). */
export interface AiTurn {
  kind: "reply" | "refine";
  text: string;
}

/**
 * A draft handed to the Explorer. `unverified`: the query failed in the
 * engine and is opened so the user can fix it (review #20); the Explorer
 * does not run it on its own.
 */
export type AiPanelDraft = AiDraft & { unverified?: boolean };

/** An answer to remember on this computer (review #7). */
export interface AiAnswered {
  question: string;
  draft: AiDraft;
  provider: AiProvider | null;
  model: string | null;
}

export interface AiPanelState {
  status: "idle" | "generating" | "answer" | "clarification" | "error";
  phase: AiPhase | null;
  source: AiSource;
  /** The question as first asked. */
  question: string;
  answer: (AiAnswer & { sql: string }) | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  /** Parameters needing a value before the result means anything. */
  needsValues: ParamDef[];
  clarification: string | null;
  /** Answers to pick for the clarification (review #21). */
  choices: string[];
  /** The model's explanation that came with a clarification. */
  clarificationContext: string | null;
  /** Replies and refinements since the question, in order. */
  turns: AiTurn[];
  error: AiError | AnalyticsError | null;
  /** The engine still rejected the query after the repair turns. */
  repairFailed: boolean;
  /** For a pasted answer that failed: the text to send back to claude.ai. */
  repairText: string | null;
  repaired: boolean;
  /**
   * Estimated cost of the whole conversation since "Demander à l'IA"
   * (clarifications and refinements included); null when a part of it
   * has no known price (compatible servers), or nothing was billed yet.
   */
  conversationCostUsd: number | null;
  /** The answer whose query failed, to open in the editor (review #20). */
  failedDraft: AiPanelDraft | null;
  /** ISO time of a history answer replayed on today's data. */
  replayedAt: string | null;
  /** The user just pressed "Arrêter" (announced once). */
  stopped: boolean;
  /** When the current wait began (Date.now()), while generating. */
  startedAt: number | null;
  /**
   * Bumped each time an answer, a clarification or an error arrives, so
   * the panel moves the focus once per result (review #14).
   */
  runId: number;
  /** The model that answered (the API's name for it). */
  model: string | null;
  /** The provider the question went to. */
  provider: AiProvider | null;
}

const IDLE_STATE: AiPanelState = {
  status: "idle",
  phase: null,
  source: "api",
  question: "",
  answer: null,
  chart: null,
  result: null,
  needsValues: [],
  clarification: null,
  choices: [],
  clarificationContext: null,
  turns: [],
  error: null,
  repairFailed: false,
  repairText: null,
  repaired: false,
  conversationCostUsd: null,
  failedDraft: null,
  replayedAt: null,
  stopped: false,
  startedAt: null,
  runId: 0,
  model: null,
  provider: null,
};

export interface AiAssistantDeps {
  /** The system prompt for a new conversation. */
  buildSystem: (signal: AbortSignal) => Promise<string>;
  ask: (request: AiAskRequest) => Promise<AiAskResponse>;
  run: (
    sql: string,
    values: Record<string, ParamValue>,
    signal: AbortSignal
  ) => Promise<QueryResult>;
  /** The provider and model of the settings, read at each question. */
  getTarget: () => AiTarget;
  getParamContext: () => ParamContext;
  onAnswer: (draft: AiPanelDraft) => void;
  /** An answer of the API or a paste, to remember (review #7). */
  onAnswered?: (answered: AiAnswered) => void;
}

interface AiAssistantController {
  getState: () => AiPanelState;
  subscribe: (listener: () => void) => () => void;
  /** A new question: a new conversation. */
  ask: (question: string) => Promise<void>;
  /** The user's answer to a clarification question. */
  reply: (text: string) => Promise<void>;
  /** A follow-up on the current answer ("seulement les jeunes"). */
  refine: (text: string, currentSql: string) => Promise<void>;
  /** Sends the last request again. */
  retry: () => Promise<void>;
  /** An answer pasted from the user's usual AI. */
  applyPaste: (text: string, question: string) => Promise<boolean>;
  /**
   * A remembered answer, run again on today's data: no API call (review
   * #7). `at`: when it was first answered.
   */
  replay: (question: string, draft: AiDraft, at: string) => Promise<void>;
  /** Hands the failed query to the editor, unverified (review #20). */
  openFailed: () => void;
  cancel: () => void;
  reset: () => void;
  /** Stops what runs, without changing the state shown. */
  dispose: () => void;
}

/** Bound values of the parameters' defaults ("current" season resolved). */
export const defaultValues = (params: ParamDef[], ctx: ParamContext) =>
  resolveParams(params, {}, ctx);

const toAiDraft = (
  answer: AiAnswer & { sql: string },
  chart: ChartSpec,
  question: string
): AiDraft => ({
  title: answer.title || questionTitle(question),
  sql: answer.sql,
  params: answer.params,
  chart,
  explanation: answer.explanation,
  assumptions: answer.assumptions,
});

export const createAiAssistantController = (
  deps: AiAssistantDeps
): AiAssistantController => {
  let state: AiPanelState = IDLE_STATE;
  const listeners = new Set<() => void>();
  let generation = 0;
  let abort: AbortController | null = null;
  /** The conversation of the current question (API source). */
  let system: string | null = null;
  let conversation: AiMessage[] = [];
  /** Messages of the last request, for "Réessayer". */
  let lastRequest: AiMessage[] | null = null;
  /** Running cost of the question; unknown once a part has no price. */
  let cost = { usd: 0, unknown: false, billed: false };

  const set = (next: Partial<AiPanelState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  /** What stays from one step of a conversation to the next. */
  const carried = () => ({
    turns: state.turns,
    conversationCostUsd: state.conversationCostUsd,
    runId: state.runId,
  });
  /** A result arrived: the panel moves the focus to it once. */
  const settled = () => ({ runId: state.runId + 1 });

  const begin = () => {
    abort?.abort();
    abort = new AbortController();
    generation += 1;
    return { id: generation, signal: abort.signal };
  };
  const isCurrent = (id: number) => id === generation;

  const runWithDefaults = (
    sql: string,
    params: ParamDef[],
    signal: AbortSignal
  ) =>
    deps.run(sql, defaultValues(params, deps.getParamContext()).values, signal);

  const missingValues = (params: ParamDef[]) => {
    const { values } = defaultValues(params, deps.getParamContext());
    return params.filter((p) => p.required && values[p.name] === null);
  };

  const addCost = (outcome: AiOutcome, target: AiTarget) => {
    if (outcome.usages.length === 0) return;
    const usd = estimateCostUsd(outcome.usages, target.provider, target.model);
    cost = {
      usd: cost.usd + (usd ?? 0),
      unknown: cost.unknown || usd === null,
      billed: true,
    };
  };
  const costNow = () => (cost.billed && !cost.unknown ? cost.usd : null);

  const finish = (outcome: AiOutcome, question: string, target: AiTarget) => {
    conversation = outcome.messages;
    addCost(outcome, target);
    const provider = target.provider;
    const common = {
      ...IDLE_STATE,
      ...carried(),
      ...settled(),
      question,
      conversationCostUsd: costNow(),
      provider,
    };
    switch (outcome.kind) {
      case "answer": {
        set({
          ...common,
          status: "answer",
          answer: outcome.answer,
          chart: outcome.chart,
          result: outcome.result,
          needsValues: missingValues(outcome.answer.params),
          repaired: outcome.repaired,
          model: outcome.model,
        });
        const draft = toAiDraft(outcome.answer, outcome.chart, question);
        deps.onAnswered?.({
          question,
          draft,
          provider,
          model: outcome.model,
        });
        deps.onAnswer(draft);
        return;
      }
      case "clarification":
        set({
          ...common,
          status: "clarification",
          clarification: outcome.question,
          choices: outcome.answer.choices,
          clarificationContext: outcome.answer.explanation || null,
          model: null,
        });
        return;
      case "error":
        set({
          ...common,
          status: "error",
          error: outcome.error,
          repairFailed: outcome.repairFailed,
          failedDraft: outcome.failedAnswer
            ? failedDraftOf(outcome.failedAnswer, question)
            : null,
        });
        return;
    }
  };

  const converse = async (
    messages: AiMessage[],
    question: string,
    turns: AiTurn[] = state.turns
  ) => {
    const { id, signal } = begin();
    lastRequest = messages;
    const target = deps.getTarget();
    set({
      ...IDLE_STATE,
      ...carried(),
      turns,
      status: "generating",
      phase: "asking",
      startedAt: Date.now(),
      question,
      // Keep the previous answer visible while refining.
      answer: state.answer,
      chart: state.chart,
      result: state.result,
      // …and what was said about it, while the new answer is written.
      model: state.answer ? state.model : null,
      provider: state.answer ? state.provider : null,
      replayedAt: state.answer ? state.replayedAt : null,
      source: state.answer && state.source === "history" ? "history" : "api",
    });
    try {
      system ??= await deps.buildSystem(signal);
    } catch (error) {
      if (!isCurrent(id)) return;
      set({
        ...IDLE_STATE,
        ...carried(),
        ...settled(),
        status: "error",
        question,
        error:
          error instanceof AnalyticsError || error instanceof AiError
            ? error
            : new AiError("internal", String(error)),
      });
      return;
    }
    const systemText = system;
    const outcome = await runAiConversation(messages, {
      ask: (msgs) =>
        deps.ask({
          requestId: uuidv4(),
          provider: target.provider,
          model: target.model,
          effort: "medium",
          system: [{ text: systemText, cache: true }],
          messages: msgs,
          outputSchema: AI_RESPONSE_JSON_SCHEMA,
          maxTokens: AI_MAX_TOKENS,
        }),
      run: (sql, params) => runWithDefaults(sql, params, signal),
      onPhase: (phase) => {
        if (isCurrent(id)) set({ phase });
      },
      lenient: target.provider === "openai_compatible",
    });
    if (!isCurrent(id)) return;
    finish(outcome, question, target);
  };

  const tooLong = (question: string) => {
    if (question.length <= QUESTION_MAX) return false;
    set({
      ...IDLE_STATE,
      ...carried(),
      ...settled(),
      status: "error",
      question: state.question || question,
      error: new AiError("too_large", "Question too long"),
    });
    return true;
  };

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (question === "" || tooLong(question)) return;
    system = null; // fresh context (modules, assets, date)
    conversation = [];
    cost = { usd: 0, unknown: false, billed: false };
    set({
      answer: null,
      chart: null,
      result: null,
      turns: [],
      conversationCostUsd: null,
    });
    await converse([{ role: "user", content: question }], question, []);
  };

  /**
   * Runs a draft that did not come from the API (a paste, a remembered
   * answer) on the read-only engine, then shows it and hands it over.
   */
  const showLocal = async (
    answer: AiAnswer & { sql: string },
    question: string,
    source: Exclude<AiSource, "api">,
    replayedAt: string | null,
    remember: boolean
  ) => {
    const { id, signal } = begin();
    lastRequest = null;
    conversation = [];
    cost = { usd: 0, unknown: false, billed: false };
    const base = {
      ...IDLE_STATE,
      runId: state.runId,
      source,
      question,
      replayedAt,
    };
    set({
      ...base,
      status: "generating",
      phase: "running",
      startedAt: Date.now(),
    });
    try {
      const result = await runWithDefaults(answer.sql, answer.params, signal);
      if (!isCurrent(id)) return;
      const chart = chartForResult(answer.chart, result);
      set({
        ...base,
        ...settled(),
        status: "answer",
        answer,
        chart,
        result,
        needsValues: missingValues(answer.params),
      });
      const draft = toAiDraft(answer, chart, question);
      if (remember) {
        deps.onAnswered?.({ question, draft, provider: null, model: null });
      }
      deps.onAnswer(draft);
    } catch (error) {
      if (!isCurrent(id)) return;
      const failure =
        error instanceof AnalyticsError
          ? error
          : new AiError("internal", String(error));
      set({
        ...base,
        ...settled(),
        status: "error",
        error: failure,
        failedDraft:
          failure instanceof AnalyticsError
            ? failedDraftOf(answer, question)
            : null,
        repairText:
          source === "paste" &&
          failure instanceof AnalyticsError &&
          REPAIRABLE_CODES.has(failure.code)
            ? repairMessage(failure)
            : null,
      });
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    ask,

    async reply(raw) {
      const text = raw.trim();
      if (text === "" || tooLong(text)) return;
      if (conversation.length === 0 || state.status !== "clarification") return;
      await converse(
        [...conversation, { role: "user", content: text }],
        state.question,
        [...state.turns, { kind: "reply", text }]
      );
    },

    async refine(raw, currentSql) {
      const text = raw.trim();
      if (text === "" || tooLong(text)) return;
      const previous = state.answer;
      if (!previous) {
        await ask(text);
        return;
      }
      const turns: AiTurn[] = [...state.turns, { kind: "refine", text }];
      const edited = currentSql.trim();
      const changed = edited !== "" && edited !== previous.sql.trim();
      if (conversation.length === 0) {
        // A remembered answer: a new conversation that starts from it.
        if (state.source === "paste") return;
        system = null;
        cost = { usd: 0, unknown: false, billed: false };
        set({ conversationCostUsd: null });
        await converse(
          [
            {
              role: "user",
              content: `${state.question}\n\nYou already answered this question with this SQL:\n${changed ? edited : previous.sql}\n\nNow: ${text}`,
            },
          ],
          state.question,
          turns
        );
        return;
      }
      const content = changed
        ? `${text}\n\nThe user changed the query in the app's editor since your last answer. Start from this SQL:\n${edited}`
        : text;
      await converse(
        [...conversation, { role: "user", content }],
        state.question,
        turns
      );
    },

    async retry() {
      if (lastRequest && state.source !== "paste") {
        await converse(lastRequest, state.question);
      }
    },

    async applyPaste(text, rawQuestion) {
      const question = rawQuestion.trim();
      const pasted = parsePastedAnswer(text, question);
      if (!pasted.ok) return false;
      const answer = pasted.answer;
      if (!answer.sql) {
        begin();
        lastRequest = null;
        conversation = [];
        set({
          ...IDLE_STATE,
          ...settled(),
          source: "paste",
          status: "clarification",
          question,
          clarification: answer.clarification,
          choices: answer.choices,
          clarificationContext: answer.explanation || null,
        });
        return true;
      }
      await showLocal(
        { ...answer, sql: answer.sql },
        question,
        "paste",
        null,
        true
      );
      return true;
    },

    async replay(question, draft, at) {
      await showLocal(
        {
          title: draft.title,
          explanation: draft.explanation,
          sql: draft.sql,
          params: draft.params,
          chart: draft.chart,
          assumptions: draft.assumptions,
          clarification: null,
          choices: [],
        },
        question,
        "history",
        at,
        false
      );
    },

    openFailed() {
      if (state.failedDraft) deps.onAnswer(state.failedDraft);
    },

    cancel() {
      abort?.abort();
      abort = null;
      generation += 1;
      set({
        ...IDLE_STATE,
        ...carried(),
        source: state.source,
        question: state.question,
        stopped: true,
        // A refinement that is stopped leaves the previous answer.
        ...(state.answer && state.result && state.chart
          ? {
              status: "answer" as const,
              answer: state.answer,
              chart: state.chart,
              result: state.result,
              needsValues: state.needsValues,
              repaired: state.repaired,
              model: state.model,
              provider: state.provider,
              replayedAt: state.replayedAt,
            }
          : {}),
      });
    },

    reset() {
      abort?.abort();
      abort = null;
      generation += 1;
      system = null;
      conversation = [];
      lastRequest = null;
      cost = { usd: 0, unknown: false, billed: false };
      set({ ...IDLE_STATE, runId: state.runId });
    },

    dispose() {
      abort?.abort();
      abort = null;
      generation += 1;
    },
  };
};

/** The draft of an answer whose query failed: opened, never run alone. */
const failedDraftOf = (
  answer: AiAnswer & { sql: string },
  question: string
): AiPanelDraft => ({
  ...toAiDraft(answer, answer.chart ?? { type: "table" }, question),
  unverified: true,
});
