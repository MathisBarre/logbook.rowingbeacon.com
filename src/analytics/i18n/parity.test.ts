import { describe, expect, it } from "vitest";
import {
  ANALYTICS_LOCALES,
  ANALYTICS_NAMESPACES,
  analyticsResources,
  AnalyticsStrings,
} from "./index";
import { ANALYTICS_ERROR_CODES } from "../types";

const PLURAL = /_(zero|one|two|few|many|other)$/;

const flatten = (strings: AnalyticsStrings, prefix = ""): [string, string][] =>
  Object.entries(strings).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value] as [string, string]]
      : flatten(value, `${prefix}${key}.`)
  );

/** Base key (plural suffix stripped) → placeholders used by its forms. */
const summarize = (strings: AnalyticsStrings) => {
  const summary = new Map<string, Set<string>>();
  for (const [key, value] of flatten(strings)) {
    const base = key.replace(PLURAL, "");
    const placeholders = summary.get(base) ?? new Set<string>();
    for (const match of value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      placeholders.add(match[1]);
    }
    summary.set(base, placeholders);
  }
  return summary;
};

describe("analytics i18n parity", () => {
  it("loads every locale and namespace", () => {
    for (const locale of ANALYTICS_LOCALES) {
      expect(Object.keys(analyticsResources[locale]).sort()).toEqual(
        [...ANALYTICS_NAMESPACES].sort()
      );
    }
  });

  describe.each(ANALYTICS_NAMESPACES)("%s", (namespace) => {
    const reference = summarize(analyticsResources["fr-FR"][namespace]);

    it.each(ANALYTICS_LOCALES.filter((locale) => locale !== "fr-FR"))(
      "%s has the keys and placeholders of fr-FR",
      (locale) => {
        const other = summarize(analyticsResources[locale][namespace]);
        expect([...other.keys()].sort()).toEqual([...reference.keys()].sort());
        for (const [key, placeholders] of reference) {
          expect(
            [...(other.get(key) ?? [])].sort(),
            `${locale} ${key}`
          ).toEqual([...placeholders].sort());
        }
      }
    );

    it.each(ANALYTICS_LOCALES)("%s has no empty string", (locale) => {
      for (const [key, value] of flatten(
        analyticsResources[locale][namespace]
      )) {
        expect(value.trim(), `${locale} ${namespace}.${key}`).not.toBe("");
      }
    });
  });

  it("has a message for every engine error code", () => {
    const errors = analyticsResources["fr-FR"].common
      .errors as AnalyticsStrings;
    for (const code of ANALYTICS_ERROR_CODES) {
      expect(typeof errors[code], code).toBe("string");
    }
  });
});
