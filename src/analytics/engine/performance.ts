/**
 * Performance profiles (ADR 0008, "Performance profiles"): the limits of
 * the engine, the app and the MCP server, sized by machine. Mirror of
 * src-tauri/crates/rb-analytics/src/perf/mod.rs; both sides test against
 * performance-fixtures.json.
 *
 * Économe keeps the values sized for a Raspberry Pi (plan 2.14). The club
 * chooses in Gestion › Statistiques et IA (`analytics.performance.profile`,
 * "auto" by default: the profile Rust recommends for the machine). Rust
 * reads the same setting and clamps every request to its profile, so a
 * value sent from here can only ever be lower than what Rust allows.
 *
 * Pure and dependency-free: the settings store imports it.
 */

export const PERFORMANCE_PROFILES = [
  "economy",
  "standard",
  "powerful",
] as const;
export type PerformanceProfile = (typeof PERFORMANCE_PROFILES)[number];
export const PERFORMANCE_CHOICES = ["auto", ...PERFORMANCE_PROFILES] as const;
export type PerformanceChoice = (typeof PERFORMANCE_CHOICES)[number];

/** Times in milliseconds, sizes in bytes. */
export interface PerformanceLimits {
  /** Explorer, AI assistant and proposal previews. */
  queryTimeoutMs: number;
  /** A report and the annual report. */
  reportTimeoutMs: number;
  /** One dashboard card. */
  cardTimeoutMs: number;
  /** Rust clamps every request to it; ceiling of the Explorer override. */
  maxTimeoutMs: number;
  mcpQueryTimeoutMs: number;
  mcpReportTimeoutMs: number;
  /** Explorer rows when `analytics.editor.maxRows` is not set. */
  editorRows: number;
  /** Rust clamps every request's maxRows to it. */
  maxRows: number;
  mcpMaxRows: number;
  resultBytes: number;
  memoryBudgetBytes: number;
  /** Process-wide SQLite heap limit. */
  heapLimitBytes: number;
  /** Queries the queue runs at once. */
  concurrentQueries: number;
}

/** `analytics_machine_info` (Rust `perf::MachineInfo`). */
export interface MachineInfo {
  /** null when it could not be read. */
  totalMemoryBytes: number | null;
  logicalCpus: number;
  /** "x86_64", "aarch64"… */
  arch: string;
  /** "linux", "macos", "windows"… */
  os: string;
  raspberryPi: boolean;
  /** What "auto" resolves to. */
  recommended: PerformanceProfile;
}

const MIB = 1024 * 1024;

export const PERFORMANCE_LIMITS: Record<PerformanceProfile, PerformanceLimits> =
  {
    economy: {
      queryTimeoutMs: 10_000,
      reportTimeoutMs: 20_000,
      cardTimeoutMs: 20_000,
      maxTimeoutMs: 30_000,
      mcpQueryTimeoutMs: 10_000,
      mcpReportTimeoutMs: 20_000,
      editorRows: 1_000,
      maxRows: 5_000,
      mcpMaxRows: 500,
      resultBytes: 8 * MIB,
      memoryBudgetBytes: 256 * MIB,
      heapLimitBytes: 512 * MIB,
      concurrentQueries: 1,
    },
    standard: {
      queryTimeoutMs: 30_000,
      reportTimeoutMs: 60_000,
      cardTimeoutMs: 30_000,
      maxTimeoutMs: 120_000,
      mcpQueryTimeoutMs: 20_000,
      mcpReportTimeoutMs: 40_000,
      editorRows: 5_000,
      maxRows: 20_000,
      mcpMaxRows: 500,
      resultBytes: 32 * MIB,
      memoryBudgetBytes: 384 * MIB,
      heapLimitBytes: 1024 * MIB,
      concurrentQueries: 2,
    },
    powerful: {
      queryTimeoutMs: 60_000,
      reportTimeoutMs: 120_000,
      cardTimeoutMs: 60_000,
      maxTimeoutMs: 300_000,
      mcpQueryTimeoutMs: 30_000,
      mcpReportTimeoutMs: 50_000,
      editorRows: 10_000,
      maxRows: 50_000,
      mcpMaxRows: 500,
      resultBytes: 64 * MIB,
      memoryBudgetBytes: 768 * MIB,
      heapLimitBytes: 2048 * MIB,
      concurrentQueries: 2,
    },
  };

