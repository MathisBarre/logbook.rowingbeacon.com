import type { AiKeyTest, AiProvider, KeyStatus } from "../engine/ipc";
import {
  AiError,
  BaseUrlCheck,
  KeyCheck,
  toAiError,
  validateApiKey,
  validateBaseUrl,
} from "../ai/aiClient";

/**
 * State of the AI provider card (plan 1.3, card 3; ADR 0008 "AI
 * providers"), as a plain controller so tests drive it without a DOM.
 * One controller per provider: each has its own key on this computer.
 * The key typed by the user is sent once to the Rust key store and
 * forgotten: the webview only ever gets the status (and, for a compatible
 * server, the address saved with the key).
 */

export interface AiKeyApi {
  status: (provider: AiProvider) => Promise<KeyStatus>;
  set: (
    provider: AiProvider,
    key: string,
    baseUrl?: string
  ) => Promise<KeyStatus>;
  remove: (provider: AiProvider) => Promise<KeyStatus>;
  test: (provider: AiProvider, model: string) => Promise<AiKeyTest>;
}

export type AiKeyMessage =
  | { kind: "saved" }
  | { kind: "deleted" }
  | {
      kind: "invalidFormat";
      reason: Extract<KeyCheck, { ok: false }>["reason"];
    }
  | {
      kind: "invalidUrl";
      reason: Extract<BaseUrlCheck, { ok: false }>["reason"];
    }
  | { kind: "testOk"; model: string }
  | { kind: "savedChecked"; model: string }
  | { kind: "savedCheckFailed"; error: AiError }
  | { kind: "error"; error: AiError };

interface AiKeyState {
  status: KeyStatus | null;
  /** Reading the status failed (e.g. outside the installed app). */
  statusError: AiError | null;
  busy: "loading" | "save" | "test" | "delete" | null;
  message: AiKeyMessage | null;
}

const INITIAL_KEY_STATE: AiKeyState = {
  status: null,
  statusError: null,
  busy: "loading",
  message: null,
};

/** Whether questions can go to this provider from this computer. */
export const isConfigured = (
  provider: AiProvider,
  status: KeyStatus | null,
  model: string
) =>
  status?.stored === true &&
  (provider !== "openai_compatible" || model.trim() !== "");

export const createAiKeyController = (
  api: AiKeyApi,
  provider: AiProvider = "anthropic"
) => {
  let state = INITIAL_KEY_STATE;
  const listeners = new Set<() => void>();
  const set = (next: Partial<AiKeyState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  /**
   * Resolves true when the key was stored (the field can be cleared).
   * For a compatible server, `baseUrl` is required and the key may be
   * empty (a local server needs none); a key saved before is never
   * carried over to a new address.
   */
  const save = async (input: string, baseUrl?: string): Promise<boolean> => {
    let url: string | undefined;
    if (provider === "openai_compatible") {
      const checkedUrl = validateBaseUrl(baseUrl ?? "");
      if (!checkedUrl.ok) {
        set({ message: { kind: "invalidUrl", reason: checkedUrl.reason } });
        return false;
      }
      url = checkedUrl.url;
    }
    let key = "";
    if (provider !== "openai_compatible" || input.trim() !== "") {
      const checked = validateApiKey(input, provider);
      if (!checked.ok) {
        set({ message: { kind: "invalidFormat", reason: checked.reason } });
        return false;
      }
      key = checked.key;
    }
    set({ busy: "save", message: null });
    try {
      set({
        status: await api.set(provider, key, url),
        busy: null,
        message: { kind: "saved" },
      });
      return true;
    } catch (error) {
      set({
        busy: null,
        message: { kind: "error", error: toAiError(error) },
      });
      return false;
    }
  };

  /** Asks the provider whether the key answers; the error, or null. */
  const check = async (model: string): Promise<AiError | null> => {
    try {
      const result = await api.test(provider, model);
      return result.ok
        ? null
        : new AiError(result.code ?? "internal", "Key test failed");
    } catch (error) {
      return toAiError(error);
    }
  };

  return {
    provider,
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    load: async () => {
      set({ busy: "loading", statusError: null });
      try {
        set({ status: await api.status(provider), busy: null });
      } catch (error) {
        set({ statusError: toAiError(error), busy: null });
      }
    },

    save,

    test: async (model: string) => {
      set({ busy: "test", message: null });
      const failure = await check(model);
      set({
        busy: null,
        message: failure
          ? { kind: "error", error: failure }
          : { kind: "testOk", model },
      });
    },

    /**
     * "Enregistrer et vérifier": saves, then, when a model is given, asks
     * the provider whether the key works, with one message for both.
     * Resolves true when the key was stored.
     */
    saveAndTest: async (
      input: string,
      baseUrl: string | undefined,
      model: string
    ): Promise<boolean> => {
      const saved = await save(input, baseUrl);
      if (!saved || model.trim() === "") return saved;
      set({ busy: "test" });
      const failure = await check(model);
      set({
        busy: null,
        message: failure
          ? { kind: "savedCheckFailed", error: failure }
          : { kind: "savedChecked", model },
      });
      return true;
    },

    /** Forgets the last message (the user is fixing the field). */
    clearMessage: () => {
      if (state.message !== null) set({ message: null });
    },

    remove: async () => {
      set({ busy: "delete", message: null });
      try {
        set({
          status: await api.remove(provider),
          busy: null,
          message: { kind: "deleted" },
        });
      } catch (error) {
        set({
          busy: null,
          message: { kind: "error", error: toAiError(error) },
        });
      }
    },
  };
};
