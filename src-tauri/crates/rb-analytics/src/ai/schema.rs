//! The answer schema, provider by provider (ADR 0008, "AI providers").
//!
//! The app sends one JSON Schema (`AI_RESPONSE_JSON_SCHEMA`, appendix E.2)
//! whatever the provider. It is written to the strictest common subset:
//! every object closed (`additionalProperties: false`) with every property
//! required, unions only through `anyOf` with `null`, no length, range or
//! pattern keyword, no `$ref`. Each provider then gets:
//!
//! - **Anthropic**: the schema as it is, checked against the structured
//!   outputs limits (16 union-typed and 24 optional properties,
//!   `schema_complexity`);
//! - **OpenAI and compatible servers** (`strict: true`): `openai_strict`,
//!   which closes every object and makes every property required (an
//!   optional one becomes nullable), and removes the keywords strict mode
//!   rejects; then `check_openai_strict` checks the documented limits
//!   (re-checked 2026-10-29): root an object and not `anyOf`; at most 5,000
//!   object properties and 10 levels of nesting; at most 1,000 enum values;
//!   at most 120,000 characters of property names, definition names, enum
//!   and const values. For the app's schema the transform is the identity
//!   (a test checks it on the shared snapshot).

use serde_json::{json, Map, Value};

pub const OPENAI_MAX_PROPERTIES: usize = 5000;
pub const OPENAI_MAX_DEPTH: usize = 10;
pub const OPENAI_MAX_ENUM_VALUES: usize = 1000;
pub const OPENAI_MAX_SCHEMA_STRING_CHARS: usize = 120_000;

/// Keywords OpenAI's strict mode does not support (composition, and the
/// string, object and array keywords outside its subset; `minLength` and
/// `maxLength` are left out to be safe, the app checks lengths itself).
const OPENAI_UNSUPPORTED: [&str; 19] = [
    "minLength",
    "maxLength",
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "dependentSchemas",
    "patternProperties",
    "unevaluatedProperties",
    "propertyNames",
    "minProperties",
    "maxProperties",
    "unevaluatedItems",
    "contains",
    "minContains",
    "maxContains",
    "uniqueItems",
];

/// Counts the union-typed and optional parameters of a JSON Schema the way
/// Anthropic's structured-outputs limits do: every property schema whose
/// type is an array or that uses `anyOf` counts as a union, every property
/// missing from its object's `required` counts as optional, recursively.
pub(crate) fn schema_complexity(schema: &Value) -> (usize, usize) {
    fn is_union(schema: &Value) -> bool {
        schema.get("anyOf").is_some() || schema.get("type").is_some_and(Value::is_array)
    }
    fn walk(schema: &Value, unions: &mut usize, optional: &mut usize) {
        match schema {
            Value::Object(map) => {
                if let Some(Value::Object(properties)) = map.get("properties") {
                    let required: Vec<&str> = map
                        .get("required")
                        .and_then(Value::as_array)
                        .map(|list| list.iter().filter_map(Value::as_str).collect())
                        .unwrap_or_default();
                    for (name, property) in properties {
                        if is_union(property) {
                            *unions += 1;
                        }
                        if !required.contains(&name.as_str()) {
                            *optional += 1;
                        }
                    }
                }
                for (key, value) in map {
                    if key != "required" && key != "enum" && key != "const" {
                        walk(value, unions, optional);
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, unions, optional);
                }
            }
            _ => {}
        }
    }
    let (mut unions, mut optional) = (0, 0);
    walk(schema, &mut unions, &mut optional);
    (unions, optional)
}

fn is_nullable(schema: &Value) -> bool {
    let null_type = |value: &Value| value.get("type") == Some(&json!("null"));
    match schema.get("type") {
        Some(Value::Array(types)) if types.contains(&json!("null")) => return true,
        Some(Value::String(kind)) if kind == "null" => return true,
        _ => {}
    }
    schema
        .get("anyOf")
        .and_then(Value::as_array)
        .is_some_and(|branches| branches.iter().any(null_type))
}

