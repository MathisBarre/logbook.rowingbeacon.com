//! The in-app assistant's proxy (plan 2.11, ADR 0008 "AI providers") and
//! its key store (plan 2.13).
//!
//! The webview never sees a key: it sends the prompt with the provider's
//! name, Rust adds the key from the store and calls the provider:
//!
//! | Provider            | Where                                  | API                |
//! |---------------------|----------------------------------------|--------------------|
//! | `anthropic`         | `https://api.anthropic.com` (fixed)    | Messages           |
//! | `openai`            | `https://api.openai.com/v1` (fixed)    | Responses          |
//! | `openai_compatible` | the address saved with its key         | Chat Completions   |
//!
//! Adding a provider: a variant of `ipc::AiProvider`, a module with
//! `validate`, `ask` and `test_key`, its key rules in `key_store`, and one
//! arm in each `match` below.
//!
//! Same guardrails for every provider: only the system prompt, the
//! conversation (questions, the model's own answers, the redacted engine
//! errors of the repair loop) and the answer schema are sent, never rows;
//! the request is checked before the key is read; keys never reach
//! `main.db`, backups or logs; redirects are never followed.

pub(crate) mod anthropic;
pub mod base_url;
pub(crate) mod http;
pub mod key_store;
pub mod models;
pub(crate) mod openai;
pub(crate) mod openai_compatible;
pub(crate) mod schema;
#[cfg(test)]
pub(crate) mod test_support;

use serde_json::Value;

use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{AiAskRequest, AiAskResponse, AiEffort, AiKeyTest, AiProvider, AiRole};
use key_store::Credential;
use models::{MAX_PROMPT_CHARS, MAX_TOKENS_CAP};

pub use anthropic::{ANTHROPIC_BASE_URL, API_VERSION, FALLBACK_BETA};
pub use openai::OPENAI_BASE_URL;

pub(crate) fn effort_str(effort: AiEffort) -> &'static str {
    match effort {
        AiEffort::Low => "low",
        AiEffort::Medium => "medium",
        AiEffort::High => "high",
    }
}

fn bad_request(message: impl Into<String>) -> AnalyticsError {
    AnalyticsError::new(ErrorCode::BadRequest, message)
}

/// Checks every provider makes: `maxTokens` 1-16,000, roles alternating
/// from "user" to "user" (no prefill), no empty text, prompt ≤ 400,000
/// characters, an output schema of type object.
pub(crate) fn check_common(req: &AiAskRequest) -> Result<(), AnalyticsError> {
    if req.max_tokens == 0 || req.max_tokens > MAX_TOKENS_CAP {
        return Err(bad_request(format!(
            "maxTokens must be between 1 and {MAX_TOKENS_CAP}"
        )));
    }
    if req.messages.is_empty() {
        return Err(bad_request("The conversation is empty"));
    }
    for (index, message) in req.messages.iter().enumerate() {
        let expected = if index % 2 == 0 {
            AiRole::User
        } else {
            AiRole::Assistant
        };
        if message.role != expected {
            return Err(bad_request(
                "Messages must alternate user and assistant, starting with user",
            ));
        }
        if message.content.trim().is_empty() {
            return Err(bad_request(format!("Message {index} is empty")));
        }
    }
    if req.messages.last().map(|m| m.role) != Some(AiRole::User) {
        return Err(bad_request(
            "The conversation must end with a user message (no prefill)",
        ));
    }
    if req.system.iter().any(|block| block.text.trim().is_empty()) {
        return Err(bad_request("A system block is empty"));
    }
    let chars: usize = req
        .system
        .iter()
        .map(|block| block.text.chars().count())
        .chain(req.messages.iter().map(|m| m.content.chars().count()))
        .sum();
    if chars > MAX_PROMPT_CHARS {
        return Err(AnalyticsError::new(
            ErrorCode::TooLarge,
            format!("The prompt has {chars} characters (at most {MAX_PROMPT_CHARS})"),
        ));
    }
    if req.output_schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err(bad_request(
            "outputSchema must be a JSON Schema of type object",
        ));
    }
    Ok(())
}

/// The checks `ask` makes before reading the key: `check_common`, then the
/// provider's own: Anthropic's model allowlist, at most 4 cached system
/// blocks and its structured-output limits (≤ 16 union-typed and ≤ 24
/// optional properties); OpenAI's model allowlist and strict-mode limits;
/// for a compatible server, a model name and the strict-mode limits.
pub fn check_request(req: &AiAskRequest) -> Result<(), AnalyticsError> {
    match req.provider {
        AiProvider::Anthropic => anthropic::validate(req).map(|_| ()),
        AiProvider::OpenAi => openai::validate(req).map(|_| ()),
        AiProvider::OpenAiCompatible => openai_compatible::validate(req),
    }
}

/// One question with structured output. The request is checked
/// (`check_request`) before the key is read. Reads the key on the calling
/// thread: an async caller reads it on a blocking thread with
/// `key_store::get_credential` and calls `ask_with_credential` (the app
/// does).
pub async fn ask(req: AiAskRequest) -> Result<AiAskResponse, AnalyticsError> {
    check_request(&req)?;
    let credential = key_store::get_credential(req.provider)?;
    ask_with_credential(&req, &credential).await
}

