//! The OpenAI call of the in-app assistant (ADR 0008, "AI providers"),
//! checked against developers.openai.com on 2026-10-29:
//!
//! - `POST https://api.openai.com/v1/responses` (the Responses API, the
//!   one OpenAI recommends for its GPT-6 models), `authorization: Bearer
//!   <key>`;
//! - body: `instructions` (the system prompt), `input` (the conversation
//!   as user and assistant messages), structured output in
//!   `text.format = { type: "json_schema", name, strict: true, schema }`,
//!   `reasoning.effort`, `max_output_tokens`, and `store: false` (OpenAI
//!   keeps nothing for later retrieval). Never `temperature`, `top_p` or
//!   `logprobs` (refused with reasoning on), no tools;
//! - the answer: `status` `completed` with an `output` item of type
//!   `message` whose content holds `output_text` (or a `refusal`);
//!   `incomplete` with `incomplete_details.reason` `max_output_tokens`
//!   (cut) or `content_filter` (refused);
//! - errors: `{ error: { message, type, code } }`; 401 key, 403 country or
//!   permission, 404 model, 429 rate limit, or billing when `code` is
//!   `credit_balance_exhausted`, a spend or usage limit, or the type is
//!   `insufficient_quota`; 500 and 503 (`server_is_overloaded`).
//! - key test: `GET /v1/models/{model}`, free.
//!
//! The base URL is a parameter for the tests (a local stub server); the
//! public `ai::ask` always passes `https://api.openai.com/v1`.

use serde_json::{json, Map, Value};

use super::http::{self, api_error_codes, api_message, parse_retry_after, KEY_TEST_TIMEOUT};
use super::key_store::ApiKey;
use super::models::parse_openai_model;
use super::schema::{check_openai_strict, openai_strict};
use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{AiAskRequest, AiAskResponse, AiKeyTest, AiProvider, AiRole, AiUsage};

pub const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
/// `text.format.name`: `^[a-zA-Z0-9_-]{1,64}$`.
pub const SCHEMA_NAME: &str = "rowing_beacon_answer";

const PROVIDER: AiProvider = AiProvider::OpenAi;

fn bad_request(message: impl Into<String>) -> AnalyticsError {
    AnalyticsError::new(ErrorCode::BadRequest, message)
}

/// The shared checks, the model allowlist and the strict-mode limits on
/// the transformed schema.
pub(crate) fn validate(req: &AiAskRequest) -> Result<&'static str, AnalyticsError> {
    super::check_common(req)?;
    let model = parse_openai_model(&req.model)?;
    check_openai_strict(&openai_strict(&req.output_schema))
        .map_err(|problem| bad_request(format!("outputSchema: {problem}")))?;
    Ok(model)
}

