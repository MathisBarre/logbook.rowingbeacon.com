//! The Messages API call of the in-app assistant (plan 2.11), checked
//! against platform.claude.com on 2026-10-29:
//!
//! - `POST {base}/v1/messages`, headers `x-api-key`, `anthropic-version:
//!   2026-10-21`, `content-type: application/json`, and for Opus 5.5 and
//!   Sonnet 5.5 `anthropic-beta: server-side-fallback-2026-07-01` with
//!   `fallbacks: "default"` in the body (Haiku 5.5 has no server-side
//!   fallback);
//! - structured output in `output_config.format` (`json_schema`, no beta
//!   header) next to `output_config.effort`; no `temperature`, `top_p`,
//!   `top_k` (400 on 2026-10-21), no `thinking`, no prefill, no
//!   `tool_choice`;
//! - the answer is the first `text` block (a server-side fallback may put
//!   a `fallback` block first); `stop_reason: "refusal"` is an HTTP 200
//!   with `stop_details { category, explanation }`.
//!
//! The base URL is a parameter for the tests (a local stub server); the
//! public `ai::ask` always passes `https://api.anthropic.com`.

use serde_json::{json, Map, Value};

use super::http::{self, cut, parse_retry_after, KEY_TEST_TIMEOUT, REQUEST_TIMEOUT};
use super::key_store::ApiKey;
use super::models::{
    parse_model, supports_server_fallback, MAX_CACHE_BREAKPOINTS, MAX_SCHEMA_OPTIONAL_PARAMS,
    MAX_SCHEMA_UNION_PARAMS,
};
use super::schema::schema_complexity;
use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{AiAskRequest, AiAskResponse, AiKeyTest, AiModel, AiProvider, AiRole, AiUsage};

pub const ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";
pub const API_VERSION: &str = "2026-10-21";
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

const PROVIDER: AiProvider = AiProvider::Anthropic;

fn bad_request(message: impl Into<String>) -> AnalyticsError {
    AnalyticsError::new(ErrorCode::BadRequest, message)
}

// --------------------------------------------------------------- validation

/// Everything the Messages API would reject, checked before the key is
/// read and before any network call (plan 2.11): the checks every
/// provider shares (`super::check_common`), the model allowlist, at most
/// 4 cached system blocks, and the structured-output limits.
pub(crate) fn validate(req: &AiAskRequest) -> Result<AiModel, AnalyticsError> {
    super::check_common(req)?;
    let model = parse_model(&req.model)?;
    if req.system.iter().filter(|block| block.cache).count() > MAX_CACHE_BREAKPOINTS {
        return Err(bad_request(format!(
            "At most {MAX_CACHE_BREAKPOINTS} system blocks can be cached"
        )));
    }
    let (unions, optional) = schema_complexity(&req.output_schema);
    if unions > MAX_SCHEMA_UNION_PARAMS {
        return Err(bad_request(format!(
            "outputSchema has {unions} parameters with a union type (anyOf or a type array); \
             the API accepts at most {MAX_SCHEMA_UNION_PARAMS}"
        )));
    }
    if optional > MAX_SCHEMA_OPTIONAL_PARAMS {
        return Err(bad_request(format!(
            "outputSchema has {optional} optional parameters; the API accepts at most \
             {MAX_SCHEMA_OPTIONAL_PARAMS}"
        )));
    }
    Ok(model)
}

// ------------------------------------------------------------------ request

/// The JSON body of `POST /v1/messages`.
pub(crate) fn build_body(req: &AiAskRequest, model: AiModel) -> Value {
    let mut body = Map::new();
    body.insert("model".into(), json!(model.as_str()));
    body.insert("max_tokens".into(), json!(req.max_tokens));
    if !req.system.is_empty() {
        let system: Vec<Value> = req
            .system
            .iter()
            .map(|block| {
                let mut item = json!({ "type": "text", "text": block.text });
                if block.cache {
                    item["cache_control"] = json!({ "type": "ephemeral" });
                }
                item
            })
            .collect();
        body.insert("system".into(), Value::Array(system));
    }
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|message| {
            let role = match message.role {
                AiRole::User => "user",
                AiRole::Assistant => "assistant",
            };
            json!({ "role": role, "content": message.content })
        })
        .collect();
    body.insert("messages".into(), Value::Array(messages));
    body.insert(
        "output_config".into(),
        json!({
            "effort": super::effort_str(req.effort),
            "format": { "type": "json_schema", "schema": req.output_schema },
        }),
    );
    if supports_server_fallback(model) {
        body.insert("fallbacks".into(), json!("default"));
    }
    Value::Object(body)
}

