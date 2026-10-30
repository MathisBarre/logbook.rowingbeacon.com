import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../_common/i18n/config";
import { CHART_THEMES } from "../palette";
import type { ChartContext } from "../model";
import { scaleLegendLayout, scaleLegendX } from "./Heatmap";

const ctx = (): ChartContext => ({
  t: i18n.getFixedT("fr-FR"),
  locale: "fr-FR",
  seasonStartMonth: 8,
  params: {},
  theme: CHART_THEMES.light,
});

beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});

const texts = (layout: ReturnType<typeof scaleLegendLayout>) =>
  layout.items.map(({ part }) =>
    part.kind === "ramp" ? `${part.less} [ramp]` : part.text
  );

describe("the heatmap and calendar scale", () => {
  it("reads measure, none, less, ramp, more on one line in a wide card", () => {
    const layout = scaleLegendLayout(ctx(), 636, {
      measure: "Sorties",
      maxText: "1 234",
    });
    expect(layout.lines).toBe(1);
    expect(texts(layout).map((t) => t.replace(/\u202f/g, " "))).toEqual([
      "Sorties :",
      "Aucune",
      "Moins [ramp]",
      "Plus (1 234)",
    ]);
    expect(scaleLegendX(layout, 90, 640)).toBe(90);
  });

  it("wraps to fit a narrow column, such as the Proposals preview", () => {
    for (const width of [400, 300, 240, 180]) {
      const layout = scaleLegendLayout(ctx(), width - 4, {
        measure: "Sorties",
        maxText: "1 234",
      });
      expect(layout.width, String(width)).toBeLessThanOrEqual(width - 4);
      const x = scaleLegendX(layout, 90, width);
      expect(x + layout.width).toBeLessThanOrEqual(width);
    }
    expect(
      scaleLegendLayout(ctx(), 176, { measure: "Sorties", maxText: "1 234" })
        .lines
    ).toBeGreaterThan(1);
  });

  it("shows both ends of a diverging scale", () => {
    const layout = scaleLegendLayout(ctx(), 636, {
      maxText: "4",
      minText: "−4",
    });
    expect(texts(layout)).toContain("Moins (−4) [ramp]");
  });
});
