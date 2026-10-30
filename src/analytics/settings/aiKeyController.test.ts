import { describe, expect, it, vi } from "vitest";
import type { KeyStatus } from "../engine/ipc";
import {
  AiKeyApi,
  createAiKeyController,
  isConfigured,
} from "./aiKeyController";

const NONE: KeyStatus = { stored: false, storage: null };
const KEYCHAIN: KeyStatus = { stored: true, storage: "keychain" };
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";

const api = (overrides: Partial<AiKeyApi> = {}): AiKeyApi => ({
  status: vi.fn().mockResolvedValue(NONE),
  set: vi.fn().mockResolvedValue(KEYCHAIN),
  remove: vi.fn().mockResolvedValue(NONE),
  test: vi.fn().mockResolvedValue({ ok: true }),
  ...overrides,
});

describe("AI key controller", () => {
  it("loads the status only", async () => {
    const controller = createAiKeyController(api());
    expect(controller.getState().busy).toBe("loading");
    await controller.load();
    expect(controller.getState()).toMatchObject({ status: NONE, busy: null });
  });

  it("refuses a key with the wrong format without calling Rust", async () => {
    const fake = api();
    const controller = createAiKeyController(fake);
    expect(await controller.save("hello")).toBe(false);
    expect(await controller.save("sk-ant-short")).toBe(false);
    expect(await controller.save("sk-ant-with a space inside-xxxxxxxx")).toBe(
      false
    );
    expect(controller.getState().message).toEqual({
      kind: "invalidFormat",
      reason: "format",
    });
    expect(fake.set).not.toHaveBeenCalled();
  });

  it("stores a trimmed key and keeps only the status", async () => {
    const fake = api();
    const controller = createAiKeyController(fake);
    expect(await controller.save(`  ${KEY}\n`)).toBe(true);
    expect(fake.set).toHaveBeenCalledWith("anthropic", KEY, undefined);
    const state = controller.getState();
    expect(state.status).toEqual(KEYCHAIN);
    expect(state.message).toEqual({ kind: "saved" });
    expect(JSON.stringify(state)).not.toContain(KEY);
  });

  it("goes through the test states", async () => {
    let finish: (value: { ok: boolean; code?: "invalid_key" }) => void = () =>
      undefined;
    const fake = api();
    vi.mocked(fake.test).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    );
    const controller = createAiKeyController(fake);
    const pending = controller.test("claude-haiku-5-5");
    expect(controller.getState().busy).toBe("test");
    finish({ ok: false, code: "invalid_key" });
    await pending;
    expect(fake.test).toHaveBeenCalledWith("anthropic", "claude-haiku-5-5");
    expect(controller.getState().busy).toBeNull();
    expect(controller.getState().message).toMatchObject({
      kind: "error",
      error: { code: "invalid_key" },
    });

    await controller.test("claude-opus-5-5");
    expect(controller.getState().message).toEqual({
      kind: "testOk",
      model: "claude-opus-5-5",
    });
  });

  it("deletes the key", async () => {
    const fake = api({ status: vi.fn().mockResolvedValue(KEYCHAIN) });
    const controller = createAiKeyController(fake);
    await controller.load();
    await controller.remove();
    expect(fake.remove).toHaveBeenCalledWith("anthropic");
    expect(controller.getState()).toMatchObject({
      status: NONE,
      message: { kind: "deleted" },
    });
  });

  it("shows Rust errors and keeps working", async () => {
    const controller = createAiKeyController(
      api({
        status: vi
          .fn()
          .mockRejectedValue({ code: "desktop_only", message: "no" }),
        set: vi
          .fn()
          .mockRejectedValue({ code: "internal", message: "keyring down" }),
      })
    );
    await controller.load();
    expect(controller.getState().statusError).toMatchObject({
      code: "desktop_only",
    });
    expect(await controller.save(KEY)).toBe(false);
    expect(controller.getState()).toMatchObject({
      busy: null,
      message: {
        kind: "error",
        error: { code: "internal", message: "keyring down" },
      },
    });
  });

  it("keeps one key per provider", async () => {
    const fake = api();
    const controller = createAiKeyController(fake, "openai");
    await controller.load();
    expect(fake.status).toHaveBeenCalledWith("openai");
    expect(await controller.save(KEY)).toBe(false);
    expect(controller.getState().message).toEqual({
      kind: "invalidFormat",
      reason: "anthropicKey",
    });
    const openAiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz";
    expect(await controller.save(openAiKey)).toBe(true);
    expect(fake.set).toHaveBeenCalledWith("openai", openAiKey, undefined);
    await controller.test("gpt-6.1-sol");
    expect(fake.test).toHaveBeenCalledWith("openai", "gpt-6.1-sol");
  });

  it("saves a compatible server with its address, the key optional", async () => {
    const fake = api();
    const controller = createAiKeyController(fake, "openai_compatible");
    expect(await controller.save("", "http://example.com/v1")).toBe(false);
    expect(controller.getState().message).toEqual({
      kind: "invalidUrl",
      reason: "insecure",
    });
    expect(await controller.save("", "")).toBe(false);
    expect(controller.getState().message).toEqual({
      kind: "invalidUrl",
      reason: "empty",
    });
    expect(fake.set).not.toHaveBeenCalled();

    expect(await controller.save("", " http://localhost:11434/v1/ ")).toBe(
      true
    );
    expect(fake.set).toHaveBeenLastCalledWith(
      "openai_compatible",
      "",
      "http://localhost:11434/v1"
    );
    expect(
      await controller.save("  token-1234567  ", "https://llm.example.org/v1")
    ).toBe(true);
    expect(fake.set).toHaveBeenLastCalledWith(
      "openai_compatible",
      "token-1234567",
      "https://llm.example.org/v1"
    );
  });

  it("is configured with a key, and a model for a compatible server", () => {
    expect(isConfigured("anthropic", KEYCHAIN, "")).toBe(true);
    expect(isConfigured("openai", NONE, "gpt-6.1-sol")).toBe(false);
    expect(isConfigured("openai", null, "gpt-6.1-sol")).toBe(false);
    expect(isConfigured("openai_compatible", KEYCHAIN, " ")).toBe(false);
    expect(isConfigured("openai_compatible", KEYCHAIN, "llama3.3")).toBe(true);
  });

  it("saves then checks the key, with one message for both", async () => {
    const fake = api();
    const controller = createAiKeyController(fake);
    expect(
      await controller.saveAndTest(KEY, undefined, "claude-opus-5-5")
    ).toBe(true);
    expect(fake.set).toHaveBeenCalledWith("anthropic", KEY, undefined);
    expect(fake.test).toHaveBeenCalledWith("anthropic", "claude-opus-5-5");
    expect(controller.getState()).toMatchObject({
      busy: null,
      status: KEYCHAIN,
      message: { kind: "savedChecked", model: "claude-opus-5-5" },
    });
  });

  it("keeps the key when the check fails, and says so", async () => {
    const fake = api({
      test: vi.fn().mockResolvedValue({ ok: false, code: "forbidden" }),
    });
    const controller = createAiKeyController(fake);
    expect(
      await controller.saveAndTest(KEY, undefined, "claude-opus-5-5")
    ).toBe(true);
    const message = controller.getState().message;
    expect(message?.kind).toBe("savedCheckFailed");
    expect(
      message?.kind === "savedCheckFailed" ? message.error.code : null
    ).toBe("forbidden");
  });

  it("does not check a key it refused, nor without a model", async () => {
    const fake = api();
    const controller = createAiKeyController(fake);
    expect(await controller.saveAndTest("hello", undefined, "x")).toBe(false);
    expect(fake.test).not.toHaveBeenCalled();
    const server = createAiKeyController(fake, "openai_compatible");
    expect(await server.saveAndTest("", "http://localhost:11434/v1", " ")).toBe(
      true
    );
    expect(fake.test).not.toHaveBeenCalled();
    expect(server.getState().message).toEqual({ kind: "saved" });
  });

  it("forgets a stale error once the user edits the field", async () => {
    const controller = createAiKeyController(api(), "openai_compatible");
    await controller.save("", "http://api.mistral.ai/v1");
    expect(controller.getState().message).toEqual({
      kind: "invalidUrl",
      reason: "insecure",
    });
    controller.clearMessage();
    expect(controller.getState().message).toBeNull();
  });
});
