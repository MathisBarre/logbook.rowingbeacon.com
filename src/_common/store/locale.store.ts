import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale =
  | "fr-FR"
  | "en-GB"
  | "en-US"
  | "de-DE"
  | "it-IT"
  | "nl-NL"
  | "en-CA"
  | "en-AU"
  | "en-NZ";

export const LOCALES: Locale[] = [
  "en-US",
  "en-GB",
  "en-CA",
  "en-AU",
  "en-NZ",
  "fr-FR",
  "de-DE",
  "it-IT",
  "nl-NL",
];

export const LOCALE_NAMES: Record<Locale, string> = {
  "fr-FR": "Français (France)",
  "en-GB": "English (United Kingdom)",
  "en-US": "English (United States)",
  "de-DE": "Deutsch (Deutschland)",
  "it-IT": "Italiano (Italia)",
  "nl-NL": "Nederlands (Nederland)",
  "en-CA": "English (Canada)",
  "en-AU": "English (Australia)",
  "en-NZ": "English (New Zealand)",
};

interface LocaleState {
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: null,
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "locale-storage",
    }
  )
);
