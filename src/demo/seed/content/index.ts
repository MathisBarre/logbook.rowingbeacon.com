// Every content pack, by locale.
import type { LocaleContent, StudioLocale } from "./types";
import deDE from "./de-DE";
import enGB from "./en-GB";
import enUS from "./en-US";
import frFR from "./fr-FR";
import itIT from "./it-IT";
import nlNL from "./nl-NL";

export const CONTENT: Record<StudioLocale, LocaleContent> = {
  "fr-FR": frFR,
  "en-US": enUS,
  "en-GB": enGB,
  "de-DE": deDE,
  "it-IT": itIT,
  "nl-NL": nlNL,
};
