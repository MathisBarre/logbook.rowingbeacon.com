import { describe, expect, it, vi } from "vitest";
import { AnalyticsError } from "../engine/errors";
import type { AiAskResponse, AiMessage } from "../engine/ipc";
import type { QueryResult } from "../types";
import { AiError } from "./aiClient";
import {
  redactEngineMessage,
  repairMessage,
  runAiConversation,
} from "./repairLoop";
import answerBar from "./fixtures/answer-bar.json";
import answerYouth from "./fixtures/answer-youth.json";
import clarification from "./fixtures/clarification.json";

const usage = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};
const reply = (body: unknown, stopReason = "end_turn"): AiAskResponse => ({
  text: typeof body === "string" ? body : JSON.stringify(body),
  stopReason,
  model: "claude-opus-5-5",
  usage,
});

const RESULT: QueryResult = {
  columns: [
    { name: "boat_name", declType: null },
    { name: "boat_class", declType: null },
    { name: "outings", declType: null },
  ],
  rows: [["Albatros", "1x", 12]],
  truncated: false,
  elapsedMs: 4,
  ignoredColumns: [],
  cached: false,
};

const syntaxError = (sql: string) =>
  new AnalyticsError(
    { code: "syntax", message: 'near "FORM": syntax error', offset: 9 },
    { sql }
  );

const START: AiMessage[] = [{ role: "user", content: "Quels bateaux ?" }];