/// Header names and values, the key included: never log the result.
pub(crate) fn request_headers(model: AiModel, key: &ApiKey) -> Vec<(&'static str, String)> {
    let mut headers = vec![
        ("x-api-key", key.expose().to_string()),
        ("anthropic-version", API_VERSION.to_string()),
        ("content-type", "application/json".to_string()),
        ("accept", "application/json".to_string()),
    ];
    if supports_server_fallback(model) {
        headers.push(("anthropic-beta", FALLBACK_BETA.to_string()));
    }
    headers
}

/// One call to the Messages API with structured output.
pub(crate) async fn ask(
    req: &AiAskRequest,
    key: &ApiKey,
    base_url: &str,
) -> Result<AiAskResponse, AnalyticsError> {
    let model = validate(req)?;
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let mut request = http::client()?
        .post(url)
        .timeout(REQUEST_TIMEOUT)
        .body(build_body(req, model).to_string());
    for (name, value) in request_headers(model, key) {
        request = request.header(name, value);
    }
    let answer = http::send(PROVIDER, request).await?;
    if answer.status == 200 {
        parse_success(&answer.body)
    } else {
        Err(map_http_error(
            answer.status,
            answer.retry_after.as_deref(),
            &answer.body,
        ))
    }
}

// ----------------------------------------------------------------- response

fn usage_field(usage: &Value, name: &str) -> u64 {
    usage.get(name).and_then(Value::as_u64).unwrap_or(0)
}

/// Reads a 200 answer: refusal and truncation become errors, otherwise the
/// first text block is the JSON answer.
pub(crate) fn parse_success(body: &[u8]) -> Result<AiAskResponse, AnalyticsError> {
    let message: Value = serde_json::from_slice(body).map_err(|_| {
        AnalyticsError::new(ErrorCode::BadRequest, "Anthropic sent an unreadable answer")
    })?;
    let stop_reason = message
        .get("stop_reason")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    match stop_reason.as_str() {
        "refusal" => {
            let details = message.get("stop_details").unwrap_or(&Value::Null);
            let category = details.get("category").and_then(Value::as_str);
            let explanation = details.get("explanation").and_then(Value::as_str);
            let mut text = String::from("The model declined to answer");
            if let Some(category) = category {
                text.push_str(&format!(" (category: {category})"));
            }
            if let Some(explanation) = explanation {
                text.push_str(&format!(": {explanation}"));
            }
            return Err(AnalyticsError::new(ErrorCode::Refusal, text));
        }
        "max_tokens" | "model_context_window_exceeded" => {
            return Err(AnalyticsError::new(
                ErrorCode::Truncated,
                "The answer was cut off before the end. Ask a narrower question.",
            ));
        }
        _ => {}
    }
    let text = message
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks.iter().find_map(|block| {
                (block.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| block.get("text").and_then(Value::as_str))
                    .flatten()
            })
        })
        .ok_or_else(|| AnalyticsError::internal("The answer from Anthropic has no text"))?
        .to_string();
    let usage = message.get("usage").unwrap_or(&Value::Null);
    Ok(AiAskResponse {
        text,
        stop_reason,
        model: message
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        usage: AiUsage {
            input_tokens: usage_field(usage, "input_tokens"),
            output_tokens: usage_field(usage, "output_tokens"),
            cache_read_input_tokens: usage_field(usage, "cache_read_input_tokens"),
            cache_creation_input_tokens: usage_field(usage, "cache_creation_input_tokens"),
        },
    })
}

/// `error.message` of an API error body, cut for display.
fn api_message(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    Some(cut(value.get("error")?.get("message")?.as_str()?))
}

