import {
  AI_MODELS,
  AiModel,
  AiProvider,
  OPENAI_MODELS,
  OpenAiModel,
} from "../engine/ipc";

/**
 * Providers and models of the assistant (ADR 0008, "AI providers"):
 * display names, settings labels, and what a question is sent to.
 */

/** What answers a question: a provider and one of its models. */
export interface AiTarget {
  provider: AiProvider;
  /** AiModel, OpenAiModel, or the compatible server's model name. */
  model: string;
}

/** Display names of the selectable models. */
export const MODEL_NAMES: Record<AiModel | OpenAiModel, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6.1-terra": "GPT-6.1 Terra",
  "gpt-6-luna": "GPT-6 Luna",
};

export const MODEL_LABEL_KEYS: Record<AiModel | OpenAiModel, string> = {
  "claude-opus-5-5": "analytics.settings.ai.models.opus",
  "claude-sonnet-5-5": "analytics.settings.ai.models.sonnet",
  "claude-haiku-5-5": "analytics.settings.ai.models.haiku",
  "gpt-6-astra": "analytics.settings.ai.models.astra",
  "gpt-6.1-sol": "analytics.settings.ai.models.sol",
  "gpt-6.1-terra": "analytics.settings.ai.models.terra",
  "gpt-6-luna": "analytics.settings.ai.models.luna",
};

/** The allowlist of a provider; [] for a compatible server (free text). */
export const modelsOf = (
  provider: AiProvider
): readonly (AiModel | OpenAiModel)[] =>
  provider === "anthropic"
    ? AI_MODELS
    : provider === "openai"
      ? OPENAI_MODELS
      : [];

const KNOWN = [...AI_MODELS, ...OPENAI_MODELS].sort(
  (a, b) => b.length - a.length
);

/**
 * "Claude Opus 5.5" for an id the API returned (it may be a dated
 * snapshot or a fallback model); any other name as it is.
 */
export const modelName = (id: string): string => {
  const known = KNOWN.find((model) => id.startsWith(model));
  return known ? MODEL_NAMES[known] : id;
};

/** "Anthropic", "OpenAI"; a compatible server is named by its host. */
export const providerName = (
  provider: AiProvider,
  baseUrl?: string | null
): string | null => {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "openai") return "OpenAI";
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
};

/** Where to create a key; null for a compatible server. */
export const KEY_CONSOLE_URLS: Record<AiProvider, string | null> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  openai_compatible: null,
};
