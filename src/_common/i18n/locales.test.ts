import { describe, expect, it } from "vitest";
import enUS from "./locales/en-US.json";
import enGB from "./locales/en-GB.json";
import frFR from "./locales/fr-FR.json";
import deDE from "./locales/de-DE.json";
import itIT from "./locales/it-IT.json";
import nlNL from "./locales/nl-NL.json";

// Languages differ in their plural forms: "seats_one" and "seats_other" are
// one message.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const getMessageKeys = (node: object, prefix = ""): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? getMessageKeys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`.replace(PLURAL_SUFFIX, "")]
  );

const toKeySet = (locale: object) => new Set(getMessageKeys(locale));

describe("locales", () => {
  const reference = toKeySet(frFR);

  it.each([
    ["en-US", enUS],
    ["en-GB", enGB],
    ["de-DE", deDE],
    ["it-IT", itIT],
    ["nl-NL", nlNL],
  ])("%s has the same messages as fr-FR", (_name, locale) => {
    const keys = toKeySet(locale);

    expect([...reference].filter((key) => !keys.has(key))).toEqual([]);
    expect([...keys].filter((key) => !reference.has(key))).toEqual([]);
  });
});
