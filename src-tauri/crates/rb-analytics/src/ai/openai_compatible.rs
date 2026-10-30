//! A server of the club's choice that speaks OpenAI's Chat Completions
//! (ADR 0008, "AI providers"): Mistral (`https://api.mistral.ai/v1`),
//! OpenRouter (`https://openrouter.ai/api/v1`), a local Ollama
//! (`http://localhost:11434/v1`) or LM Studio (`http://localhost:1234/v1`)…
//!
//! - `POST {base}/chat/completions`, `authorization: Bearer <key>` when a
//!   key is saved (a local server usually needs none);
//! - body: `model`, `messages` (the system prompt as a `system` message,
//!   then the conversation), `max_tokens` (the name every compatible server
//!   knows), `stream: false`, and the answer format, in three steps:
//!   1. `response_format: { type: "json_schema", json_schema: { name,
//!      strict: true, schema } }` (the schema after `openai_strict`);
//!   2. if the server refuses that (a 400, 422 or 501 whose message names
//!      `response_format`, `json_schema`, `json_object`, structured
//!      outputs or the schema), `response_format: { type: "json_object" }`
//!      with the schema written into the system prompt;
//!   3. if it refuses that too, no `response_format` at all.
//!
//!   A server that asks for `max_completion_tokens` instead of
//!   `max_tokens` (OpenAI's and Azure's reasoning models) gets it on a
//!   second try. What worked is remembered per address and model until
//!   the app quits (another model of the same server may differ).
//!   In steps 2 and 3 nothing enforces the schema on the server: the text
//!   is cleaned here (`<think>` blocks and code fences dropped, the JSON
//!   object cut out) and the app validates it (zod) as for any answer;
//! - no `temperature`, no `reasoning_effort` (servers differ), no tools;
//! - answer: `choices[0].message.content` (text or text parts);
//!   `finish_reason` `length` is cut, `content_filter` or a `refusal`
//!   field is refused;
//! - key test: `GET {base}/models`, and the model must be listed when the
//!   server lists models (`name` and `name:latest` are the same model, as
//!   Ollama lists them); a catalog too large to read is trusted;
//! - a server on this computer is never reached through a proxy.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Map, Value};

use super::http::{self, api_message, KEY_TEST_TIMEOUT};
use super::key_store::CompatibleConnection;
use super::models::check_model_name;
use super::openai::{map_http_error, openai_usage, role, system_text, SCHEMA_NAME};
use super::schema::{check_openai_strict, openai_strict};
use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{AiAskRequest, AiAskResponse, AiKeyTest, AiProvider};

const PROVIDER: AiProvider = AiProvider::OpenAiCompatible;

/// How the answer format is asked for, strictest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FormatMode {
    JsonSchema,
    JsonObject,
    Plain,
}

impl FormatMode {
    fn next(self) -> Option<FormatMode> {
        match self {
            FormatMode::JsonSchema => Some(FormatMode::JsonObject),
            FormatMode::JsonObject => Some(FormatMode::Plain),
            FormatMode::Plain => None,
        }
    }
}

/// How a request is written for one server and model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Shape {
    pub mode: FormatMode,
    /// `max_completion_tokens` instead of `max_tokens`.
    pub completion_tokens: bool,
}

impl Shape {
    pub(crate) const FIRST: Shape = Shape {
        mode: FormatMode::JsonSchema,
        completion_tokens: false,
    };
}

type ShapeKey = (String, String);

/// The shape that worked, per base URL and model, for this run of the
/// app.
fn remembered() -> &'static Mutex<HashMap<ShapeKey, Shape>> {
    static SHAPES: std::sync::OnceLock<Mutex<HashMap<ShapeKey, Shape>>> =
        std::sync::OnceLock::new();
    SHAPES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn shape_key(base_url: &str, model: &str) -> ShapeKey {
    (base_url.to_string(), model.to_string())
}

fn remembered_shape(base_url: &str, model: &str) -> Shape {
    remembered()
        .lock()
        .map(|shapes| shapes.get(&shape_key(base_url, model)).copied())
        .ok()
        .flatten()
        .unwrap_or(Shape::FIRST)
}