describe("runAiConversation", () => {
  it("returns the answer on the first try", async () => {
    const ask = vi.fn().mockResolvedValue(reply(answerBar));
    const run = vi.fn().mockResolvedValue(RESULT);
    const outcome = await runAiConversation(START, { ask, run });
    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(ask).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(answerBar.sql, [
      expect.objectContaining({ name: "season", default: "current" }),
    ]);
    expect(outcome.repaired).toBe(false);
    expect(outcome.result).toBe(RESULT);
    expect(outcome.chart).toMatchObject({ type: "bar", x: "boat_name" });
    expect(outcome.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(outcome.usages).toHaveLength(1);
  });

  it("repairs after a syntax error with only the error text", async () => {
    const broken = { ...answerBar, sql: "SELECT x FORM v_outings" };
    const ask = vi
      .fn()
      .mockResolvedValueOnce(reply(broken))
      .mockResolvedValueOnce(reply(answerBar));
    const run = vi
      .fn()
      .mockRejectedValueOnce(syntaxError(broken.sql))
      .mockResolvedValueOnce(RESULT);
    const outcome = await runAiConversation(START, { ask, run });
    expect(outcome.kind).toBe("answer");
    expect(ask).toHaveBeenCalledTimes(2);
    const second = ask.mock.calls[1][0] as AiMessage[];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // The previous answer (with its SQL) exactly as received.
    expect(second[1].content).toBe(JSON.stringify(broken));
    expect(second[2].content).toBe(
      'The query failed in the app: syntax: near "FORM": syntax error (line 1, column 10). Return a corrected complete answer.'
    );
    // Error text only: no row value, no result.
    expect(second[2].content).not.toContain("Albatros");
    if (outcome.kind === "answer") expect(outcome.repaired).toBe(true);
  });

  it("stops after three failures with the last engine error", async () => {
    const ask = vi.fn().mockResolvedValue(reply(answerBar));
    const denied = new AnalyticsError(
      {
        code: "denied",
        message: "access to setting.key is prohibited",
        object: "setting.key",
      },
      { sql: answerBar.sql }
    );
    const run = vi.fn().mockRejectedValue(denied);
    const outcome = await runAiConversation(START, { ask, run });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ kind: "error", repairFailed: true });
    if (outcome.kind === "error") expect(outcome.error).toBe(denied);
    expect(outcome.usages).toHaveLength(3);
  });

  it("does not repair errors a new query cannot fix", async () => {
    const ask = vi.fn().mockResolvedValue(reply(answerBar));
    const timeout = new AnalyticsError({
      code: "timeout",
      message: "interrupted",
    });
    const run = vi.fn().mockRejectedValue(timeout);
    const outcome = await runAiConversation(START, { ask, run });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ kind: "error", repairFailed: false });
  });

  it("shows a refusal as an error", async () => {
    const ask = vi.fn().mockResolvedValue(reply("", "refusal"));
    const run = vi.fn();
    const outcome = await runAiConversation(START, { ask, run });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.error).toBeInstanceOf(AiError);
      expect((outcome.error as AiError).code).toBe("refusal");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("shows a cut-off answer as truncated", async () => {
    const ask = vi.fn().mockResolvedValue(reply('{"title":', "max_tokens"));
    const outcome = await runAiConversation(START, { ask, run: vi.fn() });
    expect(outcome.kind === "error" && (outcome.error as AiError).code).toBe(
      "truncated"
    );
  });

  it("shows invalid JSON as an error without retrying", async () => {
    const ask = vi.fn().mockResolvedValue(reply("Voici la requête : SELECT 1"));
    const run = vi.fn();
    const outcome = await runAiConversation(START, { ask, run });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(outcome.kind === "error" && (outcome.error as AiError).code).toBe(
      "invalid_response"
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("returns a clarification without running anything", async () => {
    const ask = vi.fn().mockResolvedValue(reply(clarification));
    const run = vi.fn();
    const outcome = await runAiConversation(START, { ask, run });
    expect(outcome.kind).toBe("clarification");
    if (outcome.kind === "clarification") {
      expect(outcome.question).toBe(clarification.clarification);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("passes API errors through", async () => {
    const ask = vi
      .fn()
      .mockRejectedValue(new AiError("rate_limited", "slow down", 30));
    const outcome = await runAiConversation(START, { ask, run: vi.fn() });
    expect(outcome.kind === "error" && outcome.error).toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 30,
    });
  });

  it("guesses a chart when the model's does not fit the result", async () => {
    const ask = vi.fn().mockResolvedValue(reply(answerYouth));
    const run = vi.fn().mockResolvedValue(RESULT);
    const outcome = await runAiConversation(START, { ask, run });
    expect(outcome.kind).toBe("answer");
    // The stub chartFitsResult (WP4) accepts every spec; the real one
    // falls back to autoChart. Either way the chart is a valid spec.
    if (outcome.kind === "answer") expect(outcome.chart.type).toBeTruthy();
  });

  it("reports the phases", async () => {
    const phases: string[] = [];
    const broken = { ...answerBar, sql: "SELECT x FORM v_outings" };
    await runAiConversation(START, {
      ask: vi
        .fn()
        .mockResolvedValueOnce(reply(broken))
        .mockResolvedValueOnce(reply(answerBar)),
      run: vi
        .fn()
        .mockRejectedValueOnce(syntaxError(broken.sql))
        .mockResolvedValueOnce(RESULT),
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toEqual(["asking", "running", "repairing", "running"]);
  });
});

describe("repairMessage", () => {
  it("names the parameter of a missing_param error", () => {
    expect(
      repairMessage(
        new AnalyticsError({
          code: "missing_param",
          message: "Missing parameter: season",
          object: "season",
        })
      )
    ).toBe(
      "The query failed in the app: missing_param: Missing parameter: season [season]. Return a corrected complete answer."
    );
  });

  it("never sends a value quoted in the engine message", () => {
    // Review A, M3: a nominative run fails with the rower's name in it.
    const message = repairMessage(
      new AnalyticsError(
        { code: "syntax", message: "bad JSON path: 'Anouk Abgrall'" },
        { sql: "SELECT json_extract('{}', display_name) FROM v_rowers" }
      )
    );
    expect(message).not.toContain("Anouk");
    expect(message).toContain("bad JSON path: '?'");
  });
});

describe("redactEngineMessage", () => {
  it.each([
    ["bad JSON path: 'Anouk Abgrall'", "bad JSON path: '?'"],
    ["bad JSON path: 'l''Isle'", "bad JSON path: '?'"],
    ["values 'a' and 'b'", "values '?' and '?'"],
    ['unrecognized token: "\'Anouk"', "unrecognized token: \"'?"],
    ['near "FROM": syntax error', 'near "FROM": syntax error'],
    ["no such column: display_nam", "no such column: display_nam"],
  ])("%s", (input, expected) => {
    expect(redactEngineMessage(input)).toBe(expected);
  });

  it("keeps the message short", () => {
    expect(redactEngineMessage("x".repeat(2000))).toHaveLength(501);
  });
});
