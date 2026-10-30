/**
 * Analytics strings (plan 2.15): one file per locale and namespace,
 * `src/analytics/i18n/<locale>/<namespace>.json`, merged under the
 * `analytics` key of each locale's translation when this module loads. The
 * analytics entry points (the hub, the Gestion tab, ChartView) import it,
 * so the strings travel with the lazy analytics chunks, not the main one.
 * Keys are used as t("analytics.<namespace>.<key>"). A package that needs a
 * new key adds it to the six locales, French first.
 */

import i18n, { LOCALE_ALIASES } from "../../_common/i18n/config";

export const ANALYTICS_LOCALES = [
  "fr-FR",
  "en-US",
  "en-GB",
  "de-DE",
  "it-IT",
  "nl-NL",
] as const;
type AnalyticsLocale = (typeof ANALYTICS_LOCALES)[number];

export const ANALYTICS_NAMESPACES = [
  "common",
  "columns",
  "codes",
  "params",
  "reports",
  "charts",
  "dashboard",
  "annual",
  "explorer",
  "ai",
  "settings",
  "performance",
] as const;

export type AnalyticsStrings = { [key: string]: string | AnalyticsStrings };

const files = import.meta.glob<{ default: AnalyticsStrings }>("./*/*.json", {
  eager: true,
});

const build = () => {
  const resources = Object.fromEntries(
    ANALYTICS_LOCALES.map((locale) => [locale, {}])
  ) as Record<AnalyticsLocale, Record<string, AnalyticsStrings>>;
  for (const [path, module] of Object.entries(files)) {
    const match = /^\.\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const [, locale, namespace] = match;
    if ((ANALYTICS_LOCALES as readonly string[]).includes(locale)) {
      resources[locale as AnalyticsLocale][namespace] = module.default;
    }
  }
  return resources;
};

export const analyticsResources = build();

/** Adds the analytics strings to i18next (idempotent). */
const registerAnalyticsStrings = () => {
  const locales: [string, AnalyticsLocale][] = [
    ...ANALYTICS_LOCALES.map((locale): [string, AnalyticsLocale] => [
      locale,
      locale,
    ]),
    ...Object.entries(LOCALE_ALIASES).flatMap(
      ([alias, target]): [string, AnalyticsLocale][] =>
        (ANALYTICS_LOCALES as readonly string[]).includes(target)
          ? [[alias, target as AnalyticsLocale]]
          : []
    ),
  ];
  for (const [lng, source] of locales) {
    i18n.addResourceBundle(
      lng,
      "translation",
      { analytics: analyticsResources[source] },
      true,
      true
    );
  }
};

registerAnalyticsStrings();
