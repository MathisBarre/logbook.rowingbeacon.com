import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../../_common/i18n/config";
import { InvalidRowersLevelText } from "./InvalidRowersLevelText";

const LOCALES = ["fr-FR", "en-US", "en-GB", "de-DE", "it-IT", "nl-NL"];

const render = (locale: string, nbOfInvalidRowers: number) =>
  renderToStaticMarkup(
    <InvalidRowersLevelText
      t={i18n.getFixedT(locale)}
      nbOfInvalidRowers={nbOfInvalidRowers}
    />
  );

describe("InvalidRowersLevelText", () => {
  it.each(LOCALES)("shows the count in bold in %s", (locale) => {
    for (const nb of [1, 2]) {
      const html = render(locale, nb);
      expect(html.startsWith(`<strong>${nb}</strong> `)).toBe(true);
      expect(html).not.toContain("&lt;");
    }
  });

  it("uses the singular and plural forms", () => {
    expect(render("fr-FR", 1)).toBe(
      "<strong>1</strong> rameur n&#x27;a pas le niveau requis pour ce bateau."
    );
    expect(render("fr-FR", 3)).toBe(
      "<strong>3</strong> rameurs n&#x27;ont pas le niveau requis pour ce bateau."
    );
  });

  // Strings with <0>…</0> tags only render properly through <Trans>.
  it("is the only translation with component tags", () => {
    const taggedKeys = (node: unknown, path: string): string[] =>
      typeof node === "string"
        ? /<\d+>/.test(node)
          ? [path]
          : []
        : Object.entries(node as Record<string, unknown>).flatMap(
            ([key, value]) => taggedKeys(value, path ? `${path}.${key}` : key)
          );

    for (const locale of LOCALES) {
      expect(
        taggedKeys(i18n.getResourceBundle(locale, "translation"), "")
      ).toEqual([
        "session.alert.invalidRowersLevel_one",
        "session.alert.invalidRowersLevel_other",
      ]);
    }
  });
});