/// `ask` with a credential already read. Checks the request again (cheap)
/// and that the credential is the provider's.
pub async fn ask_with_credential(
    req: &AiAskRequest,
    credential: &Credential,
) -> Result<AiAskResponse, AnalyticsError> {
    check_request(req)?;
    match (req.provider, credential) {
        (AiProvider::Anthropic, Credential::Anthropic(key)) => {
            anthropic::ask(req, key, ANTHROPIC_BASE_URL).await
        }
        (AiProvider::OpenAi, Credential::OpenAi(key)) => {
            openai::ask(req, key, OPENAI_BASE_URL).await
        }
        (AiProvider::OpenAiCompatible, Credential::Compatible(connection)) => {
            openai_compatible::ask(req, connection).await
        }
        (provider, other) => Err(AnalyticsError::internal(format!(
            "The {} key cannot be used for {}",
            other.provider().as_str(),
            provider.as_str()
        ))),
    }
}

/// A free call that checks the key (and the model): `GET /v1/models/{id}`
/// (Anthropic, OpenAI) or `GET {base}/models` (compatible).
pub async fn test_key(provider: AiProvider, model: &str) -> Result<AiKeyTest, AnalyticsError> {
    test_key_with(provider, model, key_store::get_credential(provider)).await
}

/// `test_key` with the outcome of `key_store::get_credential`, read by the
/// caller (on a blocking thread: the keychain can prompt or wait on
/// D-Bus). No key is an answer (`ok: false`), not an error; so is a model
/// outside the allowlist.
pub async fn test_key_with(
    provider: AiProvider,
    model: &str,
    credential: Result<Credential, AnalyticsError>,
) -> Result<AiKeyTest, AnalyticsError> {
    let fail = |code| {
        Ok(AiKeyTest {
            ok: false,
            code: Some(code),
        })
    };
    let credential = match credential {
        Ok(credential) => credential,
        Err(error) if error.code == ErrorCode::NoKey => return fail(error.code),
        Err(error) => return Err(error),
    };
    match (provider, &credential) {
        (AiProvider::Anthropic, Credential::Anthropic(key)) => match models::parse_model(model) {
            Ok(model) => Ok(anthropic::test_key(model, key, ANTHROPIC_BASE_URL).await),
            Err(error) => fail(error.code),
        },
        (AiProvider::OpenAi, Credential::OpenAi(key)) => match models::parse_openai_model(model) {
            Ok(model) => Ok(openai::test_key(model, key, OPENAI_BASE_URL).await),
            Err(error) => fail(error.code),
        },
        (AiProvider::OpenAiCompatible, Credential::Compatible(connection)) => {
            match models::check_model_name(model) {
                Ok(()) => Ok(openai_compatible::test_key(model, connection).await),
                Err(error) => fail(error.code),
            }
        }
        _ => Err(AnalyticsError::internal(
            "The key belongs to another provider",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::key_store::ApiKey;
    use crate::ai::test_support::{block_on, request};

    #[test]
    fn check_request_dispatches_on_the_provider() {
        check_request(&request(AiProvider::Anthropic, "claude-opus-5-5")).unwrap();
        check_request(&request(AiProvider::OpenAi, "gpt-6-astra")).unwrap();
        check_request(&request(AiProvider::OpenAiCompatible, "llama3.3")).unwrap();
        for (provider, model) in [
            (AiProvider::Anthropic, "gpt-6-astra"),
            (AiProvider::OpenAi, "claude-opus-5-5"),
            (AiProvider::OpenAiCompatible, ""),
        ] {
            assert_eq!(
                check_request(&request(provider, model)).unwrap_err().code,
                ErrorCode::ModelNotAllowed,
                "{provider:?} {model}"
            );
        }
        // The shared checks hold for every provider.
        for provider in AiProvider::ALL {
            let model = match provider {
                AiProvider::Anthropic => "claude-haiku-5-5",
                AiProvider::OpenAi => "gpt-6-luna",
                AiProvider::OpenAiCompatible => "m",
            };
            let mut req = request(provider, model);
            req.messages[0].content = " ".into();
            assert_eq!(check_request(&req).unwrap_err().code, ErrorCode::BadRequest);
        }
    }

    #[test]
    fn a_key_only_works_for_its_provider() {
        let key = ApiKey::parse("sk-ant-api03-0123456789abcdefghij").unwrap();
        let error = block_on(ask_with_credential(
            &request(AiProvider::OpenAi, "gpt-6-astra"),
            &Credential::Anthropic(key.clone()),
        ))
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
        let tested = block_on(test_key_with(
            AiProvider::Anthropic,
            "gpt-6-astra",
            Ok(Credential::Anthropic(key)),
        ))
        .unwrap();
        assert_eq!(tested.code, Some(ErrorCode::ModelNotAllowed));
    }

    #[test]
    fn no_key_is_an_answer() {
        let tested = block_on(test_key_with(
            AiProvider::OpenAiCompatible,
            "m",
            Err(AnalyticsError::new(ErrorCode::NoKey, "none")),
        ))
        .unwrap();
        assert_eq!(
            tested,
            AiKeyTest {
                ok: false,
                code: Some(ErrorCode::NoKey)
            }
        );
    }
}
