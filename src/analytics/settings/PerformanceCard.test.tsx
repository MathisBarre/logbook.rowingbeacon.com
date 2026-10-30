import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import "../i18n";
import { useMachineStore } from "../engine/activePerformance";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import fixtures from "../engine/performance-fixtures.json";
import type { MachineInfo } from "../engine/performance";
import {
  duration,
  machineSentence,
  PerformanceSettings,
} from "./PerformanceCard";

const machines = fixtures.MachineInfo as MachineInfo[];
const [pi4, , laptop, mac, unknown] = machines;

beforeEach(async () => {
  useAnalyticsSettingsStore.getState().reset();
  useMachineStore.setState({ machine: null, status: "idle" });
  await i18n.changeLanguage("fr-FR");
});

describe("PerformanceCard", () => {
  it("describes the machine in plain French", () => {
    expect(machineSentence(laptop, i18n.t, "fr-FR")).toBe(
      "Cet ordinateur : 7,5 Go de mémoire, 8 cœurs. Profil conseillé : Standard."
    );
    expect(machineSentence(mac, i18n.t, "fr-FR")).toBe(
      "Cet ordinateur : 16 Go de mémoire, 10 cœurs. Profil conseillé : Puissant."
    );
    expect(machineSentence(pi4, i18n.t, "fr-FR")).toBe(
      "Raspberry Pi : 3,5 Go de mémoire, 4 cœurs. Profil conseillé : Économe."
    );
    expect(machineSentence(unknown, i18n.t, "fr-FR")).toContain(
      "mémoire inconnue"
    );
  });

  it("offers the four choices and the limits of the profile in use", () => {
    const html = renderToStaticMarkup(
      <PerformanceSettings machine={mac} status="ready" choice="auto" />
    );
    for (const text of [
      "Performances",
      "Cet ordinateur : 16 Go de mémoire, 10 cœurs. Profil conseillé : Puissant.",
      "Auto",
      "Économe",
      "Standard",
      "Puissant",
      "Profil utilisé : Auto, soit Puissant pour cet ordinateur.",
      "Changer de profil",
      "Avancé : les limites du profil Puissant",
      "Requête de l&#x27;Explorer ou de l&#x27;assistant",
      "1 min",
      "2 min",
      "2 Go",
      "Durée maximale d&#x27;une requête",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/checked="" value="auto"/);
    // Folded away on Auto; no Raspberry Pi advice on a desktop.
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain("Un Raspberry Pi doit rester sur Économe");
  });

  it("opens the profiles when one was chosen by hand", () => {
    const html = renderToStaticMarkup(
      <PerformanceSettings machine={mac} status="ready" choice="standard" />
    );
    expect(html).toContain("Profil utilisé : Standard.");
    expect(html).toMatch(/<details[^>]*open/);
  });

  it("writes durations of a minute or more in minutes", () => {
    expect(duration(45_000, i18n.t, "fr-FR")).toBe("45 s");
    expect(duration(60_000, i18n.t, "fr-FR")).toBe("1 min");
    expect(duration(90_000, i18n.t, "fr-FR")).toBe("1,5 min");
    expect(duration(120_000, i18n.t, "fr-FR")).toBe("2 min");
  });

  it("says when the machine is not known", () => {
    const html = renderToStaticMarkup(
      <PerformanceSettings machine={null} status="unavailable" choice="auto" />
    );
    expect(html).toContain("Ici, Auto vaut Économe");
    expect(html).toContain("Avancé : les limites du profil Économe");
  });

  it("warns when a Raspberry Pi is set above Économe", () => {
    const html = renderToStaticMarkup(
      <PerformanceSettings machine={pi4} status="ready" choice="powerful" />
    );
    expect(html).toContain("pas fait pour un Raspberry Pi");
    expect(html).toContain("Un Raspberry Pi doit rester sur Économe");
    // 3.7 GiB: the memory of Standard, not Puissant.
    expect(html).toContain("garde ici la mémoire du profil Standard");
  });
});
