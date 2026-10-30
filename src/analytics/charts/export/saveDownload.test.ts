import { describe, expect, it } from "vitest";
import { exportFileName, slugify } from "./saveDownload";
import { exportableChart, exportMenuFileName } from "../ExportMenu";
import { createPrintFrame } from "./html";

describe("export file names", () => {
  it("follows rowing-beacon-<slug>-<season>-<YYYYMMDD>.<ext>", () => {
    const now = new Date(2026, 9, 29, 23, 59);
    expect(exportFileName("boat-usage-ranking", "2025-2026", "csv", now)).toBe(
      "rowing-beacon-boat-usage-ranking-2025-2026-20261029.csv"
    );
    expect(exportFileName("Mes sorties à l'Île", null, "xlsx", now)).toBe(
      "rowing-beacon-mes-sorties-a-l-ile-20261029.xlsx"
    );
    expect(
      exportMenuFileName("rowing-beacon-km-challenge-2025-2026", "png", now)
    ).toBe("rowing-beacon-km-challenge-2025-2026-20261029.png");
  });

  it("never gives an empty slug", () => {
    expect(slugify("???")).toBe("export");
    expect(slugify("x".repeat(100))).toHaveLength(60);
  });
});

describe("PNG export and printing", () => {
  const svg = {} as SVGSVGElement;
  const bar = {
    type: "bar" as const,
    x: "month",
    y: ["n"],
    orientation: "vertical" as const,
    stacked: false,
    sort: "none" as const,
  };

  it("offers the PNG only when a chart SVG is drawn now", () => {
    expect(exportableChart({ current: svg }, bar)).toBe(svg);
    // Table mode, or one row drawn as KPI tiles: no SVG in the card.
    expect(exportableChart({ current: null }, bar)).toBeNull();
    expect(exportableChart(undefined, bar)).toBeNull();
    expect(exportableChart({ current: svg }, { type: "table" })).toBeNull();
    expect(exportableChart({ current: svg }, null)).toBeNull();
  });

  it("prints from a sandboxed frame where no script can run", () => {
    const attributes = new Map<string, string>();
    const frame = {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
    } as unknown as HTMLIFrameElement;
    const doc = { createElement: () => frame } as unknown as Document;
    expect(createPrintFrame(doc)).toBe(frame);
    const sandbox = attributes.get("sandbox") ?? "";
    expect(sandbox.split(" ").sort()).toEqual([
      "allow-modals",
      "allow-same-origin",
    ]);
    expect(sandbox).not.toContain("allow-scripts");
  });
});
