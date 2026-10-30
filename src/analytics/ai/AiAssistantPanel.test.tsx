import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../_common/i18n/config";
import { AnalyticsError } from "../engine/errors";
import { AiError, aiErrorDetail, formatAiError, toAiError } from "./aiClient";
import {
  AiAssistantPanel,
  describeAiFailure,
  draftOfState,
  errorActionsOf,
  isSqlInEditor,
} from "./AiAssistantPanel";

beforeEach(async () => {
  await i18n.changeLanguage("fr-FR");
});

describe("AiAssistantPanel", () => {
  it("renders the titled question box, examples and privacy note in French", () => {
    const html = renderToStaticMarkup(
      <AiAssistantPanel onAnswer={() => undefined} currentSql="" />
    );
    for (const text of [
      'aria-labelledby="analytics-ai-title"',
      "Demander à l&#x27;IA</h2>",
      "Posez votre question en français",
      "Ex. : combien de sorties le mardi soir cette saison ?",
      "Exemples de questions :",
      "Quels bateaux sortent le plus le week-end ?",
      "Heures sur l&#x27;eau par type de bateau et par mois",
      "Sans noms de personnes : l&#x27;IA ne connaît pas les rameurs.",
      "Envoyé à Anthropic (Claude) : la question, la structure des tables et les noms des bateaux et des parcours, jamais les données des rameurs.",
      "Ce qui est envoyé",
    ]) {
      expect(html).toContain(text);
    }
    // The key status is still loading: the button holds its place, disabled.
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).not.toContain("Kilomètres par rameur");
    expect(html).not.toContain("À venir");
  });

  it("is a single row in compact mode until used", () => {
    const html = renderToStaticMarkup(
      <AiAssistantPanel onAnswer={() => undefined} currentSql="" compact />
    );
    expect(html).toContain('rows="1"');
    expect(html).not.toContain("Exemples de questions");
    expect(html).not.toContain("Sans noms de personnes");
  });
});

describe("describeAiFailure", () => {
  const t = i18n.t;

  it("formats API errors", () => {
    expect(
      describeAiFailure(
        { error: new AiError("rate_limited", "x", 42), repairFailed: false },
        t
      )
    ).toBe("Trop de demandes pour l'instant. Réessayez dans 42 s.");
    expect(
      describeAiFailure(
        { error: new AiError("network", "x"), repairFailed: false },
        t
      )
    ).toContain("Impossible de joindre votre service d'IA");
    expect(
      describeAiFailure(
        { error: new AiError("invalid_key", "x"), repairFailed: false },
        t,
        "OpenAI"
      )
    ).toBe(
      "La clé API est refusée par OpenAI : elle a peut-être été supprimée, ou mal copiée."
    );
    // A compatible server: "is it started?", not "check the Internet".
    expect(
      describeAiFailure(
        { error: new AiError("network", "x"), repairFailed: false },
        t,
        "localhost:11434",
        "openai_compatible"
      )
    ).toBe(
      "Impossible de joindre localhost:11434 : vérifiez que le serveur d'IA est démarré."
    );
    // The provider's raw (English) message stays out of the sentence.
    const rejected = new AiError("bad_request", "messages.0.content: bad");
    expect(
      describeAiFailure({ error: rejected, repairFailed: false }, t, "OpenAI")
    ).toBe(
      "OpenAI a refusé la demande. Réessayez ; si cela recommence, choisissez un autre modèle."
    );
    expect(aiErrorDetail(rejected)).toBe("messages.0.content: bad");
    expect(aiErrorDetail(new AiError("network", "x"))).toBeNull();
    expect(
      describeAiFailure(
        { error: new AiError("model_not_found", "x"), repairFailed: false },
        t,
        "localhost:11434"
      )
    ).toContain("Modèle introuvable (localhost:11434)");
  });

  it("wraps engine errors, and says when the repairs ran out", () => {
    const error = new AnalyticsError(
      { code: "denied", message: "no", object: "setting.key" },
      { sql: "SELECT key FROM setting" }
    );
    expect(describeAiFailure({ error, repairFailed: true }, t)).toBe(
      "L'IA n'a pas réussi à corriger la requête : Accès refusé à « setting.key » : les statistiques ne lisent que les vues et les tables du dictionnaire."
    );
    expect(
      describeAiFailure(
        {
          error: new AnalyticsError(
            { code: "timeout", message: "x" },
            { timeoutMs: 10_000 }
          ),
          repairFailed: false,
        },
        t
      )
    ).toBe(
      "La requête proposée n'a pas pu s'exécuter : La requête a été arrêtée après 10 s. Réduisez la période ou ajoutez des filtres."
    );
  });
});

