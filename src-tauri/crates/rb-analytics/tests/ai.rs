//! AI proxy acceptance tests on the public surface (plan section 3, WP2;
//! ADR 0008 "AI providers"): the request checks made before the key is
//! read, for every provider; the model allowlists; the key rules. The HTTP
//! side (body snapshots, headers, error mapping on local stub servers) is
//! tested inside `ai::anthropic`, `ai::openai` and `ai::openai_compatible`.

use serde_json::{json, Value};

use rb_analytics::ai::{self, key_store::ApiKey, models};
use rb_analytics::error::ErrorCode;
use rb_analytics::ipc::{AiAskRequest, AiModel, AiProvider, AiRole};

const FIXTURES: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/engine/ipc-fixtures.json"
));

/// The response schema the UI really sends (`AI_RESPONSE_JSON_SCHEMA`),
/// kept in sync by `aiSchema.test.ts`.
const RESPONSE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/ai/fixtures/response-schema.json"
));

/// The `AiAskRequest` of the shared IPC fixtures (what the UI sends).
fn fixture() -> AiAskRequest {
    let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
    serde_json::from_value(fixtures["AiAskRequest"][0].clone()).unwrap()
}

fn code(req: &AiAskRequest) -> Option<ErrorCode> {
    ai::check_request(req).err().map(|e| e.code)
}

/// An object schema with `unions` anyOf properties and `optional`
/// properties left out of `required`.
fn schema(unions: usize, optional: usize) -> Value {
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();
    for i in 0..unions {
        let name = format!("u{i}");
        properties.insert(
            name.clone(),
            json!({ "anyOf": [{ "type": "string" }, { "type": "null" }] }),
        );
        required.push(json!(name));
    }
    for i in 0..optional {
        properties.insert(format!("o{i}"), json!({ "type": "string" }));
    }
    json!({ "type": "object", "additionalProperties": false, "properties": properties, "required": required })
}

#[test]
fn the_ui_request_passes_the_checks() {
    assert_eq!(code(&fixture()), None);
}

#[test]
fn the_real_response_schema_passes_the_checks_of_every_provider() {
    for (provider, model) in [
        (AiProvider::Anthropic, "claude-opus-5-5"),
        (AiProvider::OpenAi, "gpt-6-astra"),
        (AiProvider::OpenAiCompatible, "mistral-large-latest"),
    ] {
        let mut req = fixture();
        req.provider = provider;
        req.model = model.into();
        req.output_schema = serde_json::from_str(RESPONSE_SCHEMA).unwrap();
        assert_eq!(req.output_schema["type"], "object");
        assert_eq!(code(&req), None, "{provider:?}");
    }
}

#[test]
fn the_compatible_fixture_passes_the_checks() {
    let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
    let req: AiAskRequest = serde_json::from_value(fixtures["AiAskRequest"][1].clone()).unwrap();
    assert_eq!(req.provider, AiProvider::OpenAiCompatible);
    assert_eq!(code(&req), None);
}

#[test]
fn requests_are_checked_before_the_key_is_read() {
    let mut req = fixture();
    req.max_tokens = 16_001;
    assert_eq!(code(&req), Some(ErrorCode::BadRequest));
    req.max_tokens = 0;
    assert_eq!(code(&req), Some(ErrorCode::BadRequest));
    req.max_tokens = 16_000;
    assert_eq!(code(&req), None);

    let mut ends_with_assistant = fixture();
    ends_with_assistant.messages.pop();
    assert_eq!(
        ends_with_assistant.messages.last().unwrap().role,
        AiRole::Assistant
    );
    assert_eq!(code(&ends_with_assistant), Some(ErrorCode::BadRequest));

    let mut empty = fixture();
    empty.messages.clear();
    assert_eq!(code(&empty), Some(ErrorCode::BadRequest));

    let mut huge = fixture();
    huge.messages[0].content = "x".repeat(400_001);
    assert_eq!(code(&huge), Some(ErrorCode::TooLarge));

    let mut not_object = fixture();
    not_object.output_schema = json!({ "type": "array" });
    assert_eq!(code(&not_object), Some(ErrorCode::BadRequest));
}

#[test]
fn schemas_within_the_structured_output_limits() {
    // Limits of the structured outputs docs, checked 2026-10-29: 16
    // union-typed and 24 optional properties per request.
    let mut req = fixture();
    req.output_schema = schema(16, 24);
    assert_eq!(code(&req), None);
    req.output_schema = schema(17, 0);
    let error = ai::check_request(&req).unwrap_err();
    assert_eq!(error.code, ErrorCode::BadRequest);
    assert!(error.message.contains("17"), "{}", error.message);
    req.output_schema = schema(0, 25);
    assert_eq!(code(&req), Some(ErrorCode::BadRequest));
}

