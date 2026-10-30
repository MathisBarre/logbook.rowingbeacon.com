//! Serde mirror of the IPC contract (`src/analytics/types.ts` and
//! `src/analytics/engine/ipc.ts`, plan 2.6 and appendix E.4). Frozen: a
//! change here goes with the same change in TypeScript and in
//! `src/analytics/engine/ipc-fixtures.json`, which both sides test against.
//!
//! Conventions: camelCase on the wire; a TS field `x?: T` is an `Option`
//! skipped when `None`; a TS field `x: T | null` is an `Option` always
//! written (as `null`). Parameter and result values are JSON values.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use crate::error::{AnalyticsError, ErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Privacy {
    /// Names readable (the app).
    Nominative,
    /// Personal and free-text columns read as NULL (MCP default).
    Pseudonymised,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunQueryRequest {
    /// uuid v4, key of the cancel flag.
    pub request_id: String,
    pub sql: String,
    /// Names without prefix; values are string, number, boolean or null.
    pub params: Map<String, Value>,
    pub max_rows: u32,
    pub timeout_ms: u64,
    pub privacy: Privacy,
    /// Local wall-clock time "YYYY-MM-DDTHH:mm".
    pub now: String,
    pub use_cache: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultColumn {
    pub name: String,
    pub decl_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryResult {
    /// Duplicate names are kept.
    pub columns: Vec<ResultColumn>,
    /// One array per row: string, number or null.
    pub rows: Vec<Vec<Value>>,
    pub truncated: bool,
    pub elapsed_ms: u64,
    /// Base columns read as NULL: "rower.email", …
    pub ignored_columns: Vec<String>,
    pub cached: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineObjects {
    pub views: Vec<String>,
    pub tables: Vec<String>,
    pub missing_views: Vec<String>,
}

/// Who answers the in-app assistant (ADR 0008, "AI providers"). Each one
/// has its own key in the key store; `anthropic` is the default, so a
/// request written before providers existed still means Anthropic.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AiProvider {
    /// `https://api.anthropic.com`, Messages API.
    #[default]
    #[serde(rename = "anthropic")]
    Anthropic,
    /// `https://api.openai.com/v1`, Responses API.
    #[serde(rename = "openai")]
    OpenAi,
    /// A server of the club's choice speaking OpenAI's Chat Completions
    /// (Mistral, OpenRouter, a local Ollama or LM Studio…).
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible,
}

impl AiProvider {
    pub const ALL: [AiProvider; 3] = [
        AiProvider::Anthropic,
        AiProvider::OpenAi,
        AiProvider::OpenAiCompatible,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "anthropic",
            AiProvider::OpenAi => "openai",
            AiProvider::OpenAiCompatible => "openai_compatible",
        }
    }

    /// For English error messages: "Anthropic", "OpenAI", "the AI server".
    pub fn label(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "Anthropic",
            AiProvider::OpenAi => "OpenAI",
            AiProvider::OpenAiCompatible => "the AI server",
        }
    }
}

/// The Anthropic models of the allowlist (`ai::models`). OpenAI models are
/// checked by id (`ai::models::OPENAI_MODELS`); an OpenAI-compatible
/// server takes any model name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AiModel {
    #[serde(rename = "claude-opus-5-5")]
    ClaudeOpus55,
    #[serde(rename = "claude-sonnet-5-5")]
    ClaudeSonnet55,
    #[serde(rename = "claude-haiku-5-5")]
    ClaudeHaiku55,
}