/// The schema as OpenAI's strict mode wants it (see the module comment).
pub(crate) fn openai_strict(schema: &Value) -> Value {
    fn transform(schema: &Value) -> Value {
        let Value::Object(map) = schema else {
            return schema.clone();
        };
        let mut out = Map::new();
        for (key, value) in map {
            if OPENAI_UNSUPPORTED.contains(&key.as_str()) {
                continue;
            }
            let value = match key.as_str() {
                "items" | "additionalItems" => transform(value),
                "anyOf" | "prefixItems" => match value {
                    Value::Array(list) => Value::Array(list.iter().map(transform).collect()),
                    other => other.clone(),
                },
                "$defs" | "definitions" => match value {
                    Value::Object(defs) => Value::Object(
                        defs.iter()
                            .map(|(name, def)| (name.clone(), transform(def)))
                            .collect(),
                    ),
                    other => other.clone(),
                },
                _ => value.clone(),
            };
            out.insert(key.clone(), value);
        }
        if let Some(Value::Object(properties)) = map.get("properties") {
            let required: Vec<&str> = map
                .get("required")
                .and_then(Value::as_array)
                .map(|list| list.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let mut closed = Map::new();
            for (name, property) in properties {
                let property = transform(property);
                let property = if required.contains(&name.as_str()) || is_nullable(&property) {
                    property
                } else {
                    // Strict mode has no optional field: "may be absent"
                    // becomes "may be null".
                    json!({ "anyOf": [property, { "type": "null" }] })
                };
                closed.insert(name.clone(), property);
            }
            // The original order first (the model writes keys in this
            // order), then the properties that were optional.
            let mut names: Vec<Value> = required
                .iter()
                .filter(|name| properties.contains_key(**name))
                .map(|name| json!(name))
                .collect();
            for name in properties.keys() {
                if !required.contains(&name.as_str()) {
                    names.push(json!(name));
                }
            }
            out.insert("properties".into(), Value::Object(closed));
            out.insert("required".into(), Value::Array(names));
            out.insert("additionalProperties".into(), json!(false));
        }
        Value::Object(out)
    }
    transform(schema)
}

/// The documented limits of OpenAI's strict mode, on an `openai_strict`
/// schema. The error is a plain English sentence.
pub(crate) fn check_openai_strict(schema: &Value) -> Result<(), String> {
    if schema.get("type").and_then(Value::as_str) != Some("object") || schema.get("anyOf").is_some()
    {
        return Err("the root of the schema must be an object, not anyOf".into());
    }
    #[derive(Default)]
    struct Count {
        properties: usize,
        enum_values: usize,
        string_chars: usize,
        depth: usize,
        problem: Option<String>,
    }
    fn walk(schema: &Value, depth: usize, count: &mut Count) {
        let Value::Object(map) = schema else {
            return;
        };
        let mut depth = depth;
        if let Some(Value::Object(properties)) = map.get("properties") {
            depth += 1;
            count.depth = count.depth.max(depth);
            count.properties += properties.len();
            count.string_chars += properties.keys().map(|k| k.chars().count()).sum::<usize>();
            if map.get("additionalProperties") != Some(&json!(false)) {
                count.problem.get_or_insert_with(|| {
                    "an object does not set additionalProperties: false".into()
                });
            }
            let required: Vec<&str> = map
                .get("required")
                .and_then(Value::as_array)
                .map(|list| list.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if properties
                .keys()
                .any(|name| !required.contains(&name.as_str()))
            {
                count
                    .problem
                    .get_or_insert_with(|| "an object has a property that is not required".into());
            }
            for property in properties.values() {
                walk(property, depth, count);
            }
        }
        if let Some(Value::Array(values)) = map.get("enum") {
            count.enum_values += values.len();
            count.string_chars += values
                .iter()
                .filter_map(Value::as_str)
                .map(|v| v.chars().count())
                .sum::<usize>();
        }
        if let Some(Value::String(value)) = map.get("const") {
            count.string_chars += value.chars().count();
        }
        for key in OPENAI_UNSUPPORTED {
            if map.contains_key(key) {
                count
                    .problem
                    .get_or_insert_with(|| format!("strict mode does not support {key}"));
            }
        }
        if let Some(items) = map.get("items") {
            walk(items, depth, count);
        }
        if let Some(Value::Array(branches)) = map.get("anyOf") {
            for branch in branches {
                walk(branch, depth, count);
            }
        }
        for defs in ["$defs", "definitions"] {
            if let Some(Value::Object(definitions)) = map.get(defs) {
                count.string_chars += definitions.keys().map(|k| k.chars().count()).sum::<usize>();
                for definition in definitions.values() {
                    walk(definition, depth, count);
                }
            }
        }
    }
    let mut count = Count::default();
    walk(schema, 0, &mut count);
    if let Some(problem) = count.problem {
        return Err(problem);
    }
    if count.properties > OPENAI_MAX_PROPERTIES {
        return Err(format!(
            "the schema has {} object properties (at most {OPENAI_MAX_PROPERTIES})",
            count.properties
        ));
    }
    if count.depth > OPENAI_MAX_DEPTH {
        return Err(format!(
            "the schema nests objects {} levels deep (at most {OPENAI_MAX_DEPTH})",
            count.depth
        ));
    }
    if count.enum_values > OPENAI_MAX_ENUM_VALUES {
        return Err(format!(
            "the schema has {} enum values (at most {OPENAI_MAX_ENUM_VALUES})",
            count.enum_values
        ));
    }
    if count.string_chars > OPENAI_MAX_SCHEMA_STRING_CHARS {
        return Err(format!(
            "the schema's names and enum values have {} characters (at most \
             {OPENAI_MAX_SCHEMA_STRING_CHARS})",
            count.string_chars
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The schema the UI really sends (kept in sync by `aiSchema.test.ts`).
    const RESPONSE_SCHEMA: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../src/analytics/ai/fixtures/response-schema.json"
    ));

    fn shared() -> Value {
        serde_json::from_str(RESPONSE_SCHEMA).unwrap()
    }

    #[test]
    fn the_shared_schema_suits_both_providers_unchanged() {
        let schema = shared();
        // Anthropic: within the structured-output limits.
        let (unions, optional) = schema_complexity(&schema);
        assert!(unions <= 16 && optional <= 24, "{unions} {optional}");
        // OpenAI strict: already in the strict form, and within the limits.
        assert_eq!(openai_strict(&schema), schema);
        check_openai_strict(&schema).unwrap();
    }

    #[test]
    fn strict_transform_closes_objects_and_nulls_optional_fields() {
        let loose = json!({
            "type": "object",
            "required": ["a"],
            "properties": {
                "a": { "type": "string", "minLength": 1 },
                "b": { "type": "integer" },
                "c": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
                "d": { "type": "array", "uniqueItems": true, "items": {
                    "type": "object", "properties": { "x": { "type": "string" } }
                }},
                "e": { "allOf": [{ "type": "string" }] }
            }
        });
        let strict = openai_strict(&loose);
        assert_eq!(strict["additionalProperties"], false);
        assert_eq!(strict["required"], json!(["a", "b", "c", "d", "e"]));
        assert_eq!(
            strict["properties"]["b"],
            json!({ "anyOf": [{ "type": "integer" }, { "type": "null" }] })
        );
        // Already nullable: left as it is.
        assert_eq!(strict["properties"]["c"], loose["properties"]["c"]);
        assert_eq!(strict["properties"]["a"], json!({ "type": "string" }));
        let item = &strict["properties"]["d"]["anyOf"][0]["items"];
        assert_eq!(item["additionalProperties"], false);
        assert_eq!(item["required"], json!(["x"]));
        assert!(strict["properties"]["d"]["anyOf"][0]
            .get("uniqueItems")
            .is_none());
        check_openai_strict(&strict).unwrap();
    }

    #[test]
    fn strict_limits() {
        let open = json!({ "type": "object", "properties": { "a": { "type": "string" } }, "required": ["a"] });
        assert!(check_openai_strict(&open)
            .unwrap_err()
            .contains("additionalProperties"));
        let optional = json!({ "type": "object", "additionalProperties": false,
            "properties": { "a": { "type": "string" } }, "required": [] });
        assert!(check_openai_strict(&optional)
            .unwrap_err()
            .contains("not required"));
        assert!(check_openai_strict(&json!({ "anyOf": [{ "type": "object" }] })).is_err());
        assert!(check_openai_strict(&json!({ "type": "array" })).is_err());

        // 11 levels of nested objects.
        let mut deep = json!({ "type": "string" });
        for _ in 0..11 {
            deep = json!({ "type": "object", "additionalProperties": false,
                "required": ["n"], "properties": { "n": deep } });
        }
        assert!(check_openai_strict(&deep).unwrap_err().contains("levels"));

        let values: Vec<String> = (0..1001).map(|i| format!("v{i}")).collect();
        let many = json!({ "type": "object", "additionalProperties": false, "required": ["e"],
            "properties": { "e": { "type": "string", "enum": values } } });
        assert!(check_openai_strict(&many)
            .unwrap_err()
            .contains("enum values"));

        let not = json!({ "type": "object", "additionalProperties": false, "required": ["a"],
            "properties": { "a": { "not": { "type": "null" } } } });
        assert!(check_openai_strict(&not).unwrap_err().contains("not"));
    }

    #[test]
    fn counts_unions_and_optional_properties_like_anthropic() {
        let nested = json!({
            "type": "object",
            "required": ["a"],
            "properties": {
                "a": { "type": "array", "items": {
                    "type": "object",
                    "required": ["x"],
                    "properties": {
                        "x": { "type": ["string", "null"] },
                        "y": { "type": "string" }
                    }
                }},
                "b": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
            }
        });
        assert_eq!(schema_complexity(&nested), (2, 2));
    }
}
