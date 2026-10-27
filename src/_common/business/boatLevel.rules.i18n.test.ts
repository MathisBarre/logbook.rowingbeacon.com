import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { getBoatLevelRestrictionText } from "./boatLevel.rules.i18n";
import { AgeCategoryEnum } from "./ageCategory.rules";
import { SeriousnessCategoryEnum } from "./seriousness.rules";
import enUS from "../i18n/locales/en-US.json";
import enGB from "../i18n/locales/en-GB.json";
import frFR from "../i18n/locales/fr-FR.json";
import deDE from "../i18n/locales/de-DE.json";
import itIT from "../i18n/locales/it-IT.json";
import nlNL from "../i18n/locales/nl-NL.json";

const expected = {
  "fr-FR": {
    age: "Les rameurs de ce bateau doivent être au minimum de catégorie « J16 ».",
    type: "Les rameurs de ce bateau doivent être au minimum de type « Compétiteur ».",
    both: "Les rameurs de ce bateau doivent être au minimum de catégorie « J16 » et de type « Compétiteur ».",
  },
  "en-US": {
    age: "Rowers in this boat must have at least the “J16” category.",
    type: "Rowers in this boat must have at least the “Competitor” type.",
    both: "Rowers in this boat must have at least the “J16” category and the “Competitor” type.",
  },
  "en-GB": {
    age: "Rowers in this boat must have at least the “J16” category.",
    type: "Rowers in this boat must have at least the “Competitor” type.",
    both: "Rowers in this boat must have at least the “J16” category and the “Competitor” type.",
  },
  "de-DE": {
    age: "Ruderer in diesem Boot müssen mindestens der Kategorie „J16“ entsprechen.",
    type: "Ruderer in diesem Boot müssen mindestens dem Typ „Rennsport“ entsprechen.",
    both: "Ruderer in diesem Boot müssen mindestens der Kategorie „J16“ und dem Typ „Rennsport“ entsprechen.",
  },
  "it-IT": {
    age: "I vogatori di questa barca devono essere almeno di categoria «J16».",
    type: "I vogatori di questa barca devono essere almeno di tipo «Agonista».",
    both: "I vogatori di questa barca devono essere almeno di categoria «J16» e di tipo «Agonista».",
  },
  "nl-NL": {
    age: "Roeiers in deze boot moeten minimaal categorie ‘J16’ hebben.",
    type: "Roeiers in deze boot moeten minimaal type ‘Wedstrijdroeier’ hebben.",
    both: "Roeiers in deze boot moeten minimaal categorie ‘J16’ en type ‘Wedstrijdroeier’ hebben.",
  },
};

describe("getBoatLevelRestrictionText", () => {
  const i18n = i18next.createInstance();

  beforeAll(async () => {
    await i18n.init({
      resources: {
        "en-US": { translation: enUS },
        "en-GB": { translation: enGB },
        "fr-FR": { translation: frFR },
        "de-DE": { translation: deDE },
        "it-IT": { translation: itIT },
        "nl-NL": { translation: nlNL },
      },
      lng: "en-US",
      interpolation: { escapeValue: false },
    });
  });

  it("returns null when the boat has no minimum level", () => {
    const t = i18n.getFixedT("fr-FR");
    expect(
      getBoatLevelRestrictionText(
        { ageCategory: null, seriousnessCategory: null },
        t
      )
    ).toBeNull();
  });

  describe.each(Object.entries(expected))("%s", (locale, sentences) => {
    const t = () => i18n.getFixedT(locale);

    it("states the category alone", () => {
      expect(
        getBoatLevelRestrictionText(
          { ageCategory: AgeCategoryEnum.J16, seriousnessCategory: null },
          t()
        )
      ).toBe(sentences.age);
    });

    it("states the type alone", () => {
      expect(
        getBoatLevelRestrictionText(
          {
            ageCategory: null,
            seriousnessCategory: SeriousnessCategoryEnum.COMPETITOR,
          },
          t()
        )
      ).toBe(sentences.type);
    });

    it("states both the category and the type", () => {
      expect(
        getBoatLevelRestrictionText(
          {
            ageCategory: AgeCategoryEnum.J16,
            seriousnessCategory: SeriousnessCategoryEnum.COMPETITOR,
          },
          t()
        )
      ).toBe(sentences.both);
    });
  });
});
