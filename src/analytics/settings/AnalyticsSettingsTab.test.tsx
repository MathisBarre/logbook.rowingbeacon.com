import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { AnalyticsSettingsTab } from "./AnalyticsSettingsTab";
import { AiKeyCard, PrivacyDetails } from "./AiKeyCard";
import {
  clientDisplayName,
  lastCallText,
  McpCard,
  McpClient,
  McpSetup,
} from "./McpCard";
import { RankingsCard } from "./RankingsCard";
import { currentSeasonRange, monthNames } from "./SeasonCard";
import { TechnicalDetails } from "./SettingsControls";
import fixtures from "../engine/ipc-fixtures.json";
import type { McpInfo } from "../engine/ipc";

beforeEach(async () => {
  useAnalyticsSettingsStore.getState().reset();
  await i18n.changeLanguage("fr-FR");
});
type SettingsState = ReturnType<typeof useAnalyticsSettingsStore.getState>;

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/**
 * Server rendering reads the store's initial state (zustand), not the
 * current one: change that object for one test.
 */
const withSettings = (partial: Partial<SettingsState>) => {
  const initial = useAnalyticsSettingsStore.getInitialState();
  const saved = Object.fromEntries(
    Object.keys(partial).map((key) => [
      key,
      initial[key as keyof SettingsState],
    ])
  );
  Object.assign(initial, partial);
  restore = () => Object.assign(initial, saved);
};

describe("AnalyticsSettingsTab", () => {
  it("renders the five cards in French, from basics to expert", () => {
    withSettings({ mcpEnabled: true });
    const html = renderToStaticMarkup(<AnalyticsSettingsTab />);
    const texts = [
      "Statistiques et IA",
      "Début de la saison",
      "Août (par défaut)",
      "Septembre (saison FFAviron)",
      "Janvier (année civile)",
      "Classements",
      "Afficher au hangar les classements avec les noms des rameurs, sans mot de passe",
      "Assistant IA intégré",
      "Utilisé par « Demander à l&#x27;IA » dans l&#x27;Explorer.",
      "Clé API Anthropic",
      "Claude Opus 5.5 (recommandé, le plus fiable)",
      "Envoyer les noms des bateaux et des parcours",
      "Fournisseur d&#x27;IA",
      "OpenAI (GPT)",
      "Autre service compatible (Mistral, Ollama…)",
      "Votre application d&#x27;IA (MCP)",
      "Autoriser les applications d&#x27;IA de cet ordinateur à lire les statistiques du club",
      "Codes à la place des noms (recommandé)",
      "Performances",
    ];
    for (const text of texts) {
      expect(html).toContain(text);
    }
    // One column, in this order.
    const order = [
      "Début de la saison",
      "Afficher au hangar",
      "Assistant IA intégré",
      "Votre application d&#x27;IA (MCP)",
      "Performances",
    ].map((text) => html.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).not.toContain("lg:grid-cols-2");
    expect(html).not.toContain("À venir");
    expect(html).not.toContain(" poste");
  });

  it("explains in plain words what is and is not sent", () => {
    const html = renderToStaticMarkup(<AnalyticsSettingsTab />);
    expect(html).toContain("Jamais les noms des rameurs");
    expect(html).toContain("Envoyé à Anthropic à chaque question");
    expect(html).toContain("Ce qui est envoyé, en détail");
    expect(html).toContain(
      "Chaque réglage est enregistré dès que vous le changez"
    );
  });

  it("says what MCP is while it is off, and nothing more", () => {
    withSettings({ mcpEnabled: false });
    const html = renderToStaticMarkup(<McpCard />);
    expect(html).toContain("directement dans Claude Desktop");
    expect(html).toContain("Désactivé : aucune application ne peut lire");
    expect(html).not.toContain("Codes à la place des noms");
    expect(html).not.toContain("Connecter votre application");
  });

  it("shows the privacy choice and its notice once MCP is on", () => {
    withSettings({ mcpEnabled: true });
    const html = renderToStaticMarkup(<McpCard />);
    expect(html).toContain("Contrairement à l&#x27;assistant intégré");
    expect(html).toContain("Noms des rameurs visibles");
    expect(html).toContain("Préparation de la configuration…");
  });

  it("warns at once when rankings show names at the boathouse", () => {
    withSettings({ publicRankings: true });
    expect(renderToStaticMarkup(<RankingsCard />)).toContain(
      "Tout le monde au hangar voit ces classements"
    );
    restore?.();
    expect(renderToStaticMarkup(<RankingsCard />)).not.toContain(
      "Tout le monde au hangar"
    );
  });

  it("names the switch by its label only, and links its description", () => {
    const html = renderToStaticMarkup(<RankingsCard />);
    const button = /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain(
      'aria-labelledby="analytics-public-rankings-label"'
    );
    expect(button).toContain(
      'aria-describedby="analytics-public-rankings-description"'
    );
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>Désactivé<\/span>/);
  });
});

