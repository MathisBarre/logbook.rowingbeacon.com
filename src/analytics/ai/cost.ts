import type { AiProvider, AiUsage } from "../engine/ipc";

/**
 * Cost line of an answer (plan 2.11): usage × a static price table, in US
 * dollars per million tokens. It is an estimate: shown as "≈ 0,03 $
 * (estimation)", and only for models whose price is known:
 *
 * - Anthropic, prices checked 2026-10-29 (claude-api skill);
 * - OpenAI, developers.openai.com/api/docs/pricing checked 2026-10-29
 *   (standard tier, short context, 30-minute cache writes);
 * - an OpenAI-compatible server: unknown (its own prices, or free when
 *   local), so no cost line at all.
 */

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes: 1.25 × input at both providers (5 min / 30 min). */
  cacheWrite: number;
}

const price = (input: number, output: number, cacheRead: number): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": price(4, 20, 0.2),
  "claude-sonnet-5-5": price(2, 10, 0.2),
  "claude-haiku-5-5": price(0.1, 0.5, 0.01),
  "gpt-6-astra": price(10, 50, 1),
  "gpt-6.1-sol": price(2, 10, 0.1),
  "gpt-6.1-terra": price(1, 5, 0.05),
  "gpt-6-luna": price(0.1, 0.5, 0.01),
};

const PRICED_PROVIDERS: ReadonlySet<AiProvider> = new Set([
  "anthropic",
  "openai",
]);

/** Longest id first, so "gpt-6.1-sol" never matches a shorter id. */
const PRICED_MODELS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

/** The price of a model id (dated snapshots included), if known. */
const knownPrice = (model: string): Price | null => {
  const id = PRICED_MODELS.find((known) => model.startsWith(known));
  return id ? PRICES[id] : null;
};

/** Whether answers of this provider and model get a cost line. */
export const hasKnownPrice = (provider: AiProvider, model: string) =>
  PRICED_PROVIDERS.has(provider) && knownPrice(model) !== null;

/**
 * Price of the model that answered: the response names it (a server-side
 * fallback may answer with another model); unknown names use the model
 * that was asked. Null when no price is known.
 */
export const estimateCostUsd = (
  usages: { usage: AiUsage; model: string }[],
  provider: AiProvider,
  asked: string
): number | null => {
  if (!PRICED_PROVIDERS.has(provider)) return null;
  let total = 0;
  for (const { usage, model } of usages) {
    const p = knownPrice(model) ?? knownPrice(asked);
    if (!p) return null;
    total +=
      (usage.inputTokens * p.input +
        usage.outputTokens * p.output +
        usage.cacheReadInputTokens * p.cacheRead +
        usage.cacheCreationInputTokens * p.cacheWrite) /
      1_000_000;
  }
  return total;
};

/**
 * A usual question once the system prompt is cached: about 14,000 tokens
 * read from the cache, 1,000 new ones, 2,500 written (thinking included).
 */
const TYPICAL_QUESTION: AiUsage = {
  inputTokens: 1_000,
  outputTokens: 2_500,
  cacheReadInputTokens: 14_000,
  cacheCreationInputTokens: 0,
};

/** The settings' "≈ 0,06 $ per question", or null without a price. */
export const typicalQuestionCostUsd = (
  provider: AiProvider,
  model: string
): number | null =>
  estimateCostUsd([{ usage: TYPICAL_QUESTION, model }], provider, model);

/** "0,03 $" in French, "$0.03" in English; "< 0,01 $" for tiny costs. */
export const formatCostUsd = (usd: number, locale: string): string => {
  const english = locale.toLowerCase().startsWith("en");
  const tiny = usd < 0.01;
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(tiny ? 0.01 : usd);
  const money = english ? `$${amount}` : `${amount} $`;
  return tiny ? `< ${money}` : money;
};
