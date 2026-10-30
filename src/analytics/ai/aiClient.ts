import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import {
  AI_ERROR_CODES,
  ANALYTICS_COMMANDS,
  AiAskRequest,
  AiAskResponse,
  AiErrorCode,
  AiKeyTest,
  AiProvider,
  KeyStatus,
  McpInfo,
} from "../engine/ipc";

/**
 * The AI and MCP commands of the Rust side (plan 2.2, 2.11-2.13, ADR 0008
 * "AI providers"). A key never comes back to the webview: only its status
 * (and, for a compatible server, the address saved with it).
 */

/** Codes of the API proxy plus the ones the UI adds. */
type AiUiErrorCode =
  | AiErrorCode
  | "invalid_response"
  | "repair_failed"
  | "desktop_only"
  | "internal";

export class AiError extends Error {
  readonly code: AiUiErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AiUiErrorCode,
    message: string,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const isAiErrorCode = (value: unknown): value is AiErrorCode =>
  typeof value === "string" &&
  (AI_ERROR_CODES as readonly string[]).includes(value);

/** Anything an `analytics_ai_*` command rejects with, as an AiError. */
export const toAiError = (error: unknown): AiError => {
  if (error instanceof AiError) {
    return error;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code, message, retryAfterSeconds } = error as Record<
      string,
      unknown
    >;
    const text = typeof message === "string" ? message : String(code);
    if (isAiErrorCode(code)) {
      return new AiError(
        code,
        text,
        typeof retryAfterSeconds === "number" ? retryAfterSeconds : null
      );
    }
    if (code === "desktop_only") {
      return new AiError("desktop_only", text);
    }
    return new AiError("internal", text);
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return new AiError("internal", message);
};

const call = async <T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  if (!isTauri()) {
    throw new AiError(
      "desktop_only",
      "The AI assistant needs the installed application"
    );
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toAiError(error);
  }
};

export const aiAsk = (request: AiAskRequest) =>
  call<AiAskResponse>(ANALYTICS_COMMANDS.aiAsk, { request });

export const aiKeyStatus = (provider: AiProvider = "anthropic") =>
  call<KeyStatus>(ANALYTICS_COMMANDS.aiKeyStatus, { provider });

/** `baseUrl`: the compatible server's address, saved with its key. */
export const aiSetKey = (provider: AiProvider, key: string, baseUrl?: string) =>
  call<KeyStatus>(ANALYTICS_COMMANDS.aiSetKey, {
    provider,
    key,
    baseUrl: baseUrl ?? null,
  });

export const aiDeleteKey = (provider: AiProvider = "anthropic") =>
  call<KeyStatus>(ANALYTICS_COMMANDS.aiDeleteKey, { provider });

export const aiTestKey = (provider: AiProvider, model: string) =>
  call<AiKeyTest>(ANALYTICS_COMMANDS.aiTestKey, { provider, model });

export const mcpInfo = () => call<McpInfo>(ANALYTICS_COMMANDS.mcpInfo);

const printable = (key: string) => /^[\x21-\x7e]+$/.test(key);

export type KeyCheck =
  | { ok: true; key: string }
  | { ok: false; reason: "format" | "anthropicKey" };

/**
 * Same rules as the Rust key store (plan 2.13): Anthropic `sk-ant-`,
 * 20-300 characters; OpenAI `sk-` but not `sk-ant-`, 20-500; a
 * compatible server any printable key of 8-1000 characters.
 */
export const validateApiKey = (
  raw: string,
  provider: AiProvider = "anthropic"
): KeyCheck => {
  const key = raw.trim();
  const within = (min: number, max: number) =>
    key.length >= min && key.length <= max && printable(key);
  switch (provider) {
    case "anthropic":
      return key.startsWith("sk-ant-") && within(20, 300)
        ? { ok: true, key }
        : { ok: false, reason: "format" };
    case "openai":
      if (key.startsWith("sk-ant-"))
        return { ok: false, reason: "anthropicKey" };
      return key.startsWith("sk-") && within(20, 500)
        ? { ok: true, key }
        : { ok: false, reason: "format" };
    case "openai_compatible":
      return within(8, 1000)
        ? { ok: true, key }
        : { ok: false, reason: "format" };
  }
};

export type BaseUrlCheck =
  | { ok: true; url: string; local: boolean }
  | {
      ok: false;
      reason: "empty" | "invalid" | "insecure" | "credentials" | "query";
    };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Same rules as Rust's `BaseUrl`: https, or http for this computer only
 * (localhost, 127.0.0.1, [::1]); no user name or password, no query or
 * fragment; the trailing slash dropped. `local`: the server is on this
 * computer, so the schema does not leave it.
 */
export const validateBaseUrl = (raw: string): BaseUrlCheck => {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "empty" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (text.length > 2048 || url.hostname === "") {
    return { ok: false, reason: "invalid" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials" };
  }
  if (url.search !== "" || url.hash !== "" || /[?#]/.test(text)) {
    return { ok: false, reason: "query" };
  }
  const local = LOCAL_HOSTS.has(url.host.replace(/:\d+$/, ""));
  if (url.protocol === "http:" && !local) {
    return { ok: false, reason: "insecure" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, url: url.href.replace(/\/+$/, ""), local };
};

/**
 * The translated message of an AI error (appendix D.10 `ai.errors.*`).
 * `provider`: who answered ("Anthropic", "OpenAI", the server's host), for
 * the messages that name it; a generic "the AI service" otherwise.
 * `providerKind`: a compatible server gets "check that it is started"
 * instead of "check the Internet connection" (review #30). The provider's
 * own message never goes in the sentence (review #31): `aiErrorDetail`
 * gives it for a "Détail technique" disclosure.
 */
export const formatAiError = (
  error: AiError,
  t: TFunction,
  detail?: string,
  provider?: string | null,
  providerKind?: AiProvider | null
): string => {
  const who = provider ?? t("analytics.ai.providers.generic");
  switch (error.code) {
    case "rate_limited":
      return t("analytics.ai.errors.rate_limited", {
        seconds: error.retryAfterSeconds ?? 60,
      });
    case "repair_failed":
      return t("analytics.ai.errors.repair_failed", {
        message: detail ?? error.message,
      });
    case "network":
      return t(
        providerKind === "openai_compatible"
          ? "analytics.ai.errors.network_server"
          : "analytics.ai.errors.network",
        { provider: who }
      );
    default:
      return t(`analytics.ai.errors.${error.code}`, { provider: who });
  }
};

/**
 * The provider's raw message, for the codes whose sentence leaves it out
 * (it is often English and technical); null for the others.
 */
export const aiErrorDetail = (error: AiError): string | null =>
  (error.code === "bad_request" || error.code === "internal") &&
  error.message.trim() !== ""
    ? error.message
    : null;
