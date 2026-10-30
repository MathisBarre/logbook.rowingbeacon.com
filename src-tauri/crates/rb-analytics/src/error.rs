//! The error envelope every analytics command rejects with (plan 2.2,
//! appendix E.4): `{ code, message, offset?, object?, retryAfterSeconds? }`.
//! TypeScript turns it into `AnalyticsError` (engine codes) or reads it as
//! `AiErrorPayload` (AI codes), told apart by the command that failed.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Engine codes (`AnalyticsErrorCode`) and AI codes (`AiErrorCode`) in one
/// enum; `timeout` and `too_large` belong to both families.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    // Engine (AnalyticsErrorCode).
    Syntax,
    Denied,
    NotReadOnly,
    MultipleStatements,
    Timeout,
    Cancelled,
    TooLarge,
    MissingParam,
    InvalidParam,
    Busy,
    DesktopOnly,
    Internal,
    // AI (AiErrorCode).
    NoKey,
    InvalidKey,
    Forbidden,
    RateLimited,
    Overloaded,
    BadRequest,
    Network,
    Refusal,
    Truncated,
    ModelNotAllowed,
    /// The server does not know the model, or the key cannot use it.
    ModelNotFound,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Syntax => "syntax",
            ErrorCode::Denied => "denied",
            ErrorCode::NotReadOnly => "not_read_only",
            ErrorCode::MultipleStatements => "multiple_statements",
            ErrorCode::Timeout => "timeout",
            ErrorCode::Cancelled => "cancelled",
            ErrorCode::TooLarge => "too_large",
            ErrorCode::MissingParam => "missing_param",
            ErrorCode::InvalidParam => "invalid_param",
            ErrorCode::Busy => "busy",
            ErrorCode::DesktopOnly => "desktop_only",
            ErrorCode::Internal => "internal",
            ErrorCode::NoKey => "no_key",
            ErrorCode::InvalidKey => "invalid_key",
            ErrorCode::Forbidden => "forbidden",
            ErrorCode::RateLimited => "rate_limited",
            ErrorCode::Overloaded => "overloaded",
            ErrorCode::BadRequest => "bad_request",
            ErrorCode::Network => "network",
            ErrorCode::Refusal => "refusal",
            ErrorCode::Truncated => "truncated",
            ErrorCode::ModelNotAllowed => "model_not_allowed",
            ErrorCode::ModelNotFound => "model_not_found",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticsError {
    pub code: ErrorCode,
    /// English, technical (SQLite's text for syntax and denied errors).
    pub message: String,
    /// Position in the SQL, in UTF-16 code units (the editor's unit):
    /// convert SQLite's byte offsets with `utf16_offset`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<usize>,
    /// `denied`: the table or `table.column`; `missing_param` and
    /// `invalid_param`: the parameter name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object: Option<String>,
    /// `rate_limited`: the API's `retry-after`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
}

impl AnalyticsError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        AnalyticsError {
            code,
            message: message.into(),
            offset: None,
            object: None,
            retry_after_seconds: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn with_offset(mut self, offset: usize) -> Self {
        self.offset = Some(offset);
        self
    }

    pub fn with_object(mut self, object: impl Into<String>) -> Self {
        self.object = Some(object.into());
        self
    }

    pub fn with_retry_after(mut self, seconds: u64) -> Self {
        self.retry_after_seconds = Some(seconds);
        self
    }
}

impl fmt::Display for AnalyticsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AnalyticsError {}

/// Converts a byte offset of `sql` (SQLite's unit) to UTF-16 code units
/// (the unit of `AnalyticsError.offset`). Offsets past the end clamp.
pub fn utf16_offset(sql: &str, byte_offset: usize) -> usize {
    let mut end = byte_offset.min(sql.len());
    while !sql.is_char_boundary(end) {
        end -= 1;
    }
    sql[..end].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_without_empty_fields() {
        let error = AnalyticsError::new(ErrorCode::NotReadOnly, "Only read queries are allowed");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "code": "not_read_only", "message": "Only read queries are allowed" })
        );
        let error =
            AnalyticsError::new(ErrorCode::RateLimited, "rate limited").with_retry_after(30);
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "code": "rate_limited", "message": "rate limited", "retryAfterSeconds": 30 })
        );
    }

    #[test]
    fn as_str_matches_serde() {
        for code in [
            ErrorCode::MultipleStatements,
            ErrorCode::ModelNotAllowed,
            ErrorCode::ModelNotFound,
            ErrorCode::DesktopOnly,
        ] {
            assert_eq!(serde_json::to_value(code).unwrap(), code.as_str());
        }
    }

    #[test]
    fn converts_byte_offsets_to_utf16() {
        let sql = "SELECT 'été' FORM x";
        let byte = sql.find("FORM").unwrap();
        assert_eq!(
            utf16_offset(sql, byte),
            "SELECT 'été' ".encode_utf16().count()
        );
        assert_eq!(utf16_offset("🚣 x", 4), 2);
        assert_eq!(utf16_offset("abc", 99), 3);
    }
}
