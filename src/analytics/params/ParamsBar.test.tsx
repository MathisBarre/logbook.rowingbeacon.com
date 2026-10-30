import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import type { ParamDef } from "../chartSpec";
import { ParamsBar } from "./ParamsBar";
import {
  allLabel,
  clampInteger,
  optionLabel,
  paramLabel,
  paramStep,
} from "./ParamInput";

beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
});

const defs: ParamDef[] = [
  { name: "season", type: "season", required: true, default: "current" },
  {
    name: "metric",
    type: "choice",
    required: true,
    default: "outings",
    options: [{ value: "outings" }, { value: "km" }, { value: "hours" }],
  },
  {
    name: "rower_status",
    type: "choice",
    required: false,
    default: null,
    options: [{ value: "member" }, { value: "guest" }, { value: "other" }],
  },
  {
    name: "days",
    type: "integer",
    labelKey: "analytics.params.absentDays",
    required: true,
    default: 45,
    min: 7,
    max: 730,
  },
  { name: "start_date", type: "date", required: false, default: null },
  {
    name: "is_open",
    type: "boolean",
    label: "Ouvert",
    required: false,
    default: null,
  },
];

describe("ParamsBar", () => {
  it("renders one touch-size control per visible parameter", () => {
    const html = renderToStaticMarkup(
      <ParamsBar
        defs={defs}
        values={{ days: 5 }}
        onChange={() => undefined}
        hidden={["season"]}
      />
    );
    expect(html).not.toContain('data-param="season"');
    expect(html).toContain("Afficher");
    expect(html).toContain('aria-label="Paramètres du rapport"');
    expect(html).toContain("Sorties");
    expect(html).toContain("Kilomètres");
    expect(html).toContain("Tous les statuts");
    expect(html).toContain("Invité");
    expect(html).toContain("Absent depuis au moins (jours)");
    // − and + around the number, a week at a time.
    expect(html).toContain(
      'aria-label="Diminuer\u202f: Absent depuis au moins (jours)"'
    );
    expect(html).toContain('type="date"');
    expect(html).toContain("Ouvert");
    // days = 5 is under the minimum (a stored value).
    expect(html).toContain("Entre 7 et 730");
    expect(html).toContain('aria-invalid="true"');
    for (const control of html.match(/<(button|input|select)[^>]*>/g) ?? []) {
      expect(control).toContain("min-h-11");
    }
  });

  it("renders nothing when every parameter is hidden", () => {
    expect(
      renderToStaticMarkup(
        <ParamsBar
          defs={defs.slice(0, 1)}
          values={{}}
          onChange={() => undefined}
          hidden={["season"]}
        />
      )
    ).toBe("");
  });

  it("shows the season list with the current season", () => {
    const html = renderToStaticMarkup(
      <ParamsBar
        defs={defs.slice(0, 1)}
        values={{}}
        onChange={() => undefined}
      />
    );
    expect(html).toContain("Saison en cours");
    expect(html).toContain("<select");
  });
});

describe("labels", () => {
  const t = i18n.getFixedT("fr-FR");
  it("resolves parameter, empty-value and option labels", () => {
    expect(paramLabel(defs[3], t)).toBe("Absent depuis au moins (jours)");
    expect(
      paramLabel(
        {
          name: "zzz",
          type: "text",
          label: "Mon filtre",
          required: false,
          default: null,
        },
        t
      )
    ).toBe("Mon filtre");
    expect(
      paramLabel(
        { name: "zzz", type: "text", required: false, default: null },
        t
      )
    ).toBe("zzz");
    expect(allLabel(defs[2], t)).toBe("Tous les statuts");
    expect(allLabel(defs[5], t)).toBe("Tous");
    expect(optionLabel(defs[1], { value: "km" }, t)).toBe("Kilomètres");
    expect(optionLabel(defs[1], { value: "x", label: "Libre" }, t)).toBe(
      "Libre"
    );
    expect(optionLabel(defs[1], { value: "J16" }, t)).toBe("J16");
  });
});

describe("numbers", () => {
  it("brings a typed number within its range", () => {
    const days = defs[3];
    expect(clampInteger(3, days)).toEqual({ value: 7, clamped: "min" });
    expect(clampInteger(9000, days)).toEqual({ value: 730, clamped: "max" });
    expect(clampInteger(45, days)).toEqual({ value: 45, clamped: null });
  });

  it("steps by a week, a month, five minutes or one", () => {
    expect(paramStep(defs[3])).toBe(7);
    expect(
      paramStep({
        name: "days",
        type: "integer",
        labelKey: "analytics.params.periodDays",
        required: true,
        default: 365,
      })
    ).toBe(30);
    expect(
      paramStep({
        name: "tolerance_min",
        type: "integer",
        required: true,
        default: 15,
      })
    ).toBe(5);
    expect(
      paramStep({
        name: "min_outings",
        type: "integer",
        required: true,
        default: 5,
      })
    ).toBe(1);
  });
});

describe("Explorer options", () => {
  it("names the current season and leaves the labels to the page", () => {
    const html = renderToStaticMarkup(
      <ParamsBar
        defs={[defs[0], defs[1]]}
        values={{}}
        onChange={() => undefined}
        currentLabel="Saison choisie en haut (2024-2025)"
        hideLabels
      />
    );
    expect(html).toContain("Saison choisie en haut (2024-2025)");
    expect(html).toContain('aria-labelledby="param-season"');
    expect(html).toContain('aria-labelledby="param-metric"');
    expect(html).not.toContain("Afficher");
  });

  it("flags a required value without default", () => {
    const html = renderToStaticMarkup(
      <ParamsBar
        defs={[
          {
            name: "boat_class",
            type: "choice",
            required: true,
            default: null,
            options: Array.from({ length: 8 }, (_, i) => ({
              value: `c${i}`,
            })),
          },
        ]}
        values={{}}
        onChange={() => undefined}
      />
    );
    expect(html).toContain("Valeur requise");
    expect(html).toMatch(/<option value="" disabled=""/);
  });

  it("gives one tab stop to a group of choices", () => {
    const html = renderToStaticMarkup(
      <ParamsBar
        defs={[defs[1]]}
        values={{ metric: "km" }}
        onChange={() => undefined}
      />
    );
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });
});
