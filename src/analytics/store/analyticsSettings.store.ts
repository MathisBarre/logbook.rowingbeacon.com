import { create } from "zustand";
import { enqueueWrite } from "../../_common/database/writeQueue";
import { saveSetting } from "../../_common/database/repositories/club.repository";
import {
  AI_MODELS,
  AI_PROVIDERS,
  AiModel,
  AiProvider,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
  OpenAiModel,
} from "../engine/ipc";
import type { PrivacyMode } from "../types";
import {
  parsePerformanceChoice,
  PerformanceChoice,
} from "../engine/performance";

/**
 * Analytics settings (plan 2.5), stored as JSON in the `setting` table and
 * hydrated by `loadIntoStores` (bootstrap.ts). Setters update the store
 * at once and write through the write queue, like modules.store.ts.
 * Kept small: the main chunk loads it for `getSeasonDate`.
 */

export const ANALYTICS_SETTINGS = {
  seasonStartMonth: "analytics.seasonStartMonth",
  publicRankings: "analytics.publicRankings",
  dashboardInitialised: "analytics.dashboard.initialised",
  /** The provider (ADR 0008); absent before providers: Anthropic. */
  aiProvider: "analytics.ai.provider",
  /** Anthropic's model (the key kept its pre-provider name). */
  aiModel: "analytics.ai.model",
  aiOpenAiModel: "analytics.ai.openai.model",
  aiCompatibleModel: "analytics.ai.compatible.model",
  aiShareAssetNames: "analytics.ai.shareAssetNames",
  mcpEnabled: "analytics.mcp.enabled",
  mcpPrivacy: "analytics.mcp.privacy",
  annualNotes: "analytics.annual.notes",
  annualClubName: "analytics.annual.clubName",
  annualLogo: "analytics.annual.logo",
  editorMaxRows: "analytics.editor.maxRows",
  performanceProfile: "analytics.performance.profile",
  queryTimeoutSeconds: "analytics.performance.queryTimeoutSeconds",
} as const;

export const DEFAULT_SEASON_START_MONTH = 8;
/** Rust `ai::models::MAX_MODEL_NAME_CHARS`. */
export const COMPATIBLE_MODEL_MAX_LENGTH = 200;
export const ANNUAL_NOTE_MAX_LENGTH = 2000;
export const CLUB_NAME_MAX_LENGTH = 80;
/** Largest logo file accepted for the annual report (bytes). */
export const ANNUAL_LOGO_MAX_BYTES = 200 * 1024;
/** Its data URL: base64 is 4/3 of the file, plus the prefix. */
const ANNUAL_LOGO_MAX_LENGTH = Math.ceil(ANNUAL_LOGO_MAX_BYTES / 3) * 4 + 64;

interface AnalyticsSettings {
  /** 1-12; 8 = August. */
  seasonStartMonth: number;
  publicRankings: boolean;
  dashboardInitialised: boolean;
  aiProvider: AiProvider;
  /** Anthropic model. */
  aiModel: AiModel;
  aiOpenAiModel: OpenAiModel;
  /** Model name for the OpenAI-compatible server ("" until typed). */
  aiCompatibleModel: string;
  aiShareAssetNames: boolean;
  mcpEnabled: boolean;
  mcpPrivacy: PrivacyMode;
  /** Season (start year as text) → comment of the annual report. */
  annualNotes: Record<string, string>;
  annualClubName: string;
  /** Data URL of the club's logo (PNG, JPEG or SVG), "" when none. */
  annualLogo: string;
  /** 100-50 000, clamped to the performance profile when used. */
  editorMaxRows: number;
  /** False: the profile's `editorRows` apply (getEditorMaxRows). */
  editorMaxRowsSet: boolean;
  /** "auto" follows the machine (engine/performance.ts). */
  performanceProfile: PerformanceChoice;
  /** Explorer and AI timeout override, 5-300 s; null = the profile's. */
  queryTimeoutSeconds: number | null;
}

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  seasonStartMonth: DEFAULT_SEASON_START_MONTH,
  publicRankings: false,
  dashboardInitialised: false,
  aiProvider: DEFAULT_AI_PROVIDER,
  aiModel: DEFAULT_AI_MODEL,
  aiOpenAiModel: DEFAULT_OPENAI_MODEL,
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
};