impl AiModel {
    pub fn as_str(self) -> &'static str {
        match self {
            AiModel::ClaudeOpus55 => "claude-opus-5-5",
            AiModel::ClaudeSonnet55 => "claude-sonnet-5-5",
            AiModel::ClaudeHaiku55 => "claude-haiku-5-5",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiEffort {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiMessage {
    pub role: AiRole,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSystemBlock {
    pub text: String,
    /// Adds `cache_control: { type: "ephemeral" }`.
    pub cache: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiAskRequest {
    /// uuid v4, for logs only.
    pub request_id: String,
    /// Absent in requests of older builds: Anthropic.
    #[serde(default)]
    pub provider: AiProvider,
    /// Anthropic and OpenAI: an id of the allowlist; OpenAI-compatible:
    /// the server's model name. Checked by `ai::check_request`.
    pub model: String,
    pub effort: AiEffort,
    pub system: Vec<AiSystemBlock>,
    /// Starts and ends with "user", alternating.
    pub messages: Vec<AiMessage>,
    /// The JSON Schema of the answer (appendix E).
    pub output_schema: Value,
    /// 8000; rejected above 16000.
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiAskResponse {
    pub text: String,
    pub stop_reason: String,
    pub model: String,
    pub usage: AiUsage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyStorage {
    Keychain,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyStatus {
    pub stored: bool,
    pub storage: Option<KeyStorage>,
    /// OpenAI-compatible only: the server address saved with the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// OpenAI-compatible only: whether a key goes with the address (a
    /// local server usually needs none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_key: Option<bool>,
    /// The last 4 characters of the stored key, so that volunteers can
    /// tell whose key it is ("…AbCd"); never more of it. None when no key
    /// is stored (or a compatible server has none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl KeyStatus {
    pub fn none() -> Self {
        KeyStatus {
            stored: false,
            storage: None,
            base_url: None,
            has_key: None,
            hint: None,
        }
    }

    pub fn stored(storage: KeyStorage) -> Self {
        KeyStatus {
            stored: true,
            storage: Some(storage),
            base_url: None,
            has_key: None,
            hint: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiKeyTest {
    pub ok: bool,
    /// An AI code when `ok` is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<ErrorCode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpPlatform {
    Windows,
    Macos,
    Linux,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpInfo {
    /// `$APPIMAGE` when set, else `current_exe()`.
    pub exe_path: String,
    /// `["--mcp"]`.
    pub args: Vec<String>,
    pub db_path: String,
    pub inbox_dir: String,
    /// None on Linux (no Claude Desktop).
    pub claude_desktop_config_path: Option<String>,
    pub platform: McpPlatform,
    pub is_app_image: bool,
}

/// The last `tools/call` the MCP server received on this computer
/// (`mcp-last-call.json`, next to the inbox), so the settings can show
/// that an AI app is connected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpLastCall {
    /// MCP `clientInfo.name`, e.g. "claude-ai"; None when not given.
    pub client: Option<String>,
    /// Local wall-clock time "YYYY-MM-DDTHH:mm".
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboxProposal {
    /// File name without `.json` (uuid).
    pub id: String,
    pub created_at: Option<String>,
    /// MCP `clientInfo.name`, e.g. "claude-ai".
    pub client: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub sql: Option<String>,
    /// Validated as ParamDef[] by the app (WP6).
    pub params: Value,
    /// Validated as ChartSpec by the app (WP6).
    pub chart: Value,
    /// Some: unreadable file, listed as such.
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;

    const FIXTURES: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../src/analytics/engine/ipc-fixtures.json"
    ));

    /// Each example deserializes (unknown fields refused) and serializes
    /// back to the same JSON.
    fn round_trip<T: Serialize + DeserializeOwned>(fixtures: &Value, name: &str) -> usize {
        let examples = fixtures[name]
            .as_array()
            .unwrap_or_else(|| panic!("no fixtures for {name}"));
        assert!(!examples.is_empty(), "no fixtures for {name}");
        for example in examples {
            let parsed: T = serde_json::from_value(example.clone())
                .unwrap_or_else(|e| panic!("{name}: {e} in {example}"));
            assert_eq!(&serde_json::to_value(&parsed).unwrap(), example, "{name}");
        }
        examples.len()
    }

    #[test]
    fn mirrors_every_fixture() {
        let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
        let mut covered = vec![
            (
                "RunQueryRequest",
                round_trip::<RunQueryRequest>(&fixtures, "RunQueryRequest"),
            ),
            (
                "QueryResult",
                round_trip::<QueryResult>(&fixtures, "QueryResult"),
            ),
            (
                "EngineObjects",
                round_trip::<EngineObjects>(&fixtures, "EngineObjects"),
            ),
            (
                "AnalyticsErrorPayload",
                round_trip::<AnalyticsError>(&fixtures, "AnalyticsErrorPayload"),
            ),
            (
                "AiErrorPayload",
                round_trip::<AnalyticsError>(&fixtures, "AiErrorPayload"),
            ),
            (
                "AiAskRequest",
                round_trip::<AiAskRequest>(&fixtures, "AiAskRequest"),
            ),
            (
                "AiAskResponse",
                round_trip::<AiAskResponse>(&fixtures, "AiAskResponse"),
            ),
            ("KeyStatus", round_trip::<KeyStatus>(&fixtures, "KeyStatus")),
            ("AiKeyTest", round_trip::<AiKeyTest>(&fixtures, "AiKeyTest")),
            ("McpInfo", round_trip::<McpInfo>(&fixtures, "McpInfo")),
            (
                "InboxProposal",
                round_trip::<InboxProposal>(&fixtures, "InboxProposal"),
            ),
        ];
        // Every type of the fixture file has a Rust mirror.
        covered.sort();
        let mut names: Vec<&str> = covered.iter().map(|(name, _)| *name).collect();
        let mut expected: Vec<&str> = fixtures
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        names.sort();
        expected.sort();
        assert_eq!(names, expected);
    }

    #[test]
    fn refuses_unknown_fields() {
        let bad = serde_json::json!({ "views": [], "tables": [], "missingViews": [], "extra": 1 });
        assert!(serde_json::from_value::<EngineObjects>(bad).is_err());
    }

    #[test]
    fn provider_names_match_serde() {
        for provider in AiProvider::ALL {
            assert_eq!(serde_json::to_value(provider).unwrap(), provider.as_str());
        }
        // Requests of builds without providers mean Anthropic.
        let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
        let mut old = fixtures["AiAskRequest"][0].clone();
        old.as_object_mut().unwrap().remove("provider");
        let parsed: AiAskRequest = serde_json::from_value(old).unwrap();
        assert_eq!(parsed.provider, AiProvider::Anthropic);
    }

    #[test]
    fn model_names_match_serde() {
        for model in [
            AiModel::ClaudeOpus55,
            AiModel::ClaudeSonnet55,
            AiModel::ClaudeHaiku55,
        ] {
            assert_eq!(serde_json::to_value(model).unwrap(), model.as_str());
        }
    }
}
