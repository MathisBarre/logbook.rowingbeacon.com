import { describe, expect, it } from "vitest";
import deDE from "../_common/i18n/locales/de-DE.json";
import enGB from "../_common/i18n/locales/en-GB.json";
import enUS from "../_common/i18n/locales/en-US.json";
import frFR from "../_common/i18n/locales/fr-FR.json";
import itIT from "../_common/i18n/locales/it-IT.json";
import nlNL from "../_common/i18n/locales/nl-NL.json";
import { MODULE_IDS } from "../_common/business/modules.rules";
import analyticsDeDE from "../analytics/i18n/de-DE/common.json";
import analyticsEnGB from "../analytics/i18n/en-GB/common.json";
import analyticsEnUS from "../analytics/i18n/en-US/common.json";
import analyticsFrFR from "../analytics/i18n/fr-FR/common.json";
import analyticsItIT from "../analytics/i18n/it-IT/common.json";
import analyticsNlNL from "../analytics/i18n/nl-NL/common.json";
import { getReports } from "../analytics/reports/catalog";
import { ANALYTICS_TABS } from "../analytics/store/analyticsHub.store";
import {
  countDone,
  DEMO_GUIDE_GROUPS,
  DEMO_GUIDE_STEPS,
  getGuideGroups,
  stepNeedsAdmin,
} from "./demoGuide";

const LOCALES = [
  { name: "fr-FR", app: frFR, analytics: analyticsFrFR },
  { name: "en-GB", app: enGB, analytics: analyticsEnGB },
  { name: "en-US", app: enUS, analytics: analyticsEnUS },
  { name: "de-DE", app: deDE, analytics: analyticsDeDE },
  { name: "it-IT", app: itIT, analytics: analyticsItIT },
  { name: "nl-NL", app: nlNL, analytics: analyticsNlNL },
];

type StepTexts = Record<string, { title: string; description: string }>;

describe("demo guide", () => {
  it("has a dozen to twenty uniquely named steps", () => {
    const ids = DEMO_GUIDE_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(ids.length).toBeLessThanOrEqual(20);
  });

  it("keeps the statistics group to a few steps", () => {
    const stats = DEMO_GUIDE_STEPS.filter((step) => step.group === "stats");
    expect(stats.length).toBeLessThanOrEqual(6);
    // The first statistics step shipped as "stats": its tick is kept.
    expect(stats.map((step) => step.id)).toContain("stats");
  });

  it("is written in the locale files", () => {
    for (const step of DEMO_GUIDE_STEPS) {
      const text = frFR.demo.guide.steps[
        step.id as keyof typeof frFR.demo.guide.steps
      ] as { title: string; description: string } | undefined;
      expect(text?.title, step.id).toBeTruthy();
      expect(text?.description, step.id).toBeTruthy();
    }
    for (const group of DEMO_GUIDE_GROUPS) {
      expect(frFR.demo.guide.groups[group], group).toBeTruthy();
    }
  });

  it("only opens Gestion tabs from the Gestion page", () => {
    for (const step of DEMO_GUIDE_STEPS) {
      if (step.parametersTab) expect(step.page).toBe("parameters");
    }
  });

  it("groups every step when all modules are on", () => {
    const groups = getGuideGroups(() => true);
    expect(groups.map(({ group }) => group)).toEqual([...DEMO_GUIDE_GROUPS]);
    expect(groups.flatMap(({ steps }) => steps)).toHaveLength(
      DEMO_GUIDE_STEPS.length
    );
  });

  it("hides the steps of a module that is off", () => {
    const groups = getGuideGroups((module) => module !== "reservations");
    const ids = groups.flatMap(({ steps }) => steps.map((step) => step.id));
    expect(ids).not.toContain("reservations");
    expect(groups.map(({ group }) => group)).not.toContain("reservations");
    expect(ids).toContain("startOuting");
  });

  it("only opens existing tabs of Statistiques, from the Statistiques page", () => {
    for (const step of DEMO_GUIDE_STEPS) {
      if (!step.analyticsTab) continue;
      expect(step.page, step.id).toBe("stats");
      expect(ANALYTICS_TABS, step.id).toContain(step.analyticsTab);
    }
    const tabs = DEMO_GUIDE_STEPS.flatMap((step) =>
      step.analyticsTab ? [step.analyticsTab] : []
    );
    // The key features each have their tab.
    expect(new Set(tabs)).toEqual(new Set(ANALYTICS_TABS));
  });

  it("warns about the admin password for Gestion and the Explorer only", () => {
    for (const step of DEMO_GUIDE_STEPS) {
      expect(stepNeedsAdmin(step), step.id).toBe(
        step.page === "parameters" || step.analyticsTab === "explorer"
      );
    }
  });

  it.each(LOCALES)(
    "quotes the real tab and button labels of the statistics screens ($name)",
    ({ app, analytics }) => {
      const steps = app.demo.guide.steps as StepTexts;
      const description = (id: string) => steps[id].description;
      expect(description("stats")).toContain(analytics.tabs.dashboard);
      expect(description("statsReports")).toContain(analytics.tabs.reports);
      expect(description("statsReports")).toContain(analytics.actions.pin);
      expect(description("statsAnnual")).toContain(analytics.tabs.annual);
      expect(description("statsExplorer")).toContain(analytics.tabs.explorer);
      expect(description("statsAi")).toContain(analytics.tabs.explorer);
    }
  );

  it.each(LOCALES)(
    "gives the number of club reports and the AI key requirement ($name)",
    ({ app }) => {
      const steps = app.demo.guide.steps as StepTexts;
      expect(steps.statsReports.description).toContain(
        String(getReports().length)
      );
      // Management > Statistics and AI, where the key is entered.
      expect(steps.statsAi.description).toMatch(/API/);
    }
  );

  it("only needs known modules", () => {
    for (const step of DEMO_GUIDE_STEPS) {
      if (step.module) expect(MODULE_IDS).toContain(step.module);
    }
  });

  it("counts only the ticks of existing steps", () => {
    expect(countDone(["startOuting", "gone"], DEMO_GUIDE_STEPS)).toBe(1);
    expect(countDone([], DEMO_GUIDE_STEPS)).toBe(0);
  });
});