/** Bounds of `analytics.performance.queryTimeoutSeconds`. */
export const QUERY_TIMEOUT_SECONDS_RANGE = { min: 5, max: 300 } as const;
/** Bounds of `analytics.editor.maxRows` (the profile clamps it further). */
export const EDITOR_MAX_ROWS_RANGE = { min: 100, max: 50_000 } as const;

const integerIn = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : fallback;

const booleanOr = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
  fallback: T
): T =>
  (values as readonly unknown[]).includes(value) ? (value as T) : fallback;

/** A model name as Rust accepts it, else "". */
export const normalizeCompatibleModel = (value: unknown): string =>
  typeof value === "string" &&
  value.trim() === value &&
  value.length <= COMPATIBLE_MODEL_MAX_LENGTH &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";

const normalizeNotes = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] =>
          /^\d{4}$/.test(entry[0]) && typeof entry[1] === "string"
      )
      .map(([season, text]) => [season, text.slice(0, ANNUAL_NOTE_MAX_LENGTH)])
  );
};

/**
 * A logo as the annual report stores it: a base64 data URL of a PNG, JPEG
 * or SVG image of 200 KB at most, else "". Shown through <img> only, where
 * an SVG runs no script.
 */
export const normalizeAnnualLogo = (value: unknown): string =>
  typeof value === "string" &&
  value.length <= ANNUAL_LOGO_MAX_LENGTH &&
  /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(value)
    ? value
    : "";

/** Settings read from the `setting` table, invalid values replaced by defaults. */
export const normalizeAnalyticsSettings = (
  settings: Record<string, unknown>
): AnalyticsSettings => {
  const d = DEFAULT_ANALYTICS_SETTINGS;
  const model = settings[ANALYTICS_SETTINGS.aiModel];
  const privacy = settings[ANALYTICS_SETTINGS.mcpPrivacy];
  const clubName = settings[ANALYTICS_SETTINGS.annualClubName];
  return {
    seasonStartMonth: integerIn(
      settings[ANALYTICS_SETTINGS.seasonStartMonth],
      1,
      12,
      d.seasonStartMonth
    ),
    publicRankings: booleanOr(
      settings[ANALYTICS_SETTINGS.publicRankings],
      d.publicRankings
    ),
    dashboardInitialised: booleanOr(
      settings[ANALYTICS_SETTINGS.dashboardInitialised],
      d.dashboardInitialised
    ),
    // No provider stored (settings of a build without providers, where
    // only Anthropic existed): Anthropic, so a club with a key keeps it.
    aiProvider: oneOf(
      AI_PROVIDERS,
      settings[ANALYTICS_SETTINGS.aiProvider],
      d.aiProvider
    ),
    aiModel: oneOf(AI_MODELS, model, d.aiModel),
    aiOpenAiModel: oneOf(
      OPENAI_MODELS,
      settings[ANALYTICS_SETTINGS.aiOpenAiModel],
      d.aiOpenAiModel
    ),
    aiCompatibleModel: normalizeCompatibleModel(
      settings[ANALYTICS_SETTINGS.aiCompatibleModel]
    ),
    aiShareAssetNames: booleanOr(
      settings[ANALYTICS_SETTINGS.aiShareAssetNames],
      d.aiShareAssetNames
    ),
    mcpEnabled: booleanOr(
      settings[ANALYTICS_SETTINGS.mcpEnabled],
      d.mcpEnabled
    ),
    mcpPrivacy:
      privacy === "nominative" || privacy === "pseudonymised"
        ? privacy
        : d.mcpPrivacy,
    annualNotes: normalizeNotes(settings[ANALYTICS_SETTINGS.annualNotes]),
    annualClubName:
      typeof clubName === "string"
        ? clubName.slice(0, CLUB_NAME_MAX_LENGTH)
        : d.annualClubName,
    annualLogo: normalizeAnnualLogo(settings[ANALYTICS_SETTINGS.annualLogo]),
    editorMaxRows: integerIn(
      settings[ANALYTICS_SETTINGS.editorMaxRows],
      EDITOR_MAX_ROWS_RANGE.min,
      EDITOR_MAX_ROWS_RANGE.max,
      d.editorMaxRows
    ),
    editorMaxRowsSet:
      integerIn(
        settings[ANALYTICS_SETTINGS.editorMaxRows],
        EDITOR_MAX_ROWS_RANGE.min,
        EDITOR_MAX_ROWS_RANGE.max,
        -1
      ) !== -1,
    performanceProfile: parsePerformanceChoice(
      settings[ANALYTICS_SETTINGS.performanceProfile]
    ),
    queryTimeoutSeconds: (() => {
      const value = integerIn(
        settings[ANALYTICS_SETTINGS.queryTimeoutSeconds],
        QUERY_TIMEOUT_SECONDS_RANGE.min,
        QUERY_TIMEOUT_SECONDS_RANGE.max,
        -1
      );
      return value === -1 ? null : value;
    })(),
  };
};

