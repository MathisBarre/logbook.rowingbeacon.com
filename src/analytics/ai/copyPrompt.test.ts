import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCopyText, parsePastedAnswer, questionTitle } from "./copyPrompt";
import answerBar from "./fixtures/answer-bar.json";
import answerYouth from "./fixtures/answer-youth.json";
import clarification from "./fixtures/clarification.json";

const pasteSqlBlock = readFileSync(
  new URL("./fixtures/paste-sql-block.txt", import.meta.url),
  "utf8"
);

const QUESTION = "Combien de jeunes sont sortis chaque mois cette saison ?";

describe("buildCopyText", () => {
  it("contains the system prompt, the question and the JSON Schema", () => {
    const text = buildCopyText("SYSTEM PROMPT\n", `  ${QUESTION}  `);
    expect(text.startsWith("SYSTEM PROMPT\n")).toBe(true);
    expect(text).toContain(`# Question\n${QUESTION}\n`);
    expect(text).toContain(
      "Answer only with a JSON object matching this JSON Schema"
    );
    expect(text).toContain('"additionalProperties":false');
  });

  it("starts with a line in the app's language when given one", () => {
    const text = buildCopyText("SYSTEM", QUESTION, "Demande préparée.");
    expect(text.startsWith("Demande préparée.\n\nSYSTEM")).toBe(true);
  });
});

describe("parsePastedAnswer", () => {
  it("reads the clarification's choices, and none when they are missing", () => {
    const withChoices = parsePastedAnswer(
      JSON.stringify(clarification),
      QUESTION
    );
    expect(withChoices.ok && withChoices.answer.choices).toEqual([
      "Les sorties",
      "Les rameurs présents",
    ]);
    const without: Record<string, unknown> = { ...clarification };
    delete without.choices;
    const result = parsePastedAnswer(JSON.stringify(without), QUESTION);
    expect(result.ok && result.answer.choices).toEqual([]);
  });

  it("accepts the JSON answer", () => {
    const result = parsePastedAnswer(
      JSON.stringify(answerBar, null, 2),
      QUESTION
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("json");
    expect(result.answer.title).toBe(answerBar.title);
    expect(result.answer.sql).toBe(answerBar.sql);
    expect(result.answer.chart).toMatchObject({ type: "bar", x: "boat_name" });
  });

  it("accepts JSON inside a code block surrounded by prose", () => {
    const text = `Voici la réponse :\n\n\`\`\`json\n${JSON.stringify(answerBar)}\n\`\`\`\n\nBonne analyse !`;
    const result = parsePastedAnswer(text, QUESTION);
    expect(result.ok && result.answer.sql).toBe(answerBar.sql);
  });

  it("accepts a loose JSON answer with nulls and missing fields", () => {
    const loose = {
      title: "Sorties",
      sql: "SELECT COUNT(*) AS outings FROM v_outings WHERE season = :season",
      params: [{ name: "season", type: "season" }],
      chart: {
        type: "kpi",
        kpis: [{ value: "outings", compare: null, format: null }],
      },
      assumptions: null,
      clarification: null,
    };
    const result = parsePastedAnswer(JSON.stringify(loose), QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.params).toEqual([
      { name: "season", type: "season", required: false, default: "current" },
    ]);
    expect(result.answer.chart).toEqual({
      type: "kpi",
      items: [{ value: "outings", higherIsBetter: true }],
    });
    expect(result.answer.assumptions).toEqual([]);
  });

  it("accepts a clarification", () => {
    const result = parsePastedAnswer(JSON.stringify(clarification), QUESTION);
    expect(result.ok && result.answer.sql).toBeNull();
    expect(result.ok && result.answer.clarification).toBe(
      clarification.clarification
    );
  });

  it("extracts the fenced SQL block of a claude.ai answer", () => {
    const result = parsePastedAnswer(pasteSqlBlock, QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("sql");
    expect(result.answer.sql).toBe(answerYouth.sql);
    expect(result.answer.title).toBe(questionTitle(QUESTION));
    expect(result.answer.params).toEqual([
      { name: "season", type: "season", required: true, default: "current" },
    ]);
    expect(result.answer.chart).toBeNull();
  });

  it("reads an answer pasted with Windows line endings", () => {
    const result = parsePastedAnswer(
      pasteSqlBlock.replace(/\r?\n/g, "\r\n"),
      QUESTION
    );
    expect(result.ok && result.answer.sql).toBe(answerYouth.sql);
  });

  it("accepts a bare SELECT and a trailing semicolon", () => {
    const result = parsePastedAnswer(
      "SELECT boat_name FROM v_boats;",
      QUESTION
    );
    expect(result.ok && result.answer.sql).toBe(
      "SELECT boat_name FROM v_boats"
    );
  });

  it.each([
    "",
    "   ",
    "Je ne peux pas répondre à cette question.",
    '{"title": "Sans requête"}',
    "```sql\nDELETE FROM outing\n```",
    "```python\nprint('hello')\n```",
  ])("rejects %j", (text) => {
    expect(parsePastedAnswer(text, QUESTION)).toEqual({ ok: false });
  });
});

describe("questionTitle", () => {
  it("cuts long questions to 60 characters", () => {
    const title = questionTitle(`${"mot ".repeat(40)}`);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });
});