/// Maps an HTTP error of the Messages API (plan 2.11, errors page).
pub(crate) fn map_http_error(
    status: u16,
    retry_after: Option<&str>,
    body: &[u8],
) -> AnalyticsError {
    let detail = api_message(body);
    let with_detail = |text: &str| match &detail {
        Some(detail) => format!("{text}: {detail}"),
        None => text.to_string(),
    };
    match status {
        400 => bad_request(with_detail("Anthropic refused the request")),
        401 => AnalyticsError::new(
            ErrorCode::InvalidKey,
            "Anthropic does not accept this API key (wrong, revoked or expired)",
        ),
        402 => AnalyticsError::new(
            ErrorCode::Forbidden,
            with_detail("Billing problem on the Anthropic account"),
        ),
        403 => AnalyticsError::new(
            ErrorCode::Forbidden,
            with_detail("This API key is not allowed to do this"),
        ),
        404 => AnalyticsError::new(
            ErrorCode::Forbidden,
            with_detail("This model is not available to this API key"),
        ),
        408 | 504 => AnalyticsError::new(
            ErrorCode::Timeout,
            "Anthropic took too long to answer. Try again.",
        ),
        413 => AnalyticsError::new(
            ErrorCode::TooLarge,
            "The request is too large for Anthropic",
        ),
        429 => {
            let error = AnalyticsError::new(
                ErrorCode::RateLimited,
                with_detail("Too many requests to Anthropic for this account"),
            );
            match parse_retry_after(retry_after) {
                Some(seconds) => error.with_retry_after(seconds),
                None => error,
            }
        }
        500..=599 => AnalyticsError::new(
            ErrorCode::Overloaded,
            "Anthropic is overloaded or unavailable. Try again in a few minutes.",
        ),
        _ => bad_request(with_detail(&format!(
            "Unexpected answer from Anthropic (HTTP {status})"
        ))),
    }
}

// ----------------------------------------------------------------- key test

/// Maps the status of `GET /v1/models/{model}` (plan 2.2).
pub(crate) fn key_test_result(status: u16) -> AiKeyTest {
    let code = match status {
        200 => {
            return AiKeyTest {
                ok: true,
                code: None,
            }
        }
        401 => ErrorCode::InvalidKey,
        402..=404 => ErrorCode::Forbidden,
        429 => ErrorCode::RateLimited,
        408 | 504 => ErrorCode::Timeout,
        500..=599 => ErrorCode::Overloaded,
        _ => ErrorCode::BadRequest,
    };
    AiKeyTest {
        ok: false,
        code: Some(code),
    }
}