interface AnalyticsSettingsState extends AnalyticsSettings {
  hydrate: (settings: Record<string, unknown>) => void;
  setSeasonStartMonth: (month: number) => void;
  setPublicRankings: (value: boolean) => void;
  setDashboardInitialised: (value: boolean) => void;
  setAiProvider: (provider: AiProvider) => void;
  setAiModel: (model: AiModel) => void;
  setAiOpenAiModel: (model: OpenAiModel) => void;
  /** Trimmed and cut to 200 characters. */
  setAiCompatibleModel: (model: string) => void;
  setAiShareAssetNames: (value: boolean) => void;
  setMcpEnabled: (value: boolean) => void;
  setMcpPrivacy: (privacy: PrivacyMode) => void;
  /** Empty text removes the season's comment. */
  setAnnualNote: (season: number, text: string) => void;
  setAnnualClubName: (name: string) => void;
  /** "" removes the logo; an invalid value is refused (false). */
  setAnnualLogo: (dataUrl: string) => boolean;
  setEditorMaxRows: (rows: number) => void;
  setPerformanceProfile: (choice: PerformanceChoice) => void;
  /** null goes back to the profile's timeout. */
  setQueryTimeoutSeconds: (seconds: number | null) => void;
  reset: () => void;
}

const write = (key: string, value: unknown) =>
  enqueueWrite(`setting ${key}`, (db) => saveSetting(db, key, value));