/** Shortest and longest value of the Explorer's "longest query" setting. */
export const MIN_QUERY_TIMEOUT_SECONDS = 5;

const rank = (profile: PerformanceProfile) =>
  PERFORMANCE_PROFILES.indexOf(profile);

/**
 * A profile's heap limit is at most a quarter of the machine's memory,
 * with 10 % of tolerance ("8 GB" reports 7.6 GiB). Économe always fits.
 */
export const memoryFits = (
  profile: PerformanceProfile,
  totalMemoryBytes: number | null
) =>
  profile === "economy" ||
  (totalMemoryBytes !== null &&
    totalMemoryBytes >=
      Math.floor((PERFORMANCE_LIMITS[profile].heapLimitBytes * 4) / 10) * 9);

/**
 * Times and rows of `profile`; memory, result size and concurrency of the
 * highest profile up to it that fits the machine's memory.
 */
export const limitsOn = (
  profile: PerformanceProfile,
  totalMemoryBytes: number | null
): PerformanceLimits => {
  const memory =
    [...PERFORMANCE_PROFILES]
      .reverse()
      .filter((p) => rank(p) <= rank(profile))
      .find((p) => memoryFits(p, totalMemoryBytes)) ?? "economy";
  const ofMemory = PERFORMANCE_LIMITS[memory];
  return {
    ...PERFORMANCE_LIMITS[profile],
    resultBytes: ofMemory.resultBytes,
    memoryBudgetBytes: ofMemory.memoryBudgetBytes,
    heapLimitBytes: ofMemory.heapLimitBytes,
    concurrentQueries: ofMemory.concurrentQueries,
  };
};

/** "auto" follows the machine; no machine (tests, browser) is Économe. */
export const resolveProfile = (
  choice: PerformanceChoice,
  machine: MachineInfo | null
): PerformanceProfile =>
  choice === "auto" ? (machine?.recommended ?? "economy") : choice;

export interface ActivePerformance {
  profile: PerformanceProfile;
  limits: PerformanceLimits;
}

export const resolvePerformance = (
  choice: PerformanceChoice,
  machine: MachineInfo | null
): ActivePerformance => {
  const profile = resolveProfile(choice, machine);
  return {
    profile,
    limits: limitsOn(profile, machine?.totalMemoryBytes ?? null),
  };
};

/** The machine would suit a heavier profile than the one in use. */
export const couldGoHigher = (
  profile: PerformanceProfile,
  machine: MachineInfo | null
) => machine !== null && rank(profile) < rank(machine.recommended);

/**
 * Timeout of the Explorer and the AI: the club's override (seconds) when
 * set, clamped to 5 s … the profile's `maxTimeoutMs`; else the profile's.
 */
export const queryTimeoutMs = (
  limits: PerformanceLimits,
  overrideSeconds: number | null
) =>
  overrideSeconds === null
    ? limits.queryTimeoutMs
    : Math.min(
        Math.max(Math.round(overrideSeconds), MIN_QUERY_TIMEOUT_SECONDS) * 1000,
        limits.maxTimeoutMs
      );

/**
 * Rows of the Explorer: the club's `analytics.editor.maxRows` when set,
 * clamped to the profile's `maxRows`; else the profile's `editorRows`.
 */
export const editorMaxRows = (
  limits: PerformanceLimits,
  setting: number | null
) => (setting === null ? limits.editorRows : Math.min(setting, limits.maxRows));

/** The choice stored in the setting; anything else is "auto". */
export const parsePerformanceChoice = (value: unknown): PerformanceChoice =>
  (PERFORMANCE_CHOICES as readonly unknown[]).includes(value)
    ? (value as PerformanceChoice)
    : "auto";
