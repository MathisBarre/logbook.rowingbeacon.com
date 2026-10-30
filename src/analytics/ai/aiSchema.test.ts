import { describe, expect, it } from "vitest";
import { AI_RESPONSE_JSON_SCHEMA, AiResponse } from "./aiSchema";
import answerBar from "./fixtures/answer-bar.json";
import answerKpi from "./fixtures/answer-kpi.json";
import answerYouth from "./fixtures/answer-youth.json";
import clarification from "./fixtures/clarification.json";
import brokenExtraField from "./fixtures/broken-extra-field.json";
import brokenMissingSql from "./fixtures/broken-missing-sql.json";
import responseSchemaSnapshot from "./fixtures/response-schema.json";

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every schema node, with the path that leads to it. */
const walk = (node: unknown, path = "$", out: [string, Node][] = []) => {
  if (!isNode(node)) return out;
  out.push([path, node]);
  if (isNode(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      walk(child, `${path}.${key}`, out);
    }
  }
  if (node.items) walk(node.items, `${path}[]`, out);
  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((child, i) => walk(child, `${path}|${i}`, out));
  }
  return out;
};

const nodes = walk(AI_RESPONSE_JSON_SCHEMA);
const objects = nodes.filter(([, node]) => node.type === "object");

describe("AI_RESPONSE_JSON_SCHEMA", () => {
  // The Rust crate checks this snapshot with ai::check_request (the API
  // limits on unions and optional properties): keep it in sync. After a
  // schema change, write JSON.stringify(AI_RESPONSE_JSON_SCHEMA, null, 2)
  // to fixtures/response-schema.json and run cargo test -p rb-analytics.
  it("matches the snapshot the Rust request checks run on", () => {
    expect(AI_RESPONSE_JSON_SCHEMA).toEqual(responseSchemaSnapshot);
  });

  it("closes every object and requires every property", () => {
    expect(objects.length).toBeGreaterThan(5);
    for (const [path, node] of objects) {
      expect(node.additionalProperties, path).toBe(false);
      const properties = Object.keys(node.properties as Node);
      expect([...(node.required as string[])].sort(), path).toEqual(
        properties.sort()
      );
    }
  });

  it("stays within the API's union and optional-property limits", () => {
    const unions = nodes.filter(
      ([, node]) => Array.isArray(node.anyOf) || Array.isArray(node.type)
    );
    expect(unions.length).toBeLessThanOrEqual(16);
    expect(unions.map(([path]) => path).sort()).toEqual(
      [
        "$.clarification",
        "$.params[].default",
        "$.params[].max",
        "$.params[].min",
        "$.sql",
      ].sort()
    );
    const optional = objects.flatMap(([, node]) =>
      Object.keys(node.properties as Node).filter(
        (key) => !(node.required as string[]).includes(key)
      )
    );
    expect(optional.length).toBeLessThanOrEqual(24);
    expect(optional).toEqual([]);
  });

  it("uses no keyword the API rejects and no recursion", () => {
    const text = JSON.stringify(AI_RESPONSE_JSON_SCHEMA);
    for (const keyword of [
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      "minItems",
      "maxItems",
      "uniqueItems",
      "pattern",
      "$ref",
      "$defs",
      "definitions",
    ]) {
      expect(text).not.toContain(`"${keyword}"`);
    }
  });

  it("matches the zod mirror on the same property names", () => {
    const shape = AiResponse.shape;
    expect(Object.keys(shape).sort()).toEqual(
      Object.keys(
        (AI_RESPONSE_JSON_SCHEMA as { properties: Node }).properties
      ).sort()
    );
  });
});

describe("AiResponse (zod)", () => {
  it.each([
    ["answer-bar", answerBar],
    ["answer-kpi", answerKpi],
    ["answer-youth", answerYouth],
    ["clarification", clarification],
  ])("accepts the %s fixture", (_name, fixture) => {
    expect(AiResponse.safeParse(fixture).success).toBe(true);
  });

  it("rejects an extra field", () => {
    expect(AiResponse.safeParse(brokenExtraField).success).toBe(false);
  });

  it("rejects a missing sql key", () => {
    expect(AiResponse.safeParse(brokenMissingSql).success).toBe(false);
  });

  it("rejects null where the schema uses sentinels", () => {
    const withNull = {
      ...answerBar,
      chart: { ...answerBar.chart, series: null },
    };
    expect(AiResponse.safeParse(withNull).success).toBe(false);
  });
});