export const useAnalyticsSettingsStore = create<AnalyticsSettingsState>()(
  (set, get) => ({
    ...DEFAULT_ANALYTICS_SETTINGS,
    hydrate(settings) {
      set(normalizeAnalyticsSettings(settings));
    },
    setSeasonStartMonth(month) {
      const value = integerIn(month, 1, 12, get().seasonStartMonth);
      set({ seasonStartMonth: value });
      void write(ANALYTICS_SETTINGS.seasonStartMonth, value);
    },
    setPublicRankings(value) {
      set({ publicRankings: value });
      void write(ANALYTICS_SETTINGS.publicRankings, value);
    },
    setDashboardInitialised(value) {
      set({ dashboardInitialised: value });
      void write(ANALYTICS_SETTINGS.dashboardInitialised, value);
    },
    setAiProvider(provider) {
      set({ aiProvider: provider });
      void write(ANALYTICS_SETTINGS.aiProvider, provider);
    },
    setAiModel(model) {
      set({ aiModel: model });
      void write(ANALYTICS_SETTINGS.aiModel, model);
    },
    setAiOpenAiModel(model) {
      set({ aiOpenAiModel: model });
      void write(ANALYTICS_SETTINGS.aiOpenAiModel, model);
    },
    setAiCompatibleModel(model) {
      const value = normalizeCompatibleModel(
        model.trim().slice(0, COMPATIBLE_MODEL_MAX_LENGTH).trim()
      );
      set({ aiCompatibleModel: value });
      void write(ANALYTICS_SETTINGS.aiCompatibleModel, value);
    },
    setAiShareAssetNames(value) {
      set({ aiShareAssetNames: value });
      void write(ANALYTICS_SETTINGS.aiShareAssetNames, value);
    },
    setMcpEnabled(value) {
      set({ mcpEnabled: value });
      void write(ANALYTICS_SETTINGS.mcpEnabled, value);
    },
    setMcpPrivacy(privacy) {
      set({ mcpPrivacy: privacy });
      void write(ANALYTICS_SETTINGS.mcpPrivacy, privacy);
    },
    setAnnualNote(season, text) {
      const notes = { ...get().annualNotes };
      const trimmed = text.slice(0, ANNUAL_NOTE_MAX_LENGTH);
      if (trimmed.trim() === "") {
        delete notes[String(season)];
      } else {
        notes[String(season)] = trimmed;
      }
      set({ annualNotes: notes });
      void write(ANALYTICS_SETTINGS.annualNotes, notes);
    },
    setAnnualClubName(name) {
      const value = name.slice(0, CLUB_NAME_MAX_LENGTH);
      set({ annualClubName: value });
      void write(ANALYTICS_SETTINGS.annualClubName, value);
    },
    setAnnualLogo(dataUrl) {
      const value = normalizeAnnualLogo(dataUrl);
      if (dataUrl !== "" && value === "") return false;
      set({ annualLogo: value });
      void write(ANALYTICS_SETTINGS.annualLogo, value);
      return true;
    },
    setEditorMaxRows(rows) {
      const value = integerIn(
        rows,
        EDITOR_MAX_ROWS_RANGE.min,
        EDITOR_MAX_ROWS_RANGE.max,
        get().editorMaxRows
      );
      set({ editorMaxRows: value, editorMaxRowsSet: true });
      void write(ANALYTICS_SETTINGS.editorMaxRows, value);
    },
    setPerformanceProfile(choice) {
      const value = parsePerformanceChoice(choice);
      set({ performanceProfile: value });
      void write(ANALYTICS_SETTINGS.performanceProfile, value);
    },
    setQueryTimeoutSeconds(seconds) {
      const value =
        seconds === null
          ? null
          : Math.min(
              Math.max(Math.round(seconds), QUERY_TIMEOUT_SECONDS_RANGE.min),
              QUERY_TIMEOUT_SECONDS_RANGE.max
            );
      if (!Number.isFinite(value) && value !== null) return;
      set({ queryTimeoutSeconds: value });
      void write(ANALYTICS_SETTINGS.queryTimeoutSeconds, value);
    },
    reset() {
      set(DEFAULT_ANALYTICS_SETTINGS);
    },
  })
);

/** The provider and model a question goes to (ADR 0008). */
export const aiTargetOf = (
  settings: Pick<
    AnalyticsSettings,
    "aiProvider" | "aiModel" | "aiOpenAiModel" | "aiCompatibleModel"
  >
): { provider: AiProvider; model: string } => {
  switch (settings.aiProvider) {
    case "anthropic":
      return { provider: "anthropic", model: settings.aiModel };
    case "openai":
      return { provider: "openai", model: settings.aiOpenAiModel };
    case "openai_compatible":
      return {
        provider: "openai_compatible",
        model: settings.aiCompatibleModel,
      };
  }
};

/** analytics.seasonStartMonth (1-12), for code outside React. */
export const getSeasonStartMonth = () =>
  useAnalyticsSettingsStore.getState().seasonStartMonth;
