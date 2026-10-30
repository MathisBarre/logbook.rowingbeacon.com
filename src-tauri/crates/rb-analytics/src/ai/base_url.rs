//! The address of an OpenAI-compatible server (ADR 0008, "AI providers").
//!
//! It is saved with the server's key in the key store, never in `main.db`,
//! and the webview never sends it with a question: a key can only go to
//! the address it was saved for.
//!
//! Rules: `https://`, or `http://` only for this computer (`localhost`,
//! `127.0.0.1`, `[::1]`: Ollama, LM Studio, llama.cpp); a host; no user
//! name or password, no query, no fragment. The path stays (`/v1`,
//! `/api/v1`): requests go to `{base}/chat/completions` and
//! `{base}/models`, the OpenAI layout every compatible server follows.

use std::fmt;

use crate::error::{AnalyticsError, ErrorCode};

/// Longer addresses are refused (they are typed by hand).
pub const MAX_BASE_URL_CHARS: usize = 2048;

/// Hosts that are this computer: plain `http` is allowed for them, and
/// the settings show no "leaves this computer" warning.
const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// A checked base URL, without a trailing slash.
#[derive(Clone, PartialEq, Eq)]
pub struct BaseUrl {
    url: String,
    local: bool,
}

fn invalid(message: impl Into<String>) -> AnalyticsError {
    AnalyticsError::new(ErrorCode::BadRequest, message)
}

impl BaseUrl {
    pub fn parse(raw: &str) -> Result<BaseUrl, AnalyticsError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(invalid("The server address is empty"));
        }
        if raw.chars().count() > MAX_BASE_URL_CHARS {
            return Err(invalid(format!(
                "The server address has more than {MAX_BASE_URL_CHARS} characters"
            )));
        }
        let url = reqwest::Url::parse(raw)
            .map_err(|_| invalid("The server address is not a valid URL (https://…)"))?;
        let host = match url.host_str() {
            Some(host) if !host.is_empty() => host.to_ascii_lowercase(),
            _ => return Err(invalid("The server address has no host name")),
        };
        if !url.username().is_empty() || url.password().is_some() {
            return Err(invalid(
                "The server address must not contain a user name or a password: \
                 save the key in the key field",
            ));
        }
        if url.query().is_some() || url.fragment().is_some() {
            return Err(invalid(
                "The server address must not contain '?' or '#' parts",
            ));
        }
        let local = LOCAL_HOSTS.contains(&host.as_str());
        match url.scheme() {
            "https" => {}
            "http" if local => {}
            "http" => {
                return Err(invalid(
                    "Only https:// is allowed, except for a server on this computer \
                     (http://localhost, http://127.0.0.1, http://[::1])",
                ))
            }
            _ => return Err(invalid("The server address must start with https://")),
        }
        Ok(BaseUrl {
            url: url.as_str().trim_end_matches('/').to_string(),
            local,
        })
    }

    pub fn as_str(&self) -> &str {
        &self.url
    }

    /// The server runs on this computer.
    pub fn is_local(&self) -> bool {
        self.local
    }

    /// `{base}/{path}`.
    pub fn join(&self, path: &str) -> String {
        format!("{}/{}", self.url, path.trim_start_matches('/'))
    }
}

impl fmt::Debug for BaseUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BaseUrl({})", self.url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_and_local_http() {
        for (raw, normal, local) in [
            (
                "https://api.mistral.ai/v1",
                "https://api.mistral.ai/v1",
                false,
            ),
            (
                " https://openrouter.ai/api/v1/ ",
                "https://openrouter.ai/api/v1",
                false,
            ),
            (
                "http://localhost:11434/v1",
                "http://localhost:11434/v1",
                true,
            ),
            ("http://127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1", true),
            ("http://[::1]:8080/v1", "http://[::1]:8080/v1", true),
            (
                "https://LOCALHOST:8443/v1",
                "https://localhost:8443/v1",
                true,
            ),
            ("https://ai.club.example", "https://ai.club.example", false),
        ] {
            let url = BaseUrl::parse(raw).unwrap_or_else(|e| panic!("{raw}: {e}"));
            assert_eq!(url.as_str(), normal, "{raw}");
            assert_eq!(url.is_local(), local, "{raw}");
        }
        assert_eq!(
            BaseUrl::parse("http://localhost:11434/v1/")
                .unwrap()
                .join("/chat/completions"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn refuses_what_could_leak_or_mislead() {
        for raw in [
            "",
            "api.mistral.ai/v1",
            "http://api.mistral.ai/v1",
            "http://192.168.1.20:11434/v1",
            "http://0.0.0.0:11434/v1",
            "http://localhost.evil.example/v1",
            "ftp://localhost/v1",
            "file:///etc/passwd",
            "https://user:secret@api.example.com/v1",
            "https://token@api.example.com/v1",
            "https://api.example.com/v1?key=sk-123",
            "https://api.example.com/v1#x",
            "javascript:alert(1)",
        ] {
            let error = BaseUrl::parse(raw).unwrap_err();
            assert_eq!(error.code, ErrorCode::BadRequest, "{raw}");
            assert!(!error.message.contains("secret"), "{raw}");
        }
        let long = format!("https://example.com/{}", "a".repeat(MAX_BASE_URL_CHARS));
        assert!(BaseUrl::parse(&long).is_err());
    }
}
