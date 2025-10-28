import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Locale } from "../store/locale.store";
import enUS from "./locales/en-US.json";
import enGB from "./locales/en-GB.json";
import enCA from "./locales/en-CA.json";
import enAU from "./locales/en-AU.json";
import enNZ from "./locales/en-NZ.json";
import frFR from "./locales/fr-FR.json";
import deDE from "./locales/de-DE.json";
import itIT from "./locales/it-IT.json";
import nlNL from "./locales/nl-NL.json";

const resources = {
  "en-US": { translation: enUS },
  "en-GB": { translation: enGB },
  "en-CA": { translation: enCA },
  "en-AU": { translation: enAU },
  "en-NZ": { translation: enNZ },
  "fr-FR": { translation: frFR },
  "de-DE": { translation: deDE },
  "it-IT": { translation: itIT },
  "nl-NL": { translation: nlNL },
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