#[test]
fn only_the_three_models_are_allowed() {
    for (id, model) in [
        ("claude-opus-5-5", AiModel::ClaudeOpus55),
        ("claude-sonnet-5-5", AiModel::ClaudeSonnet55),
        ("claude-haiku-5-5", AiModel::ClaudeHaiku55),
    ] {
        assert_eq!(models::parse_model(id).unwrap(), model);
    }
    for id in ["claude-opus-5", "gpt-5", "", "claude-opus-5-5 "] {
        assert_eq!(
            models::parse_model(id).unwrap_err().code,
            ErrorCode::ModelNotAllowed,
            "{id:?}"
        );
    }
    let mut req = fixture();
    req.model = "claude-3-opus".into();
    assert_eq!(code(&req), Some(ErrorCode::ModelNotAllowed));
    // OpenAI has its own allowlist; a compatible server takes any name.
    req.provider = AiProvider::OpenAi;
    assert_eq!(code(&req), Some(ErrorCode::ModelNotAllowed));
    for id in models::OPENAI_MODELS {
        req.model = id.into();
        assert_eq!(code(&req), None, "{id}");
    }
    req.provider = AiProvider::OpenAiCompatible;
    req.model = "llama3.3:70b".into();
    assert_eq!(code(&req), None);
    // Haiku 5.5 has no server-side fallback: no `fallbacks`, no beta header.
    assert!(!models::supports_server_fallback(AiModel::ClaudeHaiku55));
    assert!(models::supports_server_fallback(AiModel::ClaudeOpus55));
    assert_eq!(ai::API_VERSION, "2026-10-21");
}

#[test]
fn key_rules_and_the_key_never_shows() {
    let key = format!("sk-ant-api03-{}", "Ab1_-".repeat(10));
    let parsed = ApiKey::parse(&format!("  {key}\n")).unwrap();
    let debug = format!("{parsed:?}");
    assert!(!debug.contains("api03"), "{debug}");
    for bad in [
        "sk-ant-short".to_string(),
        format!("sk-ant-{}", "a".repeat(300)),
        format!("sk-xyz-{}", "a".repeat(30)),
        format!("sk-ant-{} {}", "a".repeat(20), "b".repeat(5)),
        format!("sk-ant-{}é", "a".repeat(20)),
    ] {
        let error = ApiKey::parse(&bad).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidKey, "{bad}");
        assert!(
            !error.message.contains(&bad[7..]),
            "the key is not echoed: {}",
            error.message
        );
        assert!(!format!("{error:?}").contains(&bad[7..]));
    }
    assert_eq!(
        ai::key_store::set_key("not a key").unwrap_err().code,
        ErrorCode::InvalidKey
    );
    // Checked before any store is touched, for every provider.
    assert_eq!(
        ai::key_store::set_key_for(AiProvider::OpenAi, &key, None)
            .unwrap_err()
            .code,
        ErrorCode::InvalidKey
    );
    assert_eq!(
        ai::key_store::set_key_for(
            AiProvider::OpenAiCompatible,
            "",
            Some("http://example.com/v1")
        )
        .unwrap_err()
        .code,
        ErrorCode::BadRequest
    );
}

#[test]
fn every_provider_checks_the_conversation_the_same_way() {
    for (provider, model) in [
        (AiProvider::Anthropic, "claude-sonnet-5-5"),
        (AiProvider::OpenAi, "gpt-6-luna"),
        (AiProvider::OpenAiCompatible, "qwen3"),
    ] {
        let mut req = fixture();
        req.provider = provider;
        req.model = model.into();
        assert_eq!(code(&req), None);
        req.max_tokens = 16_001;
        assert_eq!(code(&req), Some(ErrorCode::BadRequest), "{provider:?}");
        let mut req = fixture();
        req.provider = provider;
        req.model = model.into();
        req.messages.pop();
        assert_eq!(code(&req), Some(ErrorCode::BadRequest), "{provider:?}");
        let mut req = fixture();
        req.provider = provider;
        req.model = model.into();
        req.messages[0].content = "x".repeat(400_001);
        assert_eq!(code(&req), Some(ErrorCode::TooLarge), "{provider:?}");
    }
}
