import { describe, expect, it } from "vitest";
import { z } from "zod";
import fixtures from "./performance-fixtures.json";
import {
  couldGoHigher,
  editorMaxRows,
  limitsOn,
  MachineInfo,
  parsePerformanceChoice,
  PERFORMANCE_LIMITS,
  PERFORMANCE_PROFILES,
  PerformanceChoice,
  PerformanceLimits,
  queryTimeoutMs,
  resolvePerformance,
} from "./performance";

/*
 * The Rust mirror (crates/rb-analytics/src/perf/mod.rs) reads the same
 * fixtures: the table, the machines and how each choice resolves.
 */

const LimitsZ: z.ZodType<PerformanceLimits> = z
  .object({
    queryTimeoutMs: z.number().int(),
    reportTimeoutMs: z.number().int(),
    cardTimeoutMs: z.number().int(),
    maxTimeoutMs: z.number().int(),
    mcpQueryTimeoutMs: z.number().int(),
    mcpReportTimeoutMs: z.number().int(),
    editorRows: z.number().int(),
    maxRows: z.number().int(),
    mcpMaxRows: z.number().int(),
    resultBytes: z.number().int(),
    memoryBudgetBytes: z.number().int(),
    heapLimitBytes: z.number().int(),
    concurrentQueries: z.number().int(),
  })
  .strict();

const MachineZ: z.ZodType<MachineInfo> = z
  .object({
    totalMemoryBytes: z.number().int().nullable(),
    logicalCpus: z.number().int().min(1),
    arch: z.string(),
    os: z.string(),
    raspberryPi: z.boolean(),
    recommended: z.enum(PERFORMANCE_PROFILES),
  })
  .strict();

const MIB = 1024 * 1024;

describe("performance profiles", () => {
  it("mirrors the Rust table", () => {
    for (const profile of PERFORMANCE_PROFILES) {
      expect(LimitsZ.parse(fixtures.limits[profile])).toEqual(
        PERFORMANCE_LIMITS[profile]
      );
    }
  });

  it("keeps Économe at the limits sized for a Raspberry Pi", () => {
    expect(PERFORMANCE_LIMITS.economy).toMatchObject({
      queryTimeoutMs: 10_000,
      reportTimeoutMs: 20_000,
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
    });
  });

  it("parses the machines", () => {
    for (const machine of fixtures.MachineInfo) {
      expect(MachineZ.parse(machine)).toEqual(machine);
    }
  });

  it.each(fixtures.cases.map((c, i) => [i, c] as const))(
    "resolves case %i as Rust does",
    (_, c) => {
      const machine = MachineZ.parse(c.machine);
      const active = resolvePerformance(c.choice as PerformanceChoice, machine);
      expect(active.profile).toBe(c.profile);
      expect(active.limits).toEqual(c.limits);
      expect(couldGoHigher(active.profile, machine)).toBe(c.couldGoHigher);
    }
  );

  it("is Économe without a machine, and never hints then", () => {
    expect(resolvePerformance("auto", null).profile).toBe("economy");
    expect(resolvePerformance("powerful", null).limits.heapLimitBytes).toBe(
      512 * MIB
    );
    expect(couldGoHigher("economy", null)).toBe(false);
  });

  it("never gives more memory than a quarter of the machine", () => {
    for (const profile of PERFORMANCE_PROFILES) {
      for (const gib of [1, 2, 4, 8, 16, 64]) {
        const memory = gib * 1024 * MIB;
        const { heapLimitBytes } = limitsOn(profile, memory);
        expect(
          heapLimitBytes <= 512 * MIB ||
            Math.floor((heapLimitBytes * 4) / 10) * 9 <= memory
        ).toBe(true);
      }
    }
  });

  it("clamps the Explorer's timeout override to the profile", () => {
    const economy = PERFORMANCE_LIMITS.economy;
    expect(queryTimeoutMs(economy, null)).toBe(10_000);
    expect(queryTimeoutMs(economy, 25)).toBe(25_000);
    expect(queryTimeoutMs(economy, 600)).toBe(30_000);
    expect(queryTimeoutMs(economy, 1)).toBe(5_000);
    expect(queryTimeoutMs(PERFORMANCE_LIMITS.powerful, 600)).toBe(300_000);
  });

  it("clamps the Explorer's rows to the profile", () => {
    expect(editorMaxRows(PERFORMANCE_LIMITS.economy, null)).toBe(1_000);
    expect(editorMaxRows(PERFORMANCE_LIMITS.standard, null)).toBe(5_000);
    expect(editorMaxRows(PERFORMANCE_LIMITS.economy, 20_000)).toBe(5_000);
    expect(editorMaxRows(PERFORMANCE_LIMITS.powerful, 20_000)).toBe(20_000);
  });

  it("reads the setting", () => {
    expect(parsePerformanceChoice("standard")).toBe("standard");
    expect(parsePerformanceChoice("auto")).toBe("auto");
    for (const bad of [undefined, null, "turbo", 3, {}]) {
      expect(parsePerformanceChoice(bad)).toBe("auto");
    }
  });
});
