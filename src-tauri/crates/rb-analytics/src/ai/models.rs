//! The models the in-app assistant may call (plan 2.11, ADR 0008 "AI
//! providers") and what each one accepts.
//!
//! Anthropic, checked against the live docs on 2026-10-29:
//!
//! - all three accept structured outputs (`output_config.format`) and
//!   `output_config.effort` (low to max; Opus 5.5 and Haiku 5.5 default to
//!   medium, so the app always sends it);
//! - none accepts `temperature`, `top_p` or `top_k` on API version
//!   `2026-10-21`, nor an assistant prefill, nor `thinking: disabled`
//!   (Opus 5.5) or a forced `tool_choice` (Opus 5.5, Sonnet 5.5): the
//!   proxy never sends any of them;
//! - server-side fallback (`fallbacks: "default"` with the beta header
//!   `server-side-fallback-2026-07-01`) exists for Opus 5.5 and Sonnet
//!   5.5; Haiku 5.5 has none ("a declined request stays declined").
//!
//! OpenAI, checked against developers.openai.com on 2026-10-29 (models,
//! pricing and the changelog up to GPT-6.1 Terra, 2026-10-26): the four
//! featured text models all list Structured Outputs on both the Responses
//! and Chat Completions endpoints, and `reasoning.effort` low, medium and
//! high (Astra and 6.1 Sol refuse `none`, which the app never sends).
//! None takes `temperature` or `top_p` with reasoning on: never sent.
//!
//! An OpenAI-compatible server takes any model name the club types: only
//! its shape is checked (`check_model_name`).

use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::AiModel;

/// Every model the proxy accepts, cheapest last.
pub const ALLOWED_MODELS: [AiModel; 3] = [
    AiModel::ClaudeOpus55,
    AiModel::ClaudeSonnet55,
    AiModel::ClaudeHaiku55,
];

/// Model of a fresh install (`analytics.ai.model`).
pub const DEFAULT_MODEL: AiModel = AiModel::ClaudeOpus55;

/// `max_tokens` above this is refused before any call (plan 2.11).
pub const MAX_TOKENS_CAP: u32 = 16_000;

/// System prompt plus messages, in characters (plan 2.11).
pub const MAX_PROMPT_CHARS: usize = 400_000;

/// Structured-output limits of the API ("Explicit limits"): parameters
/// with a union type (`anyOf` or a type array) and optional parameters,
/// across the whole output schema.
pub const MAX_SCHEMA_UNION_PARAMS: usize = 16;
pub const MAX_SCHEMA_OPTIONAL_PARAMS: usize = 24;

/// Cache breakpoints the Messages API accepts in one request.
pub const MAX_CACHE_BREAKPOINTS: usize = 4;

/// The OpenAI models offered in the settings, most capable first.
pub const OPENAI_MODELS: [&str; 4] = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"];

/// OpenAI model of a fresh choice: GPT-6.1 Sol, "near-Astra performance
/// for complex work at lower cost" (models page), at the price level of
/// Claude Opus 5.5 instead of 2.5 times it.
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-6.1-sol";

/// Longest model name sent to an OpenAI-compatible server
/// ("mistralai/mistral-large-2411", "qwen3:30b-a3b-instruct-q4_K_M"…).
pub const MAX_MODEL_NAME_CHARS: usize = 200;

/// Reads a model id; anything outside the allowlist is `model_not_allowed`.
pub fn parse_model(id: &str) -> Result<AiModel, AnalyticsError> {
    ALLOWED_MODELS
        .into_iter()
        .find(|model| model.as_str() == id)
        .ok_or_else(|| {
            AnalyticsError::new(
                ErrorCode::ModelNotAllowed,
                format!(
                    "Model {id:?} is not allowed. Use one of: {}",
                    ALLOWED_MODELS.map(AiModel::as_str).join(", ")
                ),
            )
        })
}

/// An OpenAI model id of the allowlist, else `model_not_allowed`.
pub fn parse_openai_model(id: &str) -> Result<&'static str, AnalyticsError> {
    OPENAI_MODELS
        .into_iter()
        .find(|model| *model == id)
        .ok_or_else(|| {
            AnalyticsError::new(
                ErrorCode::ModelNotAllowed,
                format!(
                    "Model {id:?} is not allowed for OpenAI. Use one of: {}",
                    OPENAI_MODELS.join(", ")
                ),
            )
        })
}

/// A model name for an OpenAI-compatible server: 1-200 characters, no
/// control characters, no spaces at either end.
pub fn check_model_name(name: &str) -> Result<(), AnalyticsError> {
    let count = name.chars().count();
    if count == 0 || count > MAX_MODEL_NAME_CHARS || name.trim() != name {
        return Err(AnalyticsError::new(
            ErrorCode::ModelNotAllowed,
            format!(
                "The model name must have 1 to {MAX_MODEL_NAME_CHARS} characters, without spaces around it"
            ),
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(AnalyticsError::new(
            ErrorCode::ModelNotAllowed,
            "The model name contains control characters",
        ));
    }
    Ok(())
}

/// Whether `fallbacks: "default"` (and its beta header) may be sent.
pub fn supports_server_fallback(model: AiModel) -> bool {
    match model {
        AiModel::ClaudeOpus55 | AiModel::ClaudeSonnet55 => true,
        AiModel::ClaudeHaiku55 => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_allowed_models() {
        for model in ALLOWED_MODELS {
            assert_eq!(parse_model(model.as_str()).unwrap(), model);
        }
        for bad in ["claude-opus-5", "claude-fable-5-1", "", "CLAUDE-OPUS-5-5"] {
            let error = parse_model(bad).unwrap_err();
            assert_eq!(error.code, ErrorCode::ModelNotAllowed, "{bad}");
        }
        assert_eq!(DEFAULT_MODEL.as_str(), "claude-opus-5-5");
    }

    #[test]
    fn openai_models_and_compatible_names() {
        for model in OPENAI_MODELS {
            assert_eq!(parse_openai_model(model).unwrap(), model);
        }
        assert!(OPENAI_MODELS.contains(&DEFAULT_OPENAI_MODEL));
        for bad in ["gpt-4o", "claude-opus-5-5", "", "GPT-6-ASTRA"] {
            assert_eq!(
                parse_openai_model(bad).unwrap_err().code,
                ErrorCode::ModelNotAllowed
            );
        }
        check_model_name("mistral-large-latest").unwrap();
        check_model_name("qwen3:30b-a3b").unwrap();
        check_model_name("meta-llama/llama-4-maverick:free").unwrap();
        for bad in ["", " llama3", "llama3\n", "a\u{7}b"] {
            assert!(check_model_name(bad).is_err(), "{bad:?}");
        }
        assert!(check_model_name(&"m".repeat(201)).is_err());
    }

    #[test]
    fn haiku_has_no_server_fallback() {
        assert!(supports_server_fallback(AiModel::ClaudeOpus55));
        assert!(supports_server_fallback(AiModel::ClaudeSonnet55));
        assert!(!supports_server_fallback(AiModel::ClaudeHaiku55));
    }
}
