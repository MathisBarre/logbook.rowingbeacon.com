import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANALYTICS_SETTINGS,
  aiTargetOf,
  DEFAULT_ANALYTICS_SETTINGS,
  getSeasonStartMonth,
  normalizeAnalyticsSettings,
  normalizeAnnualLogo,
  useAnalyticsSettingsStore,
} from "./analyticsSettings.store";
import {
  flushWrites,
  resetWriteQueueForTests,
  setWriteClient,
} from "../../_common/database/writeQueue";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";

const readSettings = async (db: ReturnType<typeof createTestSqlClient>) =>
  Object.fromEntries(
    (
      await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM setting WHERE key LIKE 'analytics.%'"
      )
    ).map((row) => [row.key, JSON.parse(row.value) as unknown])
  );

let db: ReturnType<typeof createTestSqlClient>;
beforeEach(async () => {
  resetWriteQueueForTests();
  db = createTestSqlClient();
  const log = console.log;
  console.log = () => undefined;
  await applyMigrations(db);
  console.log = log;
  setWriteClient(db);
  useAnalyticsSettingsStore.getState().reset();
});
afterEach(async () => {
  await db.close();
});

describe("analytics settings", () => {
  it("uses the defaults of plan 2.5", () => {
    expect(normalizeAnalyticsSettings({})).toEqual({
      seasonStartMonth: 8,
      publicRankings: false,
      dashboardInitialised: false,
      aiProvider: "anthropic",
      aiModel: "claude-opus-5-5",
      aiOpenAiModel: "gpt-6.1-sol",
      aiCompatibleModel: "",
      aiShareAssetNames: true,
      mcpEnabled: false,
      mcpPrivacy: "pseudonymised",
      annualNotes: {},
      annualClubName: "",
      annualLogo: "",
      editorMaxRows: 1000,
      editorMaxRowsSet: false,
      performanceProfile: "auto",
      queryTimeoutSeconds: null,
    });
    expect(getSeasonStartMonth()).toBe(8);
  });

  it("replaces invalid stored values by defaults", () => {
    expect(
      normalizeAnalyticsSettings({
        [ANALYTICS_SETTINGS.seasonStartMonth]: 13,
        [ANALYTICS_SETTINGS.aiModel]: "gpt",
        [ANALYTICS_SETTINGS.aiProvider]: "gemini",
        [ANALYTICS_SETTINGS.aiOpenAiModel]: "claude-opus-5-5",
        [ANALYTICS_SETTINGS.aiCompatibleModel]: " llama\n",
        [ANALYTICS_SETTINGS.mcpPrivacy]: "open",
        [ANALYTICS_SETTINGS.annualNotes]: {
          "2025": "Bravo",
          x: "no",
          "2024": 3,
        },
        [ANALYTICS_SETTINGS.editorMaxRows]: 99_999,
        [ANALYTICS_SETTINGS.publicRankings]: "yes",
      })
    ).toEqual({
      ...DEFAULT_ANALYTICS_SETTINGS,
      annualNotes: { "2025": "Bravo" },
    });
  });

  it("hydrates and writes through the write queue", async () => {
    const store = useAnalyticsSettingsStore.getState();
    store.hydrate({ [ANALYTICS_SETTINGS.seasonStartMonth]: 9 });
    expect(getSeasonStartMonth()).toBe(9);

    store.setSeasonStartMonth(1);
    store.setPublicRankings(true);
    store.setAiModel("claude-haiku-5-5");
    store.setAiProvider("openai_compatible");
    store.setAiOpenAiModel("gpt-6-luna");
    store.setAiCompatibleModel("  mistral-large-latest ");
    store.setMcpEnabled(true);
    store.setAnnualNote(2025, "Une belle saison");
    store.setAnnualNote(2024, "x");
    store.setAnnualNote(2024, "  ");
    store.setAnnualClubName("Aviron Club");
    store.setEditorMaxRows(20);
    await flushWrites();

    expect(await readSettings(db)).toEqual({
      "analytics.seasonStartMonth": 1,
      "analytics.publicRankings": true,
      "analytics.ai.model": "claude-haiku-5-5",
      "analytics.ai.provider": "openai_compatible",
      "analytics.ai.openai.model": "gpt-6-luna",
      "analytics.ai.compatible.model": "mistral-large-latest",
      "analytics.mcp.enabled": true,
      "analytics.annual.notes": { "2025": "Une belle saison" },
      "analytics.annual.clubName": "Aviron Club",
      "analytics.editor.maxRows": 1000,
    });
    expect(getSeasonStartMonth()).toBe(1);
    expect(aiTargetOf(useAnalyticsSettingsStore.getState())).toEqual({
      provider: "openai_compatible",
      model: "mistral-large-latest",
    });
  });

  it("keeps a valid annual logo and refuses anything else", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(normalizeAnnualLogo(png)).toBe(png);
    expect(normalizeAnnualLogo(svg)).toBe(svg);
    for (const bad of [
      "https://example.org/logo.png",
      "data:text/html;base64,PGI+",
      'data:image/png;base64,AAAA" onerror="x',
      `data:image/png;base64,${"A".repeat(300_000)}`,
      42,
    ]) {
      expect(normalizeAnnualLogo(bad)).toBe("");
    }
    expect(
      normalizeAnalyticsSettings({ [ANALYTICS_SETTINGS.annualLogo]: png })
        .annualLogo
    ).toBe(png);

    const store = useAnalyticsSettingsStore.getState();
    expect(store.setAnnualLogo("javascript:alert(1)")).toBe(false);
    expect(useAnalyticsSettingsStore.getState().annualLogo).toBe("");
    expect(store.setAnnualLogo(png)).toBe(true);
    expect(useAnalyticsSettingsStore.getState().annualLogo).toBe(png);
    store.setAnnualLogo("");
    await flushWrites();
    expect((await readSettings(db))["analytics.annual.logo"]).toBe("");
  });

  it("keeps Anthropic for the settings of a build without providers", () => {
    // Before providers, analytics.ai.model was the only AI setting.
    const migrated = normalizeAnalyticsSettings({
      [ANALYTICS_SETTINGS.aiModel]: "claude-sonnet-5-5",
    });
    expect(aiTargetOf(migrated)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(
      aiTargetOf(
        normalizeAnalyticsSettings({
          [ANALYTICS_SETTINGS.aiProvider]: "openai",
          [ANALYTICS_SETTINGS.aiModel]: "claude-sonnet-5-5",
        })
      )
    ).toEqual({ provider: "openai", model: "gpt-6.1-sol" });
  });

  it("reads, clamps and writes the performance settings", async () => {
    expect(
      normalizeAnalyticsSettings({
        [ANALYTICS_SETTINGS.performanceProfile]: "powerful",
        [ANALYTICS_SETTINGS.queryTimeoutSeconds]: 45,
        [ANALYTICS_SETTINGS.editorMaxRows]: 20_000,
      })
    ).toMatchObject({
      performanceProfile: "powerful",
      queryTimeoutSeconds: 45,
      editorMaxRows: 20_000,
      editorMaxRowsSet: true,
    });
    expect(
      normalizeAnalyticsSettings({
        [ANALYTICS_SETTINGS.performanceProfile]: "turbo",
        [ANALYTICS_SETTINGS.queryTimeoutSeconds]: 4,
      })
    ).toMatchObject({ performanceProfile: "auto", queryTimeoutSeconds: null });

    const store = useAnalyticsSettingsStore.getState();
    store.setPerformanceProfile("standard");
    store.setQueryTimeoutSeconds(1_000);
    await flushWrites();
    const saved = await readSettings(db);
    expect(saved["analytics.performance.profile"]).toBe("standard");
    expect(saved["analytics.performance.queryTimeoutSeconds"]).toBe(300);
    store.setQueryTimeoutSeconds(null);
    await flushWrites();
    expect(
      (await readSettings(db))["analytics.performance.queryTimeoutSeconds"]
    ).toBeNull();

    store.reset();
    expect(useAnalyticsSettingsStore.getState()).toMatchObject({
      performanceProfile: "auto",
      queryTimeoutSeconds: null,
    });
  });
});
