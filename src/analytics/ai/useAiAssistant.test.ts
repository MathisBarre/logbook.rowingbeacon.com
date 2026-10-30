import { describe, expect, it, vi } from "vitest";
import { AnalyticsError } from "../engine/errors";
import type { AiAskRequest, AiAskResponse } from "../engine/ipc";
import type { AiDraft, QueryResult } from "../types";
import { AI_RESPONSE_JSON_SCHEMA } from "./aiSchema";
import { AiAssistantDeps, createAiAssistantController } from "./useAiAssistant";
import answerBar from "./fixtures/answer-bar.json";
import clarification from "./fixtures/clarification.json";

const RESULT: QueryResult = {
  columns: [
    { name: "boat_name", declType: null },
    { name: "outings", declType: null },
  ],
  rows: [["Albatros", 12]],
  truncated: false,
  elapsedMs: 3,
  ignoredColumns: [],
  cached: false,
};

const reply = (body: unknown): AiAskResponse => ({
  text: JSON.stringify(body),
  stopReason: "end_turn",
  model: "claude-opus-5-5",
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
});

const setup = (overrides: Partial<AiAssistantDeps> = {}) => {
  const answers: AiDraft[] = [];
  const deps: AiAssistantDeps = {
    buildSystem: vi.fn().mockResolvedValue("SYSTEM"),
    ask: vi.fn().mockResolvedValue(reply(answerBar)),
    run: vi.fn().mockResolvedValue(RESULT),
    getTarget: () => ({ provider: "anthropic", model: "claude-sonnet-5-5" }),
    getParamContext: () => ({ now: "2025-11-04T10:00", seasonStartMonth: 8 }),
    onAnswer: (draft) => answers.push(draft),
    ...overrides,
  };
  return { controller: createAiAssistantController(deps), deps, answers };
};

