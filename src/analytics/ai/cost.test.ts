import { describe, expect, it } from "vitest";
import {
  estimateCostUsd,
  formatCostUsd,
  hasKnownPrice,
  typicalQuestionCostUsd,
} from "./cost";

const usage = (
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0
) => ({
  inputTokens,
  outputTokens,
  cacheReadInputTokens,
  cacheCreationInputTokens,
});

describe("estimateCostUsd", () => {
  it("prices Opus 5.5 input, output, cache reads and writes", () => {
    const cost = estimateCostUsd(
      [{ usage: usage(1000, 1000, 10_000, 10_000), model: "claude-opus-5-5" }],
      "anthropic",
      "claude-opus-5-5"
    );
    // 1k × 4 + 1k × 20 + 10k × 0.2 + 10k × 5, per million.
    expect(cost).toBeCloseTo((4000 + 20_000 + 2000 + 50_000) / 1e6, 10);
  });

  it("adds every turn and uses the model that answered", () => {
    const cost = estimateCostUsd(
      [
        { usage: usage(1_000_000, 0), model: "claude-haiku-5-5" },
        { usage: usage(1_000_000, 0), model: "claude-sonnet-5-5" },
      ],
      "anthropic",
      "claude-opus-5-5"
    );
    expect(cost).toBeCloseTo(0.1 + 2, 10);
  });

  it("falls back on the requested model for unknown names", () => {
    expect(
      estimateCostUsd(
        [{ usage: usage(0, 1_000_000), model: "claude-x" }],
        "anthropic",
        "claude-sonnet-5-5"
      )
    ).toBeCloseTo(10, 10);
  });

  it("prices OpenAI models, dated snapshots included", () => {
    const cost = estimateCostUsd(
      [
        {
          usage: usage(1000, 1000, 10_000, 1000),
          model: "gpt-6.1-sol-2026-09-29",
        },
      ],
      "openai",
      "gpt-6.1-sol"
    );
    // 1k × 2 + 1k × 10 + 10k × 0.10 + 1k × 2.5, per million.
    expect(cost).toBeCloseTo((2000 + 10_000 + 1000 + 2500) / 1e6, 10);
    expect(
      estimateCostUsd(
        [{ usage: usage(1_000_000, 0), model: "gpt-6-astra" }],
        "openai",
        "gpt-6-astra"
      )
    ).toBeCloseTo(10, 10);
    expect(
      estimateCostUsd(
        [{ usage: usage(0, 1_000_000), model: "gpt-6-luna" }],
        "openai",
        "gpt-6-luna"
      )
    ).toBeCloseTo(0.5, 10);
  });

  it("gives no cost where prices are unknown", () => {
    expect(
      estimateCostUsd(
        [{ usage: usage(1000, 1000), model: "mistral-large-2411" }],
        "openai_compatible",
        "mistral-large-latest"
      )
    ).toBeNull();
    // Even a compatible server that serves an OpenAI model name.
    expect(hasKnownPrice("openai_compatible", "gpt-6-luna")).toBe(false);
    expect(
      estimateCostUsd(
        [{ usage: usage(1000, 1000), model: "gpt-9" }],
        "openai",
        "gpt-9"
      )
    ).toBeNull();
    expect(hasKnownPrice("openai", "gpt-6-astra")).toBe(true);
  });

  it("estimates a usual question for the settings", () => {
    expect(typicalQuestionCostUsd("anthropic", "claude-opus-5-5")).toBeCloseTo(
      (1000 * 4 + 2500 * 20 + 14_000 * 0.2) / 1e6,
      10
    );
    expect(typicalQuestionCostUsd("openai_compatible", "llama3.3")).toBeNull();
  });
});

describe("formatCostUsd", () => {
  it("formats in French and English", () => {
    expect(formatCostUsd(0.034, "fr-FR")).toBe("0,03 $");
    expect(formatCostUsd(0.034, "en-US")).toBe("$0.03");
    expect(formatCostUsd(1.5, "de-DE")).toBe("1,50 $");
  });

  it("shows tiny costs as less than a cent", () => {
    expect(formatCostUsd(0.0004, "fr-FR")).toBe("< 0,01 $");
    expect(formatCostUsd(0, "en-GB")).toBe("< $0.01");
  });
});