fn remember(base_url: &str, model: &str, shape: Shape) {
    if let Ok(mut shapes) = remembered().lock() {
        shapes.insert(shape_key(base_url, model), shape);
    }
}

fn bad_request(message: impl Into<String>) -> AnalyticsError {
    AnalyticsError::new(ErrorCode::BadRequest, message)
}

pub(crate) fn validate(req: &AiAskRequest) -> Result<(), AnalyticsError> {
    super::check_common(req)?;
    check_model_name(&req.model)?;
    check_openai_strict(&openai_strict(&req.output_schema))
        .map_err(|problem| bad_request(format!("outputSchema: {problem}")))
}

/// Added to the system prompt when the server does not enforce the schema.
pub(crate) fn schema_instruction(schema: &Value) -> String {
    format!(
        "Answer with one JSON object only, without any text or code fence around it. \
         It must match this JSON Schema exactly (every property present):\n{schema}"
    )
}

/// The JSON body of `POST {base}/chat/completions` for one shape.
pub(crate) fn build_body(req: &AiAskRequest, shape: Shape) -> Value {
    let mode = shape.mode;
    let schema = openai_strict(&req.output_schema);
    let mut system = system_text(req);
    if mode != FormatMode::JsonSchema {
        if !system.is_empty() {
            system.push_str("\n\n");
        }
        system.push_str(&schema_instruction(&schema));
    }
    let mut messages = Vec::with_capacity(req.messages.len() + 1);
    if !system.is_empty() {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.extend(
        req.messages
            .iter()
            .map(|message| json!({ "role": role(message.role), "content": message.content })),
    );
    let mut body = Map::new();
    body.insert("model".into(), json!(req.model));
    body.insert("messages".into(), Value::Array(messages));
    let tokens = if shape.completion_tokens {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    body.insert(tokens.into(), json!(req.max_tokens));
    body.insert("stream".into(), json!(false));
    match mode {
        FormatMode::JsonSchema => {
            body.insert(
                "response_format".into(),
                json!({ "type": "json_schema", "json_schema": {
                    "name": SCHEMA_NAME, "strict": true, "schema": schema
                }}),
            );
        }
        FormatMode::JsonObject => {
            body.insert("response_format".into(), json!({ "type": "json_object" }));
        }
        FormatMode::Plain => {}
    }
    Value::Object(body)
}

/// Whether an error answer clearly says the server does not take this
/// format: a 400, 422 or 501 whose message names it (review D, L4). An
/// answer without a readable message (an HTML page from a proxy) or about
/// something else is an ordinary error.
pub(crate) fn rejects_format(status: u16, body: &[u8]) -> bool {
    if !matches!(status, 400 | 422 | 501) {
        return false;
    }
    let Some(message) = api_message(body) else {
        return false;
    };
    let message = message.to_ascii_lowercase();
    [
        "response_format",
        "response format",
        "json_schema",
        "json schema",
        "json_object",
        "structured output",
        "schema",
    ]
    .iter()
    .any(|word| message.contains(word))
}

/// Whether a 400 asks for `max_completion_tokens` instead of `max_tokens`
/// (OpenAI's and Azure's reasoning models).
pub(crate) fn wants_completion_tokens(status: u16, body: &[u8]) -> bool {
    status == 400
        && api_message(body).is_some_and(|message| message.contains("max_completion_tokens"))
}

/// One question, trying the format steps from the one remembered.
pub(crate) async fn ask(
    req: &AiAskRequest,
    connection: &CompatibleConnection,
) -> Result<AiAskResponse, AnalyticsError> {
    validate(req)?;
    let base = connection.base_url.as_str();
    let client = http::client_for(connection.base_url.is_local())?;
    let mut shape = remembered_shape(base, &req.model);
    loop {
        let mut request = client
            .post(connection.base_url.join("chat/completions"))
            .timeout(http::REQUEST_TIMEOUT)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .body(build_body(req, shape).to_string());
        if let Some(key) = &connection.key {
            request = request.bearer_auth(key.expose());
        }
        let answer = http::send(PROVIDER, request).await?;
        if answer.status == 200 {
            remember(base, &req.model, shape);
            return parse_success(&answer.body, &req.model, shape.mode);
        }
        if !shape.completion_tokens && wants_completion_tokens(answer.status, &answer.body) {
            shape.completion_tokens = true;
            continue;
        }
        match shape.mode.next() {
            Some(next) if rejects_format(answer.status, &answer.body) => shape.mode = next,
            _ => {
                return Err(map_http_error(
                    PROVIDER,
                    answer.status,
                    answer.retry_after.as_deref(),
                    &answer.body,
                ))
            }
        }
    }
}

/// The JSON object of a model's text: `<think>…</think>` dropped, a code
/// fence removed, the outermost `{…}` cut out. Unchanged when the text
/// already parses.
pub(crate) fn clean_json_text(text: &str) -> String {
    if serde_json::from_str::<Value>(text.trim()).is_ok_and(|v| v.is_object()) {
        return text.trim().to_string();
    }
    let mut rest = text.to_string();
    while let (Some(start), Some(end)) = (rest.find("<think>"), rest.find("</think>")) {
        if end < start {
            break;
        }
        rest.replace_range(start..end + "</think>".len(), "");
    }
    match (rest.find('{'), rest.rfind('}')) {
        (Some(start), Some(end)) if start < end => rest[start..=end].to_string(),
        _ => rest.trim().to_string(),
    }
}

fn message_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => {
            let text: String = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect();
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

/// Reads a 200 answer of Chat Completions.
pub(crate) fn parse_success(
    body: &[u8],
    asked: &str,
    mode: FormatMode,
) -> Result<AiAskResponse, AnalyticsError> {
    let response: Value = serde_json::from_slice(body)
        .map_err(|_| bad_request("The AI server sent an unreadable answer"))?;
    let choice = response
        .pointer("/choices/0")
        .ok_or_else(|| AnalyticsError::internal("The answer from the AI server has no choice"))?;
    let finish = choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .unwrap_or("stop")
        .to_string();
    let message = choice.get("message").unwrap_or(&Value::Null);
    if let Some(refusal) = message
        .get("refusal")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        return Err(AnalyticsError::new(
            ErrorCode::Refusal,
            format!("The model declined to answer: {}", http::cut(refusal)),
        ));
    }
    match finish.as_str() {
        "length" => {
            return Err(AnalyticsError::new(
                ErrorCode::Truncated,
                "The answer was cut off before the end. Ask a narrower question.",
            ))
        }
        "content_filter" => {
            return Err(AnalyticsError::new(
                ErrorCode::Refusal,
                "The model declined to answer",
            ))
        }
        _ => {}
    }
    let raw = message
        .get("content")
        .and_then(message_text)
        .ok_or_else(|| AnalyticsError::internal("The answer from the AI server has no text"))?;
    // Even a server that took the schema may wrap it (a reasoning model's
    // <think> block): cleaning is a no-op on a bare object.
    let _ = mode;
    let text = clean_json_text(&raw);
    let usage = response.get("usage").unwrap_or(&Value::Null);
    Ok(AiAskResponse {
        text,
        stop_reason: finish,
        model: response
            .get("model")
            .and_then(Value::as_str)
            .filter(|model| !model.is_empty())
            .unwrap_or(asked)
            .to_string(),
        usage: openai_usage(
            usage,
            "prompt_tokens",
            "completion_tokens",
            "prompt_tokens_details",
        ),
    })
}

/// Maps `GET {base}/models`: the status, then whether the model is listed.
pub(crate) fn key_test_result(status: u16, body: &[u8], model: &str) -> AiKeyTest {
    let fail = |code| AiKeyTest {
        ok: false,
        code: Some(code),
    };
    match status {
        200 => {}
        401 => return fail(ErrorCode::InvalidKey),
        402 | 403 => return fail(ErrorCode::Forbidden),
        404 => return fail(ErrorCode::BadRequest),
        429 => return fail(ErrorCode::RateLimited),
        408 | 504 => return fail(ErrorCode::Timeout),
        500..=599 => return fail(ErrorCode::Overloaded),
        _ => return fail(ErrorCode::BadRequest),
    }
    let listed: Option<Vec<String>> = serde_json::from_slice::<Value>(body).ok().and_then(|v| {
        v.get("data")?.as_array().map(|models| {
            models
                .iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
    });
    match listed {
        // Some servers list nothing (or only aliases): trust the 200.
        Some(ids)
            if !ids.is_empty()
                && !model.is_empty()
                && !ids.iter().any(|id| same_model(id, model)) =>
        {
            fail(ErrorCode::ModelNotFound)
        }
        _ => AiKeyTest {
            ok: true,
            code: None,
        },
    }
}

/// The listed id names the typed model: the same text, or the same once
/// Ollama's default tag `:latest` is dropped on either side (Ollama lists
/// `llama3.3:latest` and answers to `llama3.3`, review D, M3).
pub(crate) fn same_model(listed: &str, typed: &str) -> bool {
    let bare = |name: &str| name.strip_suffix(":latest").unwrap_or(name).to_string();
    listed == typed || bare(listed) == bare(typed)
}

/// `GET {base}/models`, with the key when there is one. The status decides
/// first; the list is read up to `MAX_MODEL_LIST_BYTES`, and a list too
/// large to read only means the model cannot be checked (review D, L5).
pub(crate) async fn test_key(model: &str, connection: &CompatibleConnection) -> AiKeyTest {
    let failed = |code| AiKeyTest {
        ok: false,
        code: Some(code),
    };
    let client = match http::client_for(connection.base_url.is_local()) {
        Ok(client) => client,
        Err(_) => return failed(ErrorCode::Network),
    };
    let mut request = client
        .get(connection.base_url.join("models"))
        .timeout(KEY_TEST_TIMEOUT)
        .header("accept", "application/json");
    if let Some(key) = &connection.key {
        request = request.bearer_auth(key.expose());
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => return failed(http::transport_error(PROVIDER, error).code),
    };
    let status = response.status().as_u16();
    if status != 200 {
        return key_test_result(status, &[], model);
    }
    match http::read_body_limited(PROVIDER, response, http::MAX_MODEL_LIST_BYTES).await {
        Ok(body) => key_test_result(status, &body, model),
        Err(error) if error.code == ErrorCode::TooLarge => AiKeyTest {
            ok: true,
            code: None,
        },
        Err(error) => failed(error.code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::base_url::BaseUrl;
    use crate::ai::key_store::ApiKey;
    use crate::ai::test_support::{block_on, request, stub, stub_sequence};

    const KEY: &str = "mistral-0123456789abcdef";

    fn compatible_request() -> AiAskRequest {
        request(AiProvider::OpenAiCompatible, "mistral-large-latest")
    }

    fn connection(base: &str, key: Option<&str>) -> CompatibleConnection {
        CompatibleConnection {
            base_url: BaseUrl::parse(base).unwrap(),
            key: key.map(|k| ApiKey::parse_for(AiProvider::OpenAiCompatible, k).unwrap()),
        }
    }

    fn chat_answer(content: &str) -> String {
        json!({
            "id": "c1", "object": "chat.completion", "model": "mistral-large-2411",
            "choices": [{ "index": 0, "finish_reason": "stop",
                          "message": { "role": "assistant", "content": content } }],
            "usage": { "prompt_tokens": 1200, "completion_tokens": 300,
                       "prompt_tokens_details": { "cached_tokens": 1000 } }
        })
        .to_string()
    }

    #[test]
    fn body_of_each_format_step() {
        let req = compatible_request();
        let strict = build_body(&req, Shape::FIRST);
        assert_eq!(
            strict,
            json!({
                "model": "mistral-large-latest",
                "messages": [
                    { "role": "system", "content": "You write SQLite queries." },
                    { "role": "user", "content": "Quels bateaux sortent le plus ?" }
                ],
                "max_tokens": 8000,
                "stream": false,
                "response_format": { "type": "json_schema", "json_schema": {
                    "name": "rowing_beacon_answer", "strict": true, "schema": req.output_schema
                }}
            })
        );
        let shape = |mode| Shape {
            mode,
            completion_tokens: false,
        };
        let object = build_body(&req, shape(FormatMode::JsonObject));
        assert_eq!(object["response_format"], json!({ "type": "json_object" }));
        let system = object["messages"][0]["content"].as_str().unwrap();
        assert!(system.starts_with("You write SQLite queries.\n\nAnswer with one JSON object"));
        assert!(system.contains("\"additionalProperties\":false"));
        let plain = build_body(&req, shape(FormatMode::Plain));
        assert!(plain.get("response_format").is_none());
        let reasoning = build_body(
            &req,
            Shape {
                mode: FormatMode::JsonSchema,
                completion_tokens: true,
            },
        );
        assert_eq!(reasoning["max_completion_tokens"], 8000);
        assert!(reasoning.get("max_tokens").is_none());
        for body in [strict, object, plain] {
            for field in ["temperature", "reasoning_effort", "tools", "top_p"] {
                assert!(body.get(field).is_none(), "{field}");
            }
        }
    }

    #[test]
    fn validation_takes_any_model_name() {
        validate(&compatible_request()).unwrap();
        let mut req = compatible_request();
        req.model = "qwen3:30b".into();
        validate(&req).unwrap();
        req.model = String::new();
        assert_eq!(validate(&req).unwrap_err().code, ErrorCode::ModelNotAllowed);
    }

    #[test]
    fn cleans_texts_of_unconstrained_models() {
        assert_eq!(clean_json_text(" {\"a\":1} "), "{\"a\":1}");
        assert_eq!(
            clean_json_text("<think>Let me write {x}</think>\n```json\n{\"a\": {\"b\": 2}}\n```"),
            "{\"a\": {\"b\": 2}}"
        );
        assert_eq!(clean_json_text("Voici : {\"a\":1} voilà"), "{\"a\":1}");
        assert_eq!(clean_json_text("no json"), "no json");
    }

    #[test]
    fn rejection_detection() {
        let body = |m: &str| {
            json!({ "error": { "message": m } })
                .to_string()
                .into_bytes()
        };
        assert!(rejects_format(
            400,
            &body("response_format json_schema is not supported")
        ));
        assert!(rejects_format(
            422,
            &body("Invalid schema for response_format")
        ));
        assert!(rejects_format(
            400,
            &body("This model does not support structured outputs")
        ));
        // Review D, L4: only a clear refusal of the format.
        assert!(!rejects_format(
            400,
            b"<html><body>Bad Request</body></html>"
        ));
        assert!(!rejects_format(501, b""));
        assert!(!rejects_format(400, &body("Invalid date format in header")));
        assert!(!rejects_format(400, &body("context length exceeded")));
        assert!(!rejects_format(401, &body("response_format")));
        assert!(!rejects_format(500, &body("schema")));
    }

    #[test]
    fn parses_answers_and_usage() {
        let answer = parse_success(
            chat_answer("{\"title\":\"A\"}").as_bytes(),
            "m",
            FormatMode::JsonSchema,
        )
        .unwrap();
        assert_eq!(answer.text, "{\"title\":\"A\"}");
        assert_eq!(answer.model, "mistral-large-2411");
        assert_eq!(answer.stop_reason, "stop");
        assert_eq!(answer.usage.input_tokens, 200);
        assert_eq!(answer.usage.cache_read_input_tokens, 1000);
        assert_eq!(answer.usage.output_tokens, 300);

        let parts = json!({ "choices": [{ "finish_reason": "stop", "message": { "content": [
            { "type": "text", "text": "{\"a\":" }, { "type": "text", "text": "1}" }] } }] });
        let answer =
            parse_success(parts.to_string().as_bytes(), "llama3", FormatMode::Plain).unwrap();
        assert_eq!(
            (answer.text.as_str(), answer.model.as_str()),
            ("{\"a\":1}", "llama3")
        );

        let cut =
            json!({ "choices": [{ "finish_reason": "length", "message": { "content": "{" } }] });
        assert_eq!(
            parse_success(cut.to_string().as_bytes(), "m", FormatMode::JsonSchema)
                .unwrap_err()
                .code,
            ErrorCode::Truncated
        );
        let refused = json!({ "choices": [{ "finish_reason": "stop", "message": { "content": null, "refusal": "No." } }] });
        assert_eq!(
            parse_success(refused.to_string().as_bytes(), "m", FormatMode::JsonSchema)
                .unwrap_err()
                .code,
            ErrorCode::Refusal
        );
        let filtered = json!({ "choices": [{ "finish_reason": "content_filter", "message": { "content": "" } }] });
        assert_eq!(
            parse_success(filtered.to_string().as_bytes(), "m", FormatMode::JsonSchema)
                .unwrap_err()
                .code,
            ErrorCode::Refusal
        );
        assert_eq!(
            parse_success(b"{}", "m", FormatMode::JsonSchema)
                .unwrap_err()
                .code,
            ErrorCode::Internal
        );
    }

    #[test]
    fn posts_with_the_key_to_the_saved_address() {
        let (base, seen) = stub(200, "", &chat_answer("{}"));
        let conn = connection(&format!("{base}/v1"), Some(KEY));
        let answer = block_on(ask(&compatible_request(), &conn)).unwrap();
        assert_eq!(answer.text, "{}");
        let seen = seen.recv().unwrap();
        assert_eq!(seen.request_line, "POST /v1/chat/completions HTTP/1.1");
        assert_eq!(
            seen.header("authorization"),
            Some(format!("Bearer {KEY}").as_str())
        );
        let body: Value = serde_json::from_str(&seen.body).unwrap();
        assert_eq!(body["response_format"]["type"], "json_schema");
    }

    #[test]
    fn no_key_no_authorization_header() {
        let (base, seen) = stub(200, "", &chat_answer("{}"));
        let conn = connection(&base, None);
        block_on(ask(&compatible_request(), &conn)).unwrap();
        assert_eq!(seen.recv().unwrap().header("authorization"), None);
    }

    #[test]
    fn retries_with_max_completion_tokens_when_asked() {
        let (base, seen) = stub_sequence(vec![
            (
                400,
                json!({ "error": { "message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } })
                .to_string(),
            ),
            (200, chat_answer("{}")),
        ]);
        let conn = connection(&format!("{base}/reasoning"), None);
        block_on(ask(&compatible_request(), &conn)).unwrap();
        let first: Value = serde_json::from_str(&seen.recv().unwrap().body).unwrap();
        let second: Value = serde_json::from_str(&seen.recv().unwrap().body).unwrap();
        assert_eq!(first["max_tokens"], 8000);
        assert_eq!(second["max_completion_tokens"], 8000);
        assert!(second.get("max_tokens").is_none());
        assert_eq!(second["response_format"]["type"], "json_schema");
    }

    /// Review D, L4: one model without json_schema does not move the other
    /// models of the same server to plain text.
    #[test]
    fn remembers_the_format_per_model() {
        let base = "https://openrouter.example/api/v1";
        remember(
            base,
            "small-model",
            Shape {
                mode: FormatMode::Plain,
                completion_tokens: false,
            },
        );
        assert_eq!(
            remembered_shape(base, "small-model").mode,
            FormatMode::Plain
        );
        assert_eq!(remembered_shape(base, "big-model"), Shape::FIRST);
        assert_eq!(
            remembered_shape("https://other.example/v1", "small-model"),
            Shape::FIRST
        );
    }

    #[test]
    fn falls_back_to_json_mode_then_plain_and_remembers() {
        let refuse = |m: &str| (400, json!({ "error": { "message": m } }).to_string());
        let (base, seen) = stub_sequence(vec![
            refuse("response_format type json_schema is unavailable for this model"),
            refuse("'response_format' is not supported"),
            (200, chat_answer("```json\n{\"title\":\"B\"}\n```")),
            (200, chat_answer("{\"title\":\"C\"}")),
        ]);
        let conn = connection(&base, None);
        let answer = block_on(ask(&compatible_request(), &conn)).unwrap();
        assert_eq!(answer.text, "{\"title\":\"B\"}");
        let formats: Vec<Value> = (0..3)
            .map(|_| {
                serde_json::from_str::<Value>(&seen.recv().unwrap().body).unwrap()
                    ["response_format"]
                    .clone()
            })
            .collect();
        assert_eq!(formats[0]["type"], "json_schema");
        assert_eq!(formats[1], json!({ "type": "json_object" }));
        assert_eq!(formats[2], Value::Null);
        // The next question starts with the step that worked.
        let answer = block_on(ask(&compatible_request(), &conn)).unwrap();
        assert_eq!(answer.text, "{\"title\":\"C\"}");
        let body: Value = serde_json::from_str(&seen.recv().unwrap().body).unwrap();
        assert!(body.get("response_format").is_none());
    }

    #[test]
    fn other_errors_are_not_retried() {
        let (base, seen) = stub_sequence(vec![(
            401,
            json!({ "error": { "message": "Unauthorized" } }).to_string(),
        )]);
        let conn = connection(&base, Some(KEY));
        let error = block_on(ask(&compatible_request(), &conn)).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidKey);
        assert!(
            error.message.starts_with("The AI server"),
            "{}",
            error.message
        );
        assert!(!error.message.contains(KEY));
        seen.recv().unwrap();
        assert!(seen.try_recv().is_err(), "one request only");
    }

    #[test]
    fn key_test_lists_models() {
        let list =
            json!({ "object": "list", "data": [{ "id": "llama3.3" }, { "id": "qwen3:30b" }] })
                .to_string();
        assert!(key_test_result(200, list.as_bytes(), "qwen3:30b").ok);
        assert_eq!(
            key_test_result(200, list.as_bytes(), "mistral").code,
            Some(ErrorCode::ModelNotFound)
        );
        assert!(key_test_result(200, b"{}", "anything").ok);
        // Review D, M3: Ollama lists tags, and answers to the bare name.
        let ollama =
            json!({ "object": "list", "data": [{ "id": "llama3.3:latest" }, { "id": "qwen3:30b" }] })
                .to_string();
        assert!(key_test_result(200, ollama.as_bytes(), "llama3.3").ok);
        assert!(key_test_result(200, ollama.as_bytes(), "llama3.3:latest").ok);
        assert!(key_test_result(200, list.as_bytes(), "llama3.3:latest").ok);
        assert_eq!(
            key_test_result(200, ollama.as_bytes(), "qwen3").code,
            Some(ErrorCode::ModelNotFound)
        );
        assert_eq!(
            key_test_result(200, ollama.as_bytes(), "llama3").code,
            Some(ErrorCode::ModelNotFound)
        );
        assert_eq!(
            key_test_result(401, b"", "m").code,
            Some(ErrorCode::InvalidKey)
        );
        assert_eq!(
            key_test_result(404, b"", "m").code,
            Some(ErrorCode::BadRequest)
        );

        let (base, seen) = stub(200, "", &list);
        let conn = connection(&format!("{base}/v1/"), None);
        assert!(block_on(test_key("llama3.3", &conn)).ok);
        let seen = seen.recv().unwrap();
        assert_eq!(seen.request_line, "GET /v1/models HTTP/1.1");
        assert_eq!(seen.header("authorization"), None);

        // The status decides before the list is read.
        let (base, _seen) = stub(401, "", "{}");
        let conn = connection(&base, Some(KEY));
        assert_eq!(
            block_on(test_key("m", &conn)).code,
            Some(ErrorCode::InvalidKey)
        );
    }

    /// Review D, L5: a catalog over the 4 MB answer cap is still read.
    #[test]
    fn key_test_reads_a_large_catalog() {
        let models: Vec<Value> = (0..12_000)
            .map(|i| json!({ "id": format!("vendor/model-{i}"), "description": "x".repeat(400) }))
            .collect();
        let mut list = json!({ "data": models });
        list["data"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "id": "mistralai/mistral-large" }));
        let body = list.to_string();
        assert!(body.len() > 4 * 1024 * 1024);
        let (base, _seen) = stub(200, "", &body);
        let conn = connection(&base, None);
        assert!(block_on(test_key("mistralai/mistral-large", &conn)).ok);
    }

    #[test]
    fn unreachable_local_server_is_a_network_error() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let conn = connection(&format!("http://127.0.0.1:{port}/v1"), None);
        let error = block_on(ask(&compatible_request(), &conn)).unwrap_err();
        assert_eq!(error.code, ErrorCode::Network);
        assert!(error.message.contains("the AI server"), "{}", error.message);
    }
}
