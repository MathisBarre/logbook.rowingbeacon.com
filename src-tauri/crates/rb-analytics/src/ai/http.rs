//! HTTP plumbing shared by the providers: one reqwest client (rustls,
//! redirects never followed), capped bodies, transport errors without the
//! URL, `retry-after`, and the error text of an API body.

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::AiProvider;

/// Non-streaming: the whole answer, thinking included, arrives at once.
/// Up to 16,000 tokens can take several minutes on a hard question (or on
/// a local model), so this is the SDKs' default for non-streaming requests
/// (10 minutes), not an estimate of the usual time (review A, L4).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
pub const KEY_TEST_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// An answer is at most 16,000 tokens of JSON: 4 MB is plenty.
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
/// `GET {base}/models` of a compatible server: a catalog such as
/// OpenRouter's lists hundreds of models with their descriptions.
pub(crate) const MAX_MODEL_LIST_BYTES: usize = 32 * 1024 * 1024;
/// API error messages shown to the user are cut to this many characters.
pub(crate) const MAX_API_MESSAGE_CHARS: usize = 500;

fn build_client(proxy: bool) -> Result<reqwest::Client, AnalyticsError> {
    let builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!(
            "RowingBeacon-analytics/",
            env!("CARGO_PKG_VERSION")
        ));
    let builder = if proxy { builder } else { builder.no_proxy() };
    builder
        .build()
        .map_err(|e| AnalyticsError::internal(format!("HTTP client: {}", e.without_url())))
}

/// The shared client. Redirects are never followed: a redirect could carry
/// the key header to another host, and no API of the list redirects. It
/// uses the system's `HTTPS_PROXY` (a club network may need one).
pub(crate) fn client() -> Result<&'static reqwest::Client, AnalyticsError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = build_client(true)?;
    Ok(CLIENT.get_or_init(|| built))
}

/// The client for a server on this computer: never through a proxy, which
/// would not reach this computer's `localhost` (and would see the
/// prompt), whatever `NO_PROXY` says.
pub(crate) fn local_client() -> Result<&'static reqwest::Client, AnalyticsError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = build_client(false)?;
    Ok(CLIENT.get_or_init(|| built))
}

/// `local_client` for a server on this computer, `client` otherwise.
pub(crate) fn client_for(local: bool) -> Result<&'static reqwest::Client, AnalyticsError> {
    if local {
        local_client()
    } else {
        client()
    }
}

/// A transport failure: `timeout` or `network`. The URL is dropped from
/// the message (it holds nothing secret, but it is noise for the user).
pub(crate) fn transport_error(provider: AiProvider, error: reqwest::Error) -> AnalyticsError {
    let who = provider.label();
    if error.is_timeout() {
        AnalyticsError::new(
            ErrorCode::Timeout,
            format!(
                "{} did not answer in time. Try again, or ask a shorter question.",
                capitalized(who)
            ),
        )
    } else {
        AnalyticsError::new(
            ErrorCode::Network,
            format!("Could not reach {who}: {}", error.without_url()),
        )
    }
}

/// "the AI server" → "The AI server" at the start of a sentence.
pub(crate) fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

pub(crate) async fn read_body(
    provider: AiProvider,
    response: reqwest::Response,
) -> Result<Vec<u8>, AnalyticsError> {
    read_body_limited(provider, response, MAX_RESPONSE_BYTES).await
}

/// The body, up to `max_bytes` (`too_large` beyond).
pub(crate) async fn read_body_limited(
    provider: AiProvider,
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, AnalyticsError> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| transport_error(provider, e))?
    {
        if body.len() + chunk.len() > max_bytes {
            return Err(AnalyticsError::new(
                ErrorCode::TooLarge,
                format!("The answer from {} is too large", provider.label()),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Status, `retry-after` and body of a response.
pub(crate) struct HttpAnswer {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: Vec<u8>,
}

/// Sends the request and reads the whole answer.
pub(crate) async fn send(
    provider: AiProvider,
    request: reqwest::RequestBuilder,
) -> Result<HttpAnswer, AnalyticsError> {
    let response = request
        .send()
        .await
        .map_err(|e| transport_error(provider, e))?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = read_body(provider, response).await?;
    Ok(HttpAnswer {
        status,
        retry_after,
        body,
    })
}

/// Seconds of a `retry-after` header (an integer; an HTTP date is ignored).
pub(crate) fn parse_retry_after(value: Option<&str>) -> Option<u64> {
    let seconds: f64 = value?.trim().parse().ok()?;
    (seconds.is_finite() && seconds >= 0.0).then(|| seconds.ceil() as u64)
}

/// Cuts a message for display.
pub(crate) fn cut(message: &str) -> String {
    let mut cut: String = message.chars().take(MAX_API_MESSAGE_CHARS).collect();
    if cut.len() < message.len() {
        cut.push('…');
    }
    cut
}

/// The error text of an API body, cut for display: `error.message`
/// (Anthropic, OpenAI and most compatible servers), `error` as a string
/// (Ollama), `message` or `detail` (other servers).
pub(crate) fn api_message(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let message = value
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .and_then(Value::as_str)
                .or(error.as_str())
        })
        .or_else(|| value.get("message").and_then(Value::as_str))
        .or_else(|| value.get("detail").and_then(Value::as_str))?;
    Some(cut(message))
}

/// `error.code` (or `error.type`) of an OpenAI-style error body.
pub(crate) fn api_error_codes(body: &[u8]) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return (None, None);
    };
    let field = |name: &str| {
        value
            .get("error")
            .and_then(|error| error.get(name))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    (field("code"), field("type"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_error_messages_of_every_shape() {
        let body = |v: Value| v.to_string().into_bytes();
        assert_eq!(
            api_message(&body(json!({ "error": { "message": "bad model" } }))).as_deref(),
            Some("bad model")
        );
        assert_eq!(
            api_message(&body(json!({ "error": "model 'x' not found" }))).as_deref(),
            Some("model 'x' not found")
        );
        assert_eq!(
            api_message(&body(json!({ "message": "Unauthorized" }))).as_deref(),
            Some("Unauthorized")
        );
        assert_eq!(
            api_message(&body(json!({ "detail": "Not Found" }))).as_deref(),
            Some("Not Found")
        );
        assert_eq!(api_message(b"<html>"), None);
        let long = "é".repeat(2000);
        let message = api_message(&body(json!({ "error": { "message": long } }))).unwrap();
        assert!(message.chars().count() <= MAX_API_MESSAGE_CHARS + 1);
        assert!(message.ends_with('…'));
        assert_eq!(
            api_error_codes(&body(
                json!({ "error": { "code": "slow_down", "type": "rate_limit_error" } })
            )),
            (Some("slow_down".into()), Some("rate_limit_error".into()))
        );
    }

    #[test]
    fn retry_after_in_seconds_only() {
        assert_eq!(parse_retry_after(Some("30")), Some(30));
        assert_eq!(parse_retry_after(Some("1.2")), Some(2));
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
        assert_eq!(parse_retry_after(None), None);
        assert_eq!(capitalized("the AI server"), "The AI server");
    }
}