/// `GET {base}/v1/models/{model}`: free, no tokens.
pub(crate) async fn test_key(model: AiModel, key: &ApiKey, base_url: &str) -> AiKeyTest {
    let url = format!(
        "{}/v1/models/{}",
        base_url.trim_end_matches('/'),
        model.as_str()
    );
    let client = match http::client() {
        Ok(client) => client,
        Err(_) => {
            return AiKeyTest {
                ok: false,
                code: Some(ErrorCode::Network),
            }
        }
    };
    let response = client
        .get(url)
        .timeout(KEY_TEST_TIMEOUT)
        .header("x-api-key", key.expose())
        .header("anthropic-version", API_VERSION)
        .send()
        .await;
    match response {
        Ok(response) => key_test_result(response.status().as_u16()),
        Err(error) => AiKeyTest {
            ok: false,
            code: Some(http::transport_error(PROVIDER, error).code),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::models::MAX_PROMPT_CHARS;
    use crate::ai::test_support::{block_on, stub};
    use crate::ipc::{AiEffort, AiMessage, AiSystemBlock};
    use std::net::TcpListener;

    const KEY: &str = "sk-ant-api03-test-key-0123456789abcdef";

    fn schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["title", "sql"],
            "properties": {
                "title": { "type": "string" },
                "sql": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
            }
        })
    }

    fn request(model: AiModel) -> AiAskRequest {
        AiAskRequest {
            request_id: "3f0e6c39-6d2a-4d43-9b8e-1f6f2c1b9a10".into(),
            provider: AiProvider::Anthropic,
            model: model.as_str().into(),
            effort: AiEffort::Medium,
            system: vec![AiSystemBlock {
                text: "You write SQLite queries.".into(),
                cache: true,
            }],
            messages: vec![AiMessage {
                role: AiRole::User,
                content: "Quels bateaux sortent le plus ?".into(),
            }],
            output_schema: schema(),
            max_tokens: 8000,
        }
    }

    #[test]
    fn body_matches_the_plan_exactly() {
        assert_eq!(
            build_body(&request(AiModel::ClaudeOpus55), AiModel::ClaudeOpus55),
            json!({
                "model": "claude-opus-5-5",
                "max_tokens": 8000,
                "system": [{
                    "type": "text",
                    "text": "You write SQLite queries.",
                    "cache_control": { "type": "ephemeral" }
                }],
                "messages": [{ "role": "user", "content": "Quels bateaux sortent le plus ?" }],
                "output_config": {
                    "effort": "medium",
                    "format": { "type": "json_schema", "schema": schema() }
                },
                "fallbacks": "default"
            })
        );
    }

    #[test]
    fn body_never_carries_rejected_fields() {
        for model in super::super::models::ALLOWED_MODELS {
            let body = build_body(&request(model), model);
            for field in [
                "temperature",
                "top_p",
                "top_k",
                "thinking",
                "tool_choice",
                "tools",
            ] {
                assert!(body.get(field).is_none(), "{field} on {model:?}");
            }
            assert_eq!(
                body["messages"].as_array().unwrap().last().unwrap()["role"],
                "user"
            );
        }
    }

    #[test]
    fn haiku_has_no_fallback_field_nor_beta_header() {
        let key = ApiKey::parse(KEY).unwrap();
        let body = build_body(&request(AiModel::ClaudeHaiku55), AiModel::ClaudeHaiku55);
        assert!(body.get("fallbacks").is_none());
        let names: Vec<&str> = request_headers(AiModel::ClaudeHaiku55, &key)
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        assert!(!names.contains(&"anthropic-beta"));
        let headers = request_headers(AiModel::ClaudeSonnet55, &key);
        assert!(headers.contains(&("anthropic-beta", FALLBACK_BETA.to_string())));
        assert!(headers.contains(&("anthropic-version", "2026-10-21".to_string())));
        assert!(headers.contains(&("x-api-key", KEY.to_string())));
    }

    #[test]
    fn uncached_system_block_has_no_cache_control_and_no_system_is_omitted() {
        let mut req = request(AiModel::ClaudeOpus55);
        req.system[0].cache = false;
        let model = AiModel::ClaudeOpus55;
        assert!(build_body(&req, model)["system"][0]
            .get("cache_control")
            .is_none());
        req.system.clear();
        assert!(build_body(&req, model).get("system").is_none());
    }

    #[test]
    fn validation_rules() {
        let ok = request(AiModel::ClaudeOpus55);
        validate(&ok).unwrap();

        let mut req = ok.clone();
        req.max_tokens = 16_001;
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);
        req.max_tokens = 16_000;
        validate(&req).unwrap();

        let mut req = ok.clone();
        req.messages.push(AiMessage {
            role: AiRole::Assistant,
            content: "{}".into(),
        });
        let error = validate(&req).unwrap_err();
        assert!(error.message.contains("prefill"), "{}", error.message);

        let mut req = ok.clone();
        req.messages.insert(
            0,
            AiMessage {
                role: AiRole::Assistant,
                content: "x".into(),
            },
        );
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);

        let mut req = ok.clone();
        req.messages.clear();
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);

        let mut req = ok.clone();
        req.messages[0].content = "x".repeat(MAX_PROMPT_CHARS);
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::TooLarge);

        let mut req = ok.clone();
        req.output_schema = json!({ "type": "array" });
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);

        let mut req = ok.clone();
        req.model = "gpt-6-astra".into();
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::ModelNotAllowed);

        let mut req = ok;
        req.system = (0..5)
            .map(|i| AiSystemBlock {
                text: format!("block {i}"),
                cache: true,
            })
            .collect();
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);
    }

    #[test]
    fn schema_limits_are_counted_like_the_api() {
        assert_eq!(schema_complexity(&schema()), (1, 0));
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
        let mut properties = Map::new();
        for i in 0..17 {
            properties.insert(
                format!("p{i}"),
                json!({ "anyOf": [{ "type": "string" }, { "type": "null" }] }),
            );
        }
        let names: Vec<String> = properties.keys().cloned().collect();
        let mut req = request(AiModel::ClaudeOpus55);
        req.output_schema =
            json!({ "type": "object", "required": names, "properties": properties });
        let error = validate(&req).unwrap_err();
        assert!(
            error.message.contains("17 parameters with a union type"),
            "{}",
            error.message
        );
    }

    #[test]
    fn counts_unions_in_nested_objects() {
        let schema = json!({
            "type": "object",
            "properties": {
                "sql": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
                "chart": { "type": "object", "properties": {
                    "x": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
                    "y": { "anyOf": [{ "type": "array" }, { "type": "null" }] }
                }, "required": ["x", "y"] }
            },
            "required": ["sql", "chart"]
        });
        assert_eq!(schema_complexity(&schema), (3, 0));
    }

    #[test]
    fn parses_answers() {
        let body = json!({
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
            "content": [
                { "type": "thinking", "thinking": "", "signature": "x" },
                { "type": "text", "text": "{\"title\":\"A\"}" }
            ],
            "stop_reason": "end_turn", "stop_details": null,
            "usage": { "input_tokens": 120, "output_tokens": 40, "cache_read_input_tokens": 9000,
                       "cache_creation_input_tokens": null }
        });
        let answer = parse_success(body.to_string().as_bytes()).unwrap();
        assert_eq!(answer.text, "{\"title\":\"A\"}");
        assert_eq!(answer.stop_reason, "end_turn");
        assert_eq!(answer.model, "claude-opus-5-5");
        assert_eq!(
            answer.usage,
            AiUsage {
                input_tokens: 120,
                output_tokens: 40,
                cache_read_input_tokens: 9000,
                cache_creation_input_tokens: 0
            }
        );

        // Served by a fallback model: the fallback block comes first.
        let body = json!({
            "model": "claude-opus-5",
            "content": [
                { "type": "fallback", "from": { "model": "claude-opus-5-5" },
                  "to": { "model": "claude-opus-5" }, "trigger": { "type": "refusal", "category": null } },
                { "type": "text", "text": "{}" }
            ],
            "stop_reason": "end_turn",
            "usage": { "input_tokens": 1, "output_tokens": 1 }
        });
        let answer = parse_success(body.to_string().as_bytes()).unwrap();
        assert_eq!(
            (answer.text.as_str(), answer.model.as_str()),
            ("{}", "claude-opus-5")
        );
    }

    #[test]
    fn refusal_and_truncation_are_errors() {
        let refusal = json!({
            "content": [], "stop_reason": "refusal",
            "stop_details": { "type": "refusal", "category": "cyber", "explanation": "Declined." },
            "usage": { "input_tokens": 1, "output_tokens": 0 }
        });
        let error = parse_success(refusal.to_string().as_bytes()).unwrap_err();
        assert_eq!(error.code, ErrorCode::Refusal);
        assert!(error.message.contains("cyber") && error.message.contains("Declined."));

        let refusal = json!({ "content": [], "stop_reason": "refusal",
            "stop_details": { "type": "refusal", "category": null, "explanation": null } });
        assert_eq!(
            parse_success(refusal.to_string().as_bytes())
                .unwrap_err()
                .code,
            ErrorCode::Refusal
        );

        let cut = json!({ "content": [{ "type": "text", "text": "{\"ti" }], "stop_reason": "max_tokens" });
        assert_eq!(
            parse_success(cut.to_string().as_bytes()).unwrap_err().code,
            ErrorCode::Truncated
        );
        assert_eq!(
            parse_success(b"<html>").unwrap_err().code,
            ErrorCode::BadRequest
        );
        let empty = json!({ "content": [], "stop_reason": "end_turn" });
        assert_eq!(
            parse_success(empty.to_string().as_bytes())
                .unwrap_err()
                .code,
            ErrorCode::Internal
        );
    }

    #[test]
    fn maps_http_errors() {
        let body = |kind: &str, message: &str| {
            json!({ "type": "error", "error": { "type": kind, "message": message }, "request_id": "req_1" })
                .to_string()
                .into_bytes()
        };
        let error = map_http_error(
            400,
            None,
            &body("invalid_request_error", "max_tokens: too big"),
        );
        assert_eq!(error.code, ErrorCode::BadRequest);
        assert!(error.message.ends_with("max_tokens: too big"));
        assert_eq!(map_http_error(401, None, b"").code, ErrorCode::InvalidKey);
        assert_eq!(map_http_error(402, None, b"").code, ErrorCode::Forbidden);
        assert_eq!(map_http_error(403, None, b"").code, ErrorCode::Forbidden);
        assert_eq!(map_http_error(404, None, b"").code, ErrorCode::Forbidden);
        assert_eq!(map_http_error(413, None, b"").code, ErrorCode::TooLarge);
        assert_eq!(map_http_error(504, None, b"").code, ErrorCode::Timeout);
        let limited = map_http_error(429, Some("30"), &body("rate_limit_error", "slow down"));
        assert_eq!(
            (limited.code, limited.retry_after_seconds),
            (ErrorCode::RateLimited, Some(30))
        );
        assert_eq!(
            map_http_error(429, Some("Wed, 21 Oct 2026 07:28:00 GMT"), b"").retry_after_seconds,
            None
        );
        assert_eq!(map_http_error(429, None, b"").retry_after_seconds, None);
        for status in [500, 502, 503, 529] {
            assert_eq!(
                map_http_error(status, None, b"").code,
                ErrorCode::Overloaded,
                "{status}"
            );
        }
        let long = "é".repeat(2000);
        let error = map_http_error(400, None, &body("invalid_request_error", &long));
        assert!(error.message.chars().count() < 600);
        assert!(error.message.ends_with('…'));
    }

    #[test]
    fn maps_key_test_statuses() {
        assert_eq!(
            key_test_result(200),
            AiKeyTest {
                ok: true,
                code: None
            }
        );
        assert_eq!(key_test_result(401).code, Some(ErrorCode::InvalidKey));
        assert_eq!(key_test_result(403).code, Some(ErrorCode::Forbidden));
        assert_eq!(key_test_result(404).code, Some(ErrorCode::Forbidden));
        assert_eq!(key_test_result(529).code, Some(ErrorCode::Overloaded));
    }

    #[test]
    fn posts_to_the_messages_endpoint() {
        let answer = json!({
            "model": "claude-opus-5-5", "content": [{ "type": "text", "text": "{\"title\":\"x\"}" }],
            "stop_reason": "end_turn", "usage": { "input_tokens": 3, "output_tokens": 2 }
        });
        let (base, seen) = stub(200, "", &answer.to_string());
        let key = ApiKey::parse(KEY).unwrap();
        let req = request(AiModel::ClaudeOpus55);
        let response = block_on(ask(&req, &key, &base)).unwrap();
        assert_eq!(response.text, "{\"title\":\"x\"}");
        let seen = seen.recv().unwrap();
        assert_eq!(seen.request_line, "POST /v1/messages HTTP/1.1");
        assert_eq!(seen.header("x-api-key"), Some(KEY));
        assert_eq!(seen.header("anthropic-version"), Some(API_VERSION));
        assert_eq!(seen.header("anthropic-beta"), Some(FALLBACK_BETA));
        assert_eq!(seen.header("content-type"), Some("application/json"));
        let body: Value = serde_json::from_str(&seen.body).unwrap();
        assert_eq!(body, build_body(&req, AiModel::ClaudeOpus55));
    }

    #[test]
    fn http_errors_never_echo_the_key() {
        let error_body = json!({ "type": "error", "error": { "type": "rate_limit_error", "message": "Rate limited" } });
        let (base, _seen) = stub(429, "retry-after: 12\r\n", &error_body.to_string());
        let key = ApiKey::parse(KEY).unwrap();
        let error = block_on(ask(&request(AiModel::ClaudeHaiku55), &key, &base)).unwrap_err();
        assert_eq!(error.code, ErrorCode::RateLimited);
        assert_eq!(error.retry_after_seconds, Some(12));
        let shown = format!(
            "{error:?} {error} {}",
            serde_json::to_string(&error).unwrap()
        );
        assert!(!shown.contains(KEY), "{shown}");
    }

    #[test]
    fn unreachable_server_is_a_network_error() {
        // Bind then drop: nothing listens on this port any more.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let key = ApiKey::parse(KEY).unwrap();
        let error = block_on(ask(
            &request(AiModel::ClaudeOpus55),
            &key,
            &format!("http://127.0.0.1:{port}"),
        ))
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Network);
        assert!(!error.message.contains(KEY));
    }

    #[test]
    fn invalid_requests_never_reach_the_network() {
        let mut req = request(AiModel::ClaudeOpus55);
        req.max_tokens = 20_000;
        let key = ApiKey::parse(KEY).unwrap();
        // Port 9 (discard) is never contacted: validation fails first.
        let error = block_on(ask(&req, &key, "http://127.0.0.1:9")).unwrap_err();
        assert_eq!(error.code, ErrorCode::BadRequest);
    }

    #[test]
    fn key_test_calls_the_models_endpoint() {
        let (base, seen) = stub(200, "", "{\"id\":\"claude-sonnet-5-5\",\"type\":\"model\"}");
        let key = ApiKey::parse(KEY).unwrap();
        let result = block_on(test_key(AiModel::ClaudeSonnet55, &key, &base));
        assert_eq!(
            result,
            AiKeyTest {
                ok: true,
                code: None
            }
        );
        let seen = seen.recv().unwrap();
        assert_eq!(
            seen.request_line,
            "GET /v1/models/claude-sonnet-5-5 HTTP/1.1"
        );
        assert_eq!(seen.header("x-api-key"), Some(KEY));
        assert_eq!(seen.header("anthropic-version"), Some(API_VERSION));

        let (base, _seen) = stub(401, "", "{}");
        let result = block_on(test_key(AiModel::ClaudeOpus55, &key, &base));
        assert_eq!(result.code, Some(ErrorCode::InvalidKey));
    }
}