describe("AiKeyCard", () => {
  it("never shows a stored key: the field starts empty, as a password", () => {
    const html = renderToStaticMarkup(<AiKeyCard />);
    const input =
      /<input[^>]*id="analytics-ai-key"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('type="password"');
    expect(input).toContain('value=""');
    expect(input).toMatch(/autocomplete="off"/i);
    expect(html).not.toContain("sk-ant-api");
  });

  it("puts the key link first and one action last, no dead buttons", () => {
    const html = renderToStaticMarkup(<AiKeyCard />);
    const link = html.indexOf(">console.anthropic.com<");
    const field = html.indexOf('id="analytics-ai-key"');
    const model = html.indexOf('id="analytics-ai-model"');
    const save = html.indexOf("Enregistrer et vérifier");
    expect(link).toBeGreaterThan(0);
    expect(link).toBeLessThan(field);
    expect(field).toBeLessThan(model);
    expect(model).toBeLessThan(save);
    expect(html).not.toContain(">Vérifier<");
    expect(html).not.toContain("Supprimer la clé");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("shows OpenAI's key, models and price when OpenAI is chosen", () => {
    const html = renderToStaticMarkup(<AiKeyCard provider="openai" />);
    for (const text of [
      "Clé API OpenAI",
      "GPT-6.1 Sol (recommandé, fiable et moins cher) · ≈",
      "platform.openai.com",
      "par question habituelle, facturés sur le compte OpenAI du club",
      "Ce qui est envoyé à OpenAI",
      "api.openai.com",
      "Confidentialité",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Clé API Anthropic");
    expect(html).not.toContain("Claude Opus");
  });

  it("asks a compatible server for its address and model, no price", () => {
    const html = renderToStaticMarkup(
      <AiKeyCard provider="openai_compatible" />
    );
    for (const text of [
      "Adresse du serveur",
      "Clé API du serveur (facultative)",
      "Nom du modèle",
      'id="analytics-ai-compatible-model"',
      "Le coût éventuel dépend du serveur",
      'placeholder="Par exemple : llama3.3"',
      "placeholder:font-sans",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("par question habituelle");
    expect(html).not.toContain("Créez une clé sur");
    // The model comes before the action.
    expect(html.indexOf("Nom du modèle")).toBeLessThan(
      html.indexOf("Enregistrer et vérifier")
    );
  });

  it("drops its own box and title inside a dialog", () => {
    const html = renderToStaticMarkup(<AiKeyCard embedded />);
    expect(html).not.toContain("<section");
    expect(html).not.toContain("Assistant IA intégré");
    expect(html).toContain("Clé API Anthropic");
  });
});

describe("PrivacyDetails", () => {
  it("lists boat names only when they are shared", () => {
    expect(renderToStaticMarkup(<PrivacyDetails shareAssets />)).toContain(
      "les noms des bateaux et des parcours"
    );
    const hidden = renderToStaticMarkup(<PrivacyDetails shareAssets={false} />);
    expect(hidden).not.toContain("les noms des bateaux et des parcours");
    expect(hidden).toContain("Jamais envoyé");
  });

  it("names where the request goes, provider by provider", () => {
    const local = renderToStaticMarkup(
      <PrivacyDetails
        shareAssets={false}
        provider="openai_compatible"
        baseUrl="http://localhost:11434/v1"
      />
    );
    expect(local).toContain("Envoyé à localhost:11434 à chaque question");
    expect(local).toContain("la demande ne quitte pas l&#x27;ordinateur");
    const remote = renderToStaticMarkup(
      <PrivacyDetails
        shareAssets={false}
        provider="openai_compatible"
        baseUrl="https://api.mistral.ai/v1"
      />
    );
    expect(remote).toContain("vers api.mistral.ai");
    expect(remote).toContain("lisez ses conditions d&#x27;utilisation");
    expect(
      renderToStaticMarkup(
        <PrivacyDetails shareAssets={false} provider="openai" />
      )
    ).toContain("ne pas conserver la réponse");
  });
});

describe("McpSetup", () => {
  const [windows, linux] = fixtures.McpInfo as McpInfo[];

  it("shows Claude Desktop's numbered steps on Windows", () => {
    const html = renderToStaticMarkup(<McpSetup info={windows} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("<ol");
    expect(html).toContain("Copiez la configuration :");
    expect(html).toContain("claude_desktop_config.json");
    expect(html).toContain("Redémarrez Claude Desktop, puis demandez-lui");
    expect(html).toContain(
      'aria-label="Copier la configuration Claude Desktop"'
    );
    // One client at a time.
    expect(html).not.toContain("claude mcp add");
  });

  it("starts Linux on Claude Code and warns about AppImage paths", () => {
    const html = renderToStaticMarkup(<McpSetup info={linux} />);
    expect(html).toContain("claude mcp add --scope user rowing-beacon");
    expect(html).toContain("Version AppImage");
    const desktop = renderToStaticMarkup(
      <McpSetup info={linux} initialClient="claudeDesktop" />
    );
    expect(desktop).toContain("Claude Desktop n&#x27;existe pas sous Linux");
    expect(desktop).not.toContain("claude_desktop_config.json");
  });

  it("offers Codex, Cursor, VS Code and any other app with their own files", () => {
    const shown = (client: McpClient) =>
      renderToStaticMarkup(<McpSetup info={windows} initialClient={client} />);
    expect(shown("codex")).toContain("%USERPROFILE%\\.codex\\config.toml");
    expect(shown("codex")).toContain("[mcp_servers.rowing-beacon]");
    expect(shown("cursor")).toContain("%USERPROFILE%\\.cursor\\mcp.json");
    expect(shown("vscode")).toContain("MCP: Open User Configuration");
    expect(shown("vscode")).toContain("&quot;servers&quot;");
    const other = shown("other");
    expect(other).toContain("Une autre application compatible MCP");
    expect(other).toContain("Rowing Beacon.exe");
    for (const name of [
      "Claude Desktop",
      "ChatGPT / Codex",
      "VS Code",
      "Autre",
    ]) {
      expect(shown("claudeCode")).toContain(`>${name}</button>`);
    }
  });

  it("names the last app that asked something, in local time", () => {
    const fr = i18n.getFixedT("fr-FR");
    expect(
      lastCallText({ client: "claude-ai", at: "2026-06-19T20:41" }, fr, "fr-FR")
    ).toMatch(
      /^Dernière question reçue : Claude Desktop, le 19 juin (2026 )?à 20:41\.$/
    );
    expect(
      lastCallText({ client: null, at: "2026-06-19T08:05" }, fr, "fr-FR")
    ).toContain("une application");
    expect(clientDisplayName("cursor-vscode")).toBe("Cursor");
    expect(clientDisplayName("my-tool")).toBe("my-tool");
  });
});

describe("SeasonCard helpers", () => {
  it("names the months in the app language", () => {
    expect(monthNames("fr-FR")[7]).toBe("Août");
    expect(monthNames("en-US")[0]).toBe("January");
  });

  it("gives the first and last day of the current season", () => {
    expect(currentSeasonRange(8, "fr-FR", "2025-11-04T10:00")).toEqual({
      start: "1er août 2025",
      end: "31 juillet 2026",
    });
    expect(currentSeasonRange(1, "fr-FR", "2025-11-04T10:00")).toEqual({
      start: "1er janvier 2025",
      end: "31 décembre 2025",
    });
    expect(currentSeasonRange(9, "en-US", "2025-08-31T10:00")).toEqual({
      start: "September 1, 2024",
      end: "August 31, 2025",
    });
  });
});

describe("failure messages", () => {
  it("says what to do in French and folds the raw message away", () => {
    const fr = i18n.getFixedT("fr-FR");
    expect(fr("analytics.settings.ai.status.error")).not.toContain("{{");
    expect(fr("analytics.settings.mcp.infoError")).not.toContain("{{");
    const html = renderToStaticMarkup(
      <TechnicalDetails message="keyring: no Secret Service" />
    );
    expect(html).toContain("<details");
    expect(html).toContain("Détails techniques");
    expect(html).toContain("keyring: no Secret Service");
    expect(renderToStaticMarkup(<TechnicalDetails message=" " />)).toBe("");
  });
});