/// The system blocks as one text (OpenAI caches the prompt prefix by
/// itself: there is no cache marker to send).
pub(crate) fn system_text(req: &AiAskRequest) -> String {
    req.system
        .iter()
        .map(|block| block.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn role(role: AiRole) -> &'static str {
    match role {
        AiRole::User => "user",
        AiRole::Assistant => "assistant",
    }
}

/// The JSON body of `POST /v1/responses`.
pub(crate) fn build_body(req: &AiAskRequest, model: &str) -> Value {
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    if !req.system.is_empty() {
        body.insert("instructions".into(), json!(system_text(req)));
    }
    let input: Vec<Value> = req
        .messages
        .iter()
        .map(|message| json!({ "role": role(message.role), "content": message.content }))
        .collect();
    body.insert("input".into(), Value::Array(input));
    body.insert(
        "text".into(),
        json!({
            "format": {
                "type": "json_schema",
                "name": SCHEMA_NAME,
                "strict": true,
                "schema": openai_strict(&req.output_schema),
            }
        }),
    );
    body.insert(
        "reasoning".into(),
        json!({ "effort": super::effort_str(req.effort) }),
    );
    body.insert("max_output_tokens".into(), json!(req.max_tokens));
    body.insert("store".into(), json!(false));
    Value::Object(body)
}

/// One call to the Responses API with structured output.
pub(crate) async fn ask(
    req: &AiAskRequest,
    key: &ApiKey,
    base_url: &str,
) -> Result<AiAskResponse, AnalyticsError> {
    let model = validate(req)?;
    let url = format!("{}/responses", base_url.trim_end_matches('/'));
    let request = http::client()?
        .post(url)
        .timeout(http::REQUEST_TIMEOUT)
        .bearer_auth(key.expose())
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .body(build_body(req, model).to_string());
    let answer = http::send(PROVIDER, request).await?;
    if answer.status == 200 {
        parse_success(&answer.body, model)
    } else {
        Err(map_http_error(
            PROVIDER,
            answer.status,
            answer.retry_after.as_deref(),
            &answer.body,
        ))
    }
}

fn u64_at(value: &Value, path: &[&str]) -> u64 {
    path.iter()
        .try_fold(value, |node, key| node.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

/// OpenAI counts cached tokens inside `input_tokens`; the app's usage
/// (Anthropic's convention) counts them apart: `inputTokens` is the
/// uncached part, `cacheReadInputTokens` the cached part and
/// `cacheCreationInputTokens` the cache writes (GPT-5.6 and later).
/// Reasoning tokens are in `output_tokens`, billed as output.
pub(crate) fn openai_usage(usage: &Value, input: &str, output: &str, details: &str) -> AiUsage {
    let total = u64_at(usage, &[input]);
    let cached = u64_at(usage, &[details, "cached_tokens"]);
    let written = u64_at(usage, &[details, "cache_write_tokens"]);
    AiUsage {
        input_tokens: total.saturating_sub(cached).saturating_sub(written),
        output_tokens: u64_at(usage, &[output]),
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: written,
    }
}

fn refusal(text: Option<&str>) -> AnalyticsError {
    let mut message = String::from("The model declined to answer");
    if let Some(text) = text.filter(|t| !t.trim().is_empty()) {
        message.push_str(": ");
        message.push_str(&http::cut(text));
    }
    AnalyticsError::new(ErrorCode::Refusal, message)
}

fn truncated() -> AnalyticsError {
    AnalyticsError::new(
        ErrorCode::Truncated,
        "The answer was cut off before the end. Ask a narrower question.",
    )
}

/// Reads a 200 answer of the Responses API.
pub(crate) fn parse_success(body: &[u8], asked: &str) -> Result<AiAskResponse, AnalyticsError> {
    let response: Value = serde_json::from_slice(body)
        .map_err(|_| bad_request("OpenAI sent an unreadable answer"))?;
    let status = response
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed")
        .to_string();
    match status.as_str() {
        "completed" => {}
        "incomplete" => {
            let reason = response
                .pointer("/incomplete_details/reason")
                .and_then(Value::as_str);
            return Err(match reason {
                Some("content_filter") => refusal(None),
                _ => truncated(),
            });
        }
        "failed" => {
            let error = response.get("error").unwrap_or(&Value::Null);
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .map(http::cut)
                .unwrap_or_else(|| "no detail".into());
            let code = error.get("code").and_then(Value::as_str).unwrap_or("");
            return Err(match code {
                "rate_limit_exceeded" => AnalyticsError::new(
                    ErrorCode::RateLimited,
                    format!("Too many requests to OpenAI for this account: {message}"),
                ),
                "server_error" | "" => AnalyticsError::new(
                    ErrorCode::Overloaded,
                    format!("OpenAI could not finish the answer: {message}"),
                ),
                _ => bad_request(format!("OpenAI could not answer: {message}")),
            });
        }
        other => {
            return Err(AnalyticsError::internal(format!(
                "Unexpected OpenAI answer status {other:?}"
            )))
        }
    }
    let mut text: Option<String> = None;
    for item in response
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if item.get("type").and_then(Value::as_str) != Some("message") {
            continue; // reasoning items
        }
        for part in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match part.get("type").and_then(Value::as_str) {
                Some("refusal") => {
                    return Err(refusal(part.get("refusal").and_then(Value::as_str)))
                }
                Some("output_text") => {
                    if let Some(chunk) = part.get("text").and_then(Value::as_str) {
                        text.get_or_insert_with(String::new).push_str(chunk);
                    }
                }
                _ => {}
            }
        }
        if text.is_some() {
            break;
        }
    }
    let text =
        text.ok_or_else(|| AnalyticsError::internal("The answer from OpenAI has no text"))?;
    let usage = response.get("usage").unwrap_or(&Value::Null);
    Ok(AiAskResponse {
        text,
        stop_reason: status,
        model: response
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(asked)
            .to_string(),
        usage: openai_usage(
            usage,
            "input_tokens",
            "output_tokens",
            "input_tokens_details",
        ),
    })
}

/// 429s that are about money, not speed: waiting does not help.
const BILLING_CODES: [&str; 6] = [
    "credit_balance_exhausted",
    "insufficient_quota",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "project_usage_limit_exceeded",
];

/// Maps an HTTP error of OpenAI or an OpenAI-compatible server.
pub(crate) fn map_http_error(
    provider: AiProvider,
    status: u16,
    retry_after: Option<&str>,
    body: &[u8],
) -> AnalyticsError {
    let who = provider.label();
    let detail = api_message(body);
    let with_detail = |text: String| match &detail {
        Some(detail) => format!("{text}: {detail}"),
        None => text,
    };
    match status {
        400 | 422 => bad_request(with_detail(format!(
            "{} refused the request",
            http::capitalized(who)
        ))),
        401 => AnalyticsError::new(
            ErrorCode::InvalidKey,
            format!(
                "{} does not accept this API key (wrong, revoked or expired)",
                http::capitalized(who)
            ),
        ),
        402 => AnalyticsError::new(
            ErrorCode::Forbidden,
            with_detail(format!("Billing problem on the {who} account")),
        ),
        403 => AnalyticsError::new(
            ErrorCode::Forbidden,
            with_detail("This API key is not allowed to do this (or not from this country)".into()),
        ),
        404 => AnalyticsError::new(
            ErrorCode::ModelNotFound,
            with_detail(format!(
                "{} does not know this model, or this key cannot use it",
                http::capitalized(who)
            )),
        ),
        408 | 504 => AnalyticsError::new(
            ErrorCode::Timeout,
            format!(
                "{} took too long to answer. Try again.",
                http::capitalized(who)
            ),
        ),
        413 => AnalyticsError::new(
            ErrorCode::TooLarge,
            format!("The request is too large for {who}"),
        ),
        429 => {
            let (code, kind) = api_error_codes(body);
            let billing = [code.as_deref(), kind.as_deref()]
                .into_iter()
                .flatten()
                .any(|value| BILLING_CODES.contains(&value));
            if billing {
                return AnalyticsError::new(
                    ErrorCode::Forbidden,
                    with_detail(format!(
                        "The {who} account has no credit left or reached its spend limit"
                    )),
                );
            }
            let error = AnalyticsError::new(
                ErrorCode::RateLimited,
                with_detail(format!("Too many requests to {who} for this account")),
            );
            match parse_retry_after(retry_after) {
                Some(seconds) => error.with_retry_after(seconds),
                None => error,
            }
        }
        500..=599 => AnalyticsError::new(
            ErrorCode::Overloaded,
            format!(
                "{} is overloaded or unavailable. Try again in a few minutes.",
                http::capitalized(who)
            ),
        ),
        _ => bad_request(with_detail(format!(
            "Unexpected answer from {who} (HTTP {status})"
        ))),
    }
}

/// Maps the status of `GET /v1/models/{model}`.
pub(crate) fn key_test_result(status: u16) -> AiKeyTest {
    let code = match status {
        200 => {
            return AiKeyTest {
                ok: true,
                code: None,
            }
        }
        401 => ErrorCode::InvalidKey,
        402 | 403 => ErrorCode::Forbidden,
        404 => ErrorCode::ModelNotFound,
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

/// `GET {base}/models/{model}`: free, no tokens.
pub(crate) async fn test_key(model: &str, key: &ApiKey, base_url: &str) -> AiKeyTest {
    let url = format!("{}/models/{}", base_url.trim_end_matches('/'), model);
    let client = match http::client() {
        Ok(client) => client,
        Err(_) => {
            return AiKeyTest {
                ok: false,
                code: Some(ErrorCode::Network),
            }
        }
    };
    match client
        .get(url)
        .timeout(KEY_TEST_TIMEOUT)
        .bearer_auth(key.expose())
        .send()
        .await
    {
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
    use crate::ai::test_support::{block_on, request, stub};

    const KEY: &str = "sk-proj-test-key-0123456789abcdefghij";

    fn openai_request() -> AiAskRequest {
        request(AiProvider::OpenAi, "gpt-6.1-sol")
    }

    #[test]
    fn body_matches_the_responses_api() {
        let req = openai_request();
        assert_eq!(
            build_body(&req, "gpt-6.1-sol"),
            json!({
                "model": "gpt-6.1-sol",
                "instructions": "You write SQLite queries.",
                "input": [{ "role": "user", "content": "Quels bateaux sortent le plus ?" }],
                "text": { "format": {
                    "type": "json_schema",
                    "name": "rowing_beacon_answer",
                    "strict": true,
                    "schema": req.output_schema,
                }},
                "reasoning": { "effort": "medium" },
                "max_output_tokens": 8000,
                "store": false
            })
        );
        for field in [
            "temperature",
            "top_p",
            "logprobs",
            "tools",
            "tool_choice",
            "messages",
        ] {
            assert!(
                build_body(&req, "gpt-6.1-sol").get(field).is_none(),
                "{field}"
            );
        }
    }

    #[test]
    fn validation_rules() {
        let ok = openai_request();
        assert_eq!(validate(&ok).unwrap(), "gpt-6.1-sol");
        let mut req = ok.clone();
        req.model = "claude-opus-5-5".into();
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::ModelNotAllowed);
        let mut req = ok.clone();
        req.output_schema = json!({ "anyOf": [{ "type": "object" }] });
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);
        let mut req = ok;
        req.max_tokens = 16_001;
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::BadRequest);
    }

    #[test]
    fn parses_answers_and_normalises_usage() {
        let body = json!({
            "id": "resp_1", "object": "response", "status": "completed", "model": "gpt-6.1-sol",
            "output": [
                { "type": "reasoning", "id": "rs_1", "summary": [] },
                { "type": "message", "role": "assistant", "content": [
                    { "type": "output_text", "text": "{\"title\":", "annotations": [] },
                    { "type": "output_text", "text": "\"A\"}", "annotations": [] }
                ]}
            ],
            "usage": { "input_tokens": 12000, "input_tokens_details": { "cached_tokens": 10000, "cache_write_tokens": 1500 },
                       "output_tokens": 900, "output_tokens_details": { "reasoning_tokens": 600 }, "total_tokens": 12900 }
        });
        let answer = parse_success(body.to_string().as_bytes(), "gpt-6.1-sol").unwrap();
        assert_eq!(answer.text, "{\"title\":\"A\"}");
        assert_eq!(answer.stop_reason, "completed");
        assert_eq!(answer.model, "gpt-6.1-sol");
        assert_eq!(
            answer.usage,
            AiUsage {
                input_tokens: 500,
                output_tokens: 900,
                cache_read_input_tokens: 10000,
                cache_creation_input_tokens: 1500
            }
        );
    }

    #[test]
    fn refusals_truncations_and_failures() {
        let refused = json!({ "status": "completed", "output": [{ "type": "message", "content": [
            { "type": "refusal", "refusal": "I can't help with that." }] }] });
        let error = parse_success(refused.to_string().as_bytes(), "m").unwrap_err();
        assert_eq!(error.code, ErrorCode::Refusal);
        assert!(error.message.contains("can't help"));

        let cut = json!({ "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" }, "output": [] });
        assert_eq!(
            parse_success(cut.to_string().as_bytes(), "m")
                .unwrap_err()
                .code,
            ErrorCode::Truncated
        );
        let filtered =
            json!({ "status": "incomplete", "incomplete_details": { "reason": "content_filter" } });
        assert_eq!(
            parse_success(filtered.to_string().as_bytes(), "m")
                .unwrap_err()
                .code,
            ErrorCode::Refusal
        );
        let failed =
            json!({ "status": "failed", "error": { "code": "server_error", "message": "boom" } });
        assert_eq!(
            parse_success(failed.to_string().as_bytes(), "m")
                .unwrap_err()
                .code,
            ErrorCode::Overloaded
        );
        let empty = json!({ "status": "completed", "output": [] });
        assert_eq!(
            parse_success(empty.to_string().as_bytes(), "m")
                .unwrap_err()
                .code,
            ErrorCode::Internal
        );
        assert_eq!(
            parse_success(b"<html>", "m").unwrap_err().code,
            ErrorCode::BadRequest
        );
    }

    #[test]
    fn maps_http_errors() {
        let body = |code: &str, kind: &str| {
            json!({ "error": { "message": "detail here", "type": kind, "code": code, "param": null } })
                .to_string()
                .into_bytes()
        };
        let p = AiProvider::OpenAi;
        assert_eq!(
            map_http_error(p, 400, None, &body("", "invalid_request_error")).code,
            ErrorCode::BadRequest
        );
        assert!(map_http_error(p, 400, None, &body("", "x"))
            .message
            .ends_with("detail here"));
        assert_eq!(
            map_http_error(p, 401, None, b"").code,
            ErrorCode::InvalidKey
        );
        assert_eq!(map_http_error(p, 403, None, b"").code, ErrorCode::Forbidden);
        assert_eq!(
            map_http_error(p, 404, None, b"").code,
            ErrorCode::ModelNotFound
        );
        assert_eq!(map_http_error(p, 413, None, b"").code, ErrorCode::TooLarge);
        assert_eq!(map_http_error(p, 504, None, b"").code, ErrorCode::Timeout);
        let limited = map_http_error(p, 429, Some("7"), &body("rate_limit_exceeded", "requests"));
        assert_eq!(
            (limited.code, limited.retry_after_seconds),
            (ErrorCode::RateLimited, Some(7))
        );
        for billing in [
            "credit_balance_exhausted",
            "project_spend_limit_exceeded",
            "organization_usage_limit_exceeded",
        ] {
            let error = map_http_error(p, 429, Some("7"), &body(billing, "insufficient_quota"));
            assert_eq!(error.code, ErrorCode::Forbidden, "{billing}");
            assert_eq!(error.retry_after_seconds, None);
        }
        assert_eq!(
            map_http_error(p, 429, None, &body("other", "insufficient_quota")).code,
            ErrorCode::Forbidden
        );
        for status in [500, 502, 503] {
            assert_eq!(
                map_http_error(p, status, None, b"").code,
                ErrorCode::Overloaded
            );
        }
        assert_eq!(
            map_http_error(p, 302, None, b"").code,
            ErrorCode::BadRequest
        );
        assert!(map_http_error(p, 401, None, b"")
            .message
            .starts_with("OpenAI"));
    }

    #[test]
    fn posts_to_the_responses_endpoint_with_a_bearer_key() {
        let answer = json!({ "status": "completed", "model": "gpt-6.1-sol",
            "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "{}" }] }],
            "usage": { "input_tokens": 3, "output_tokens": 2 } });
        let (base, seen) = stub(200, "", &answer.to_string());
        let key = ApiKey::parse_for(AiProvider::OpenAi, KEY).unwrap();
        let req = openai_request();
        let response = block_on(ask(&req, &key, &base)).unwrap();
        assert_eq!(response.text, "{}");
        let seen = seen.recv().unwrap();
        assert_eq!(seen.request_line, "POST /responses HTTP/1.1");
        assert_eq!(
            seen.header("authorization"),
            Some(format!("Bearer {KEY}").as_str())
        );
        assert_eq!(seen.header("x-api-key"), None);
        assert_eq!(seen.header("content-type"), Some("application/json"));
        let body: Value = serde_json::from_str(&seen.body).unwrap();
        assert_eq!(body, build_body(&req, "gpt-6.1-sol"));
        // Only the prompt and the schema leave: no row of club data exists here.
        assert_eq!(body["input"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn errors_never_echo_the_key_and_redirects_are_not_followed() {
        let key = ApiKey::parse_for(AiProvider::OpenAi, KEY).unwrap();
        let (base, _seen) = stub(429, "retry-after: 12\r\n",
            &json!({ "error": { "message": "Rate limit reached", "type": "requests", "code": "rate_limit_exceeded" } }).to_string());
        let error = block_on(ask(&openai_request(), &key, &base)).unwrap_err();
        assert_eq!(
            (error.code, error.retry_after_seconds),
            (ErrorCode::RateLimited, Some(12))
        );
        let shown = format!(
            "{error:?} {error} {}",
            serde_json::to_string(&error).unwrap()
        );
        assert!(!shown.contains(KEY), "{shown}");

        let (base, _seen) = stub(307, "location: http://127.0.0.1:9/steal\r\n", "");
        let error = block_on(ask(&openai_request(), &key, &base)).unwrap_err();
        assert_eq!(error.code, ErrorCode::BadRequest);
    }

    #[test]
    fn key_test_calls_the_model_endpoint() {
        let (base, seen) = stub(200, "", "{\"id\":\"gpt-6-luna\",\"object\":\"model\"}");
        let key = ApiKey::parse_for(AiProvider::OpenAi, KEY).unwrap();
        assert!(block_on(test_key("gpt-6-luna", &key, &base)).ok);
        let seen = seen.recv().unwrap();
        assert_eq!(seen.request_line, "GET /models/gpt-6-luna HTTP/1.1");
        assert_eq!(
            seen.header("authorization"),
            Some(format!("Bearer {KEY}").as_str())
        );
        let (base, _seen) = stub(404, "", "{}");
        assert_eq!(
            block_on(test_key("gpt-6-luna", &key, &base)).code,
            Some(ErrorCode::ModelNotFound)
        );
        assert_eq!(key_test_result(401).code, Some(ErrorCode::InvalidKey));
    }
}