describe("error actions", () => {
  const actions = (code: ConstructorParameters<typeof AiError>[0]) =>
    errorActionsOf(new AiError(code, "x"), true);

  it("sends key problems to the settings, never to Réessayer", () => {
    for (const code of [
      "invalid_key",
      "no_key",
      "model_not_allowed",
      "model_not_found",
    ] as const) {
      expect(actions(code), code).toEqual({
        main: "fixSettings",
        copyForUsual: false,
      });
    }
    expect(actions("forbidden")).toEqual({
      main: "fixSettings",
      copyForUsual: true,
    });
  });

  it("retries what may pass next time, and offers the usual AI", () => {
    expect(actions("timeout")).toEqual({ main: "retry", copyForUsual: false });
    expect(actions("network")).toEqual({ main: "retry", copyForUsual: true });
    expect(actions("rate_limited")).toEqual({
      main: "retry",
      copyForUsual: true,
    });
    expect(errorActionsOf(new AiError("timeout", "x"), false).main).toBeNull();
  });

  it("asks to edit the question when the AI cannot answer it", () => {
    expect(actions("refusal").main).toBe("editQuestion");
    expect(actions("truncated").main).toBe("editQuestion");
    const engine = new AnalyticsError({ code: "syntax", message: "x" }, {});
    expect(errorActionsOf(engine, true).main).toBe("editQuestion");
  });
});

describe("AI errors", () => {
  it("maps every IPC error code to a message", () => {
    for (const code of [
      "no_key",
      "invalid_key",
      "forbidden",
      "rate_limited",
      "overloaded",
      "bad_request",
      "network",
      "timeout",
      "refusal",
      "truncated",
      "too_large",
      "model_not_allowed",
      "invalid_response",
      "desktop_only",
      "internal",
    ] as const) {
      const message = formatAiError(new AiError(code, "detail"), i18n.t);
      expect(message, code).not.toContain("analytics.ai");
      expect(message.length, code).toBeGreaterThan(10);
    }
  });

  it("reads the Rust error envelope", () => {
    expect(
      toAiError({ code: "rate_limited", message: "slow", retryAfterSeconds: 7 })
    ).toMatchObject({ code: "rate_limited", retryAfterSeconds: 7 });
    expect(toAiError({ code: "busy", message: "db" })).toMatchObject({
      code: "internal",
      message: "db",
    });
    expect(toAiError("boom")).toMatchObject({
      code: "internal",
      message: "boom",
    });
  });
});

describe("loading a declined answer", () => {
  it("knows whether the editor holds the answer", () => {
    expect(isSqlInEditor("SELECT 1\n  FROM t", " SELECT 1 FROM t ")).toBe(true);
    expect(isSqlInEditor("SELECT 1 FROM t", "SELECT 2 FROM t")).toBe(false);
  });

  it("rebuilds the draft the assistant handed over", () => {
    const draft = draftOfState({
      question: "sorties du week-end",
      chart: { type: "table" },
      answer: {
        title: "",
        sql: "SELECT 1 AS n",
        params: [],
        explanation: "Compte.",
        assumptions: ["Saison"],
        clarification: null,
        choices: [],
        chart: null,
      },
    });
    expect(draft).toMatchObject({
      sql: "SELECT 1 AS n",
      explanation: "Compte.",
      assumptions: ["Saison"],
      chart: { type: "table" },
    });
    expect(draft?.title).toBeTruthy();
    expect(
      draftOfState({ question: "x", chart: null, answer: null })
    ).toBeNull();
  });
});