describe("AI assistant controller", () => {
  it("asks, runs the SQL with default values, then hands the draft over", async () => {
    const { controller, deps, answers } = setup();
    const states: string[] = [];
    controller.subscribe(() => states.push(controller.getState().status));
    await controller.ask("  Quels bateaux sortent le plus le week-end ?  ");

    const request = (deps.ask as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as AiAskRequest;
    expect(request).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: "medium",
      system: [{ text: "SYSTEM", cache: true }],
      messages: [
        {
          role: "user",
          content: "Quels bateaux sortent le plus le week-end ?",
        },
      ],
      maxTokens: 16_000,
    });
    expect(request.outputSchema).toBe(AI_RESPONSE_JSON_SCHEMA);
    // "current" season resolved before the run.
    expect(deps.run).toHaveBeenCalledWith(
      answerBar.sql,
      { season: 2025 },
      expect.any(AbortSignal)
    );

    const state = controller.getState();
    expect(state.status).toBe("answer");
    expect(state.result).toBe(RESULT);
    // Priced as the model that answered (Opus), not the one asked.
    expect(state.conversationCostUsd).toBeCloseTo(
      (1000 * 4 + 500 * 20) / 1e6,
      10
    );
    expect(states).toContain("generating");
    expect(answers).toEqual([
      expect.objectContaining({
        title: answerBar.title,
        sql: answerBar.sql,
        explanation: answerBar.explanation,
      }),
    ]);
  });

  it("sends the question to OpenAI with the same schema and prices it", async () => {
    const { controller, deps } = setup({
      getTarget: () => ({ provider: "openai", model: "gpt-6.1-sol" }),
      ask: vi.fn().mockResolvedValue({
        ...reply(answerBar),
        stopReason: "completed",
        model: "gpt-6.1-sol-2026-09-29",
      }),
    });
    await controller.ask("Quels bateaux sortent le plus ?");
    const request = (deps.ask as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as AiAskRequest;
    expect(request).toMatchObject({ provider: "openai", model: "gpt-6.1-sol" });
    expect(request.outputSchema).toBe(AI_RESPONSE_JSON_SCHEMA);
    const state = controller.getState();
    expect(state).toMatchObject({
      status: "answer",
      provider: "openai",
      model: "gpt-6.1-sol-2026-09-29",
    });
    expect(state.conversationCostUsd).toBeCloseTo(
      (1000 * 2 + 500 * 10) / 1e6,
      10
    );
  });

  it("reads a compatible server's loose JSON and shows no cost", async () => {
    const loose = {
      title: "Bateaux",
      sql: answerBar.sql,
      params: answerBar.params,
      chart: { type: "bar", x: "boat_name", y: ["outings"] },
    };
    const { controller, answers } = setup({
      getTarget: () => ({
        provider: "openai_compatible",
        model: "llama3.3",
      }),
      ask: vi.fn().mockResolvedValue({
        ...reply(loose),
        text: "```json\n" + JSON.stringify(loose) + "\n```",
        model: "llama3.3",
      }),
    });
    await controller.ask("Quels bateaux sortent le plus ?");
    expect(controller.getState()).toMatchObject({
      status: "answer",
      provider: "openai_compatible",
      conversationCostUsd: null,
    });
    expect(answers).toHaveLength(1);
  });

  it("keeps strict reading for Anthropic and OpenAI", async () => {
    const { controller } = setup({
      ask: vi
        .fn()
        .mockResolvedValue({ ...reply({}), text: '{"sql":"SELECT 1"}' }),
    });
    await controller.ask("Une question");
    expect(controller.getState().error).toMatchObject({
      code: "invalid_response",
    });
  });

  it("never hands over SQL that failed in the engine", async () => {
    const { controller, answers } = setup({
      run: vi
        .fn()
        .mockRejectedValue(
          new AnalyticsError({ code: "timeout", message: "interrupted" })
        ),
    });
    await controller.ask("Une question");
    expect(controller.getState().status).toBe("error");
    expect(answers).toEqual([]);
  });

  it("rejects a question over 2,000 characters without calling the API", async () => {
    const { controller, deps } = setup();
    await controller.ask("x".repeat(2001));
    expect(controller.getState()).toMatchObject({ status: "error" });
    expect(controller.getState().error).toMatchObject({ code: "too_large" });
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.buildSystem).not.toHaveBeenCalled();
  });

  it("ignores an empty question", async () => {
    const { controller, deps } = setup();
    await controller.ask("   ");
    expect(controller.getState().status).toBe("idle");
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("continues the conversation after a clarification", async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(reply(clarification))
      .mockResolvedValueOnce(reply(answerBar));
    const { controller, deps } = setup({ ask });
    await controller.ask("Fréquentation du mardi soir");
    expect(controller.getState()).toMatchObject({
      status: "clarification",
      clarification: clarification.clarification,
    });
    expect(deps.run).not.toHaveBeenCalled();

    await controller.reply("Les rameurs");
    const second = ask.mock.calls[1][0] as AiAskRequest;
    expect(second.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(second.messages[1].content).toBe(JSON.stringify(clarification));
    expect(second.messages[2].content).toBe("Les rameurs");
    expect(controller.getState().status).toBe("answer");
    // The system prompt is built once per question.
    expect(deps.buildSystem).toHaveBeenCalledTimes(1);
  });

  it("sends the edited SQL with a refinement", async () => {
    const { controller, deps } = setup();
    await controller.ask("Quels bateaux ?");
    await controller.refine("Seulement les yolettes", "SELECT 1 AS edited");
    const second = (deps.ask as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as AiAskRequest;
    expect(second.messages).toHaveLength(3);
    expect(second.messages[2].content).toContain("Seulement les yolettes");
    expect(second.messages[2].content).toContain("SELECT 1 AS edited");

    await controller.refine("Par mois", answerBar.sql);
    const third = (deps.ask as ReturnType<typeof vi.fn>).mock
      .calls[2][0] as AiAskRequest;
    expect(third.messages[third.messages.length - 1].content).toBe("Par mois");
  });

  it("cancels: a late answer is ignored", async () => {
    let resolve: (value: AiAskResponse) => void = () => undefined;
    const ask = vi.fn(() => new Promise<AiAskResponse>((r) => (resolve = r)));
    const { controller, answers } = setup({ ask });
    const pending = controller.ask("Une question");
    await Promise.resolve();
    await Promise.resolve();
    controller.cancel();
    expect(controller.getState().status).toBe("idle");
    resolve(reply(answerBar));
    await pending;
    expect(controller.getState().status).toBe("idle");
    expect(answers).toEqual([]);
  });

  it("reports a failure to build the prompt", async () => {
    const { controller } = setup({
      buildSystem: vi
        .fn()
        .mockRejectedValue(
          new AnalyticsError({ code: "desktop_only", message: "no" })
        ),
    });
    await controller.ask("Une question");
    expect(controller.getState().error).toMatchObject({ code: "desktop_only" });
  });

  it("retries the last request", async () => {
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(reply(answerBar));
    const { controller } = setup({ ask });
    await controller.ask("Une question");
    expect(controller.getState().status).toBe("error");
    await controller.retry();
    expect(controller.getState().status).toBe("answer");
    expect(ask.mock.calls[1][0]).toMatchObject({
      messages: [{ role: "user", content: "Une question" }],
    });
  });

  describe("pasted answers", () => {
    it("runs a pasted answer before handing it over", async () => {
      const { controller, deps, answers } = setup();
      expect(
        await controller.applyPaste(JSON.stringify(answerBar), "Bateaux")
      ).toBe(true);
      expect(deps.ask).not.toHaveBeenCalled();
      expect(deps.run).toHaveBeenCalledTimes(1);
      expect(controller.getState()).toMatchObject({
        status: "answer",
        source: "paste",
      });
      expect(answers).toHaveLength(1);
    });

    it("rejects unrecognised text and keeps the state", async () => {
      const { controller } = setup();
      expect(await controller.applyPaste("bonjour", "Bateaux")).toBe(false);
      expect(controller.getState().status).toBe("idle");
    });

    it("offers the error text for claude.ai when the pasted SQL fails", async () => {
      const { controller, answers } = setup({
        run: vi
          .fn()
          .mockRejectedValue(
            new AnalyticsError(
              { code: "syntax", message: "near x", offset: 0 },
              { sql: "SELECT x" }
            )
          ),
      });
      await controller.applyPaste("```sql\nSELECT x\n```", "Bateaux");
      expect(controller.getState()).toMatchObject({
        status: "error",
        source: "paste",
      });
      expect(controller.getState().repairText).toContain(
        "The query failed in the app: syntax: near x"
      );
      expect(answers).toEqual([]);
    });

    it("shows a pasted clarification", async () => {
      const { controller } = setup();
      await controller.applyPaste(JSON.stringify(clarification), "Mardi");
      expect(controller.getState()).toMatchObject({
        status: "clarification",
        source: "paste",
      });
    });
  });

  it("lists required parameters that have no value", async () => {
    const withRower = {
      ...answerBar,
      sql: "SELECT COUNT(*) AS outings FROM v_outing_rowers WHERE rower_id = :rower_id",
      params: [
        {
          name: "rower_id",
          type: "rower",
          label: "Rameur",
          required: true,
          default: null,
          options: [],
          min: null,
          max: null,
        },
      ],
    };
    const { controller } = setup({
      ask: vi.fn().mockResolvedValue(reply(withRower)),
    });
    await controller.ask("Sorties d'un rameur");
    expect(controller.getState().needsValues.map((p) => p.name)).toEqual([
      "rower_id",
    ]);
  });

  describe("conversation memory (review #6, #17, #20)", () => {
    it("keeps the replies and refinements, and sums the cost", async () => {
      const ask = vi
        .fn()
        .mockResolvedValueOnce(reply(clarification))
        .mockResolvedValueOnce(reply(answerBar))
        .mockResolvedValueOnce(reply(answerBar))
        .mockResolvedValueOnce(reply(answerBar));
      const { controller } = setup({ ask });
      await controller.ask("Combien le mardi ?");
      const first = controller.getState();
      expect(first.choices).toEqual(["Les sorties", "Les rameurs présents"]);
      expect(first.conversationCostUsd).toBeGreaterThan(0);
      const oneTurn = first.conversationCostUsd ?? 0;

      await controller.reply("Les sorties");
      await controller.refine("seulement les bateaux de couple", "");
      const state = controller.getState();
      expect(state.question).toBe("Combien le mardi ?");
      expect(state.turns).toEqual([
        { kind: "reply", text: "Les sorties" },
        { kind: "refine", text: "seulement les bateaux de couple" },
      ]);
      expect(state.conversationCostUsd).toBeCloseTo(oneTurn * 3);

      await controller.ask("Autre question");
      expect(controller.getState().turns).toEqual([]);
      expect(controller.getState().conversationCostUsd).toBeCloseTo(oneTurn);
    });

    it("keeps the cost and the turns while a refinement runs", async () => {
      let release: (value: AiAskResponse) => void = () => undefined;
      const ask = vi
        .fn()
        .mockResolvedValueOnce(reply(answerBar))
        .mockImplementationOnce(
          () => new Promise<AiAskResponse>((resolve) => (release = resolve))
        );
      const { controller } = setup({ ask });
      await controller.ask("Bateaux du week-end");
      const pending = controller.refine("par mois", "");
      await Promise.resolve();
      const during = controller.getState();
      expect(during.status).toBe("generating");
      expect(during.conversationCostUsd).toBeGreaterThan(0);
      expect(during.turns).toEqual([{ kind: "refine", text: "par mois" }]);
      expect(during.startedAt).not.toBeNull();
      release(reply(answerBar));
      await pending;
      expect(controller.getState().status).toBe("answer");
    });

    it("keeps a failed query to open, unverified, in the editor", async () => {
      const run = vi
        .fn()
        .mockRejectedValue(
          new AnalyticsError({ code: "denied", message: "no", object: "x" }, {})
        );
      const { controller, answers } = setup({ run });
      await controller.ask("Bateaux");
      const state = controller.getState();
      expect(state.status).toBe("error");
      expect(state.failedDraft).toMatchObject({
        sql: answerBar.sql,
        unverified: true,
      });
      controller.openFailed();
      expect(answers).toEqual([state.failedDraft]);
    });

    it("bumps the run id once per result, and says when stopped", async () => {
      const { controller } = setup();
      const before = controller.getState().runId;
      await controller.ask("Bateaux");
      expect(controller.getState().runId).toBe(before + 1);
      const pending = controller.refine("par mois", "");
      controller.cancel();
      await pending;
      expect(controller.getState()).toMatchObject({
        status: "answer",
        stopped: true,
        runId: before + 1,
      });
    });
  });

  describe("history (review #7)", () => {
    it("remembers API and pasted answers", async () => {
      const onAnswered = vi.fn();
      const { controller } = setup({ onAnswered });
      await controller.ask("Bateaux du week-end");
      expect(onAnswered).toHaveBeenLastCalledWith(
        expect.objectContaining({
          question: "Bateaux du week-end",
          provider: "anthropic",
          model: "claude-opus-5-5",
        })
      );
      await controller.applyPaste(JSON.stringify(answerBar), "Collé");
      expect(onAnswered).toHaveBeenCalledTimes(2);
    });

    it("replays a remembered answer on today's data without the AI", async () => {
      const onAnswered = vi.fn();
      const { controller, deps, answers } = setup({ onAnswered });
      const draft = {
        title: "Bateaux",
        sql: answerBar.sql,
        params: [],
        chart: { type: "table" as const },
        explanation: "Compte.",
        assumptions: ["Week-end"],
      };
      await controller.replay("Bateaux ?", draft, "2026-05-12T10:00:00Z");
      expect(deps.ask).not.toHaveBeenCalled();
      expect(onAnswered).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({
        status: "answer",
        source: "history",
        replayedAt: "2026-05-12T10:00:00Z",
        question: "Bateaux ?",
      });
      expect(answers).toHaveLength(1);
      // Refining a replay starts a conversation from its SQL.
      await controller.refine("par mois", "");
      const request = (deps.ask as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as AiAskRequest;
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].content).toContain(answerBar.sql);
      expect(request.messages[0].content).toContain("par mois");
    });
  });
});
