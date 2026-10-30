import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Locale } from "../store/locale.store";
import enUS from "./locales/en-US.json";
import enGB from "./locales/en-GB.json";
import frFR from "./locales/fr-FR.json";
import deDE from "./locales/de-DE.json";
import itIT from "./locales/it-IT.json";
import nlNL from "./locales/nl-NL.json";
import { tabLabel as enUSTab } from "../../analytics/i18n/en-US/settings.json";
import { tabLabel as enGBTab } from "../../analytics/i18n/en-GB/settings.json";
import { tabLabel as frFRTab } from "../../analytics/i18n/fr-FR/settings.json";
import { tabLabel as deDETab } from "../../analytics/i18n/de-DE/settings.json";
import { tabLabel as itITTab } from "../../analytics/i18n/it-IT/settings.json";
import { tabLabel as nlNLTab } from "../../analytics/i18n/nl-NL/settings.json";

// Analytics keeps its strings in its own files (plan 2.15), under the
// `analytics` key: t("analytics.common.hub.title"). They load with the
// analytics chunks (src/analytics/i18n/index.ts), so the boathouse does not
// carry them; only the Gestion tab label is needed before.
const withTab = <T extends object>(base: T, tabLabel: string) => ({
  ...base,
  analytics: { settings: { tabLabel } },
});
const enUSAll = withTab(enUS, enUSTab);
const enGBAll = withTab(enGB, enGBTab);

const resources = {
  "en-US": { translation: enUSAll },
  "en-GB": { translation: enGBAll },
  "en-CA": { translation: enGBAll },
  "en-AU": { translation: enGBAll },
  "en-NZ": { translation: enGBAll },
  "fr-FR": { translation: withTab(frFR, frFRTab) },
  "de-DE": { translation: withTab(deDE, deDETab) },
  "it-IT": { translation: withTab(itIT, itITTab) },
  "nl-NL": { translation: withTab(nlNL, nlNLTab) },
};

/** Locales of the app that read another locale's strings. */
export const LOCALE_ALIASES: Record<string, string> = {
  "en-CA": "en-GB",
  "en-AU": "en-GB",
  "en-NZ": "en-GB",
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en-US", // will be overridden by locale store
    fallbackLng: "en-US",
    interpolation: {
      escapeValue: false,
    },
  })
  .catch((error) => {
    console.error("Error initializing i18n", error);
  });

export const changeLanguage = (locale: Locale) => {
  void i18n.changeLanguage(locale);
};

export default i18n;
