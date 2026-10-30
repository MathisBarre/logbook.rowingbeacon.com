//! Single-statement lexer (plan 2.2 step 2), the Rust twin of
//! `src/analytics/engine/sqlGuard.ts`: both give the results of
//! `src/analytics/engine/engine-cases.json` (tested on both sides).
//!
//! - Skips `'…'` (with `''`), `"…"` (with `""`), `` `…` `` (with ``` `` ```),
//!   `[…]`, `-- …` and `/* … */`.
//! - A `;` followed by anything but whitespace or comments is
//!   `multiple_statements`; a trailing `;` (and what follows it) is removed.
//! - Unterminated strings, identifiers or comments are `syntax`, with the
//!   offset of their first character.
//! - The first keyword must be SELECT, WITH or VALUES (`not_read_only`).
//! - Named parameters `:name`, `@name`, `$name` are collected (without
//!   prefix, first occurrence order); positional `?` / `?N` are
//!   `invalid_param`.
//!
//! rusqlite's `prepare` silently ignores what follows the first statement,
//! so this check is what turns `SELECT 1; DELETE …` into a clear message
//! (the tail would never run anyway). It is not the security boundary: the
//! read-only connection, `query_only` and the authorizer are.
//!
//! The lexer works on bytes: every delimiter is ASCII, and the bytes of a
//! multi-byte UTF-8 character are all >= 0x80, so they never match one.
//! Offsets are returned in UTF-16 code units (`error::utf16_offset`).

use crate::error::{utf16_offset, AnalyticsError, ErrorCode};

/// A query that passed the lexer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lexed {
    /// The statement without its trailing `;`, end trimmed.
    pub sql: String,
    /// Named parameters, without prefix, in first-occurrence order.
    pub param_names: Vec<String>,
}

const READ_KEYWORDS: [&str; 3] = ["SELECT", "WITH", "VALUES"];

fn is_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
}

fn is_word_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_'
}

fn is_word_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

enum Comment {
    /// Not a comment start.
    None,
    /// Index just after the comment.
    End(usize),
    Unterminated,
}

fn skip_comment(b: &[u8], i: usize) -> Comment {
    if b[i..].starts_with(b"--") {
        return match b[i + 2..].iter().position(|&c| c == b'\n') {
            Some(p) => Comment::End(i + 2 + p + 1),
            None => Comment::End(b.len()),
        };
    }
    if b[i..].starts_with(b"/*") {
        return match b[i + 2..].windows(2).position(|w| w == b"*/") {
            Some(p) => Comment::End(i + 2 + p + 2),
            None => Comment::Unterminated,
        };
    }
    Comment::None
}

fn word_end(b: &[u8], mut j: usize) -> usize {
    while j < b.len() && is_word_char(b[j]) {
        j += 1;
    }
    j
}

/// Checks that `sql` is one read statement and collects its parameters.
pub fn check_sql(sql: &str) -> Result<Lexed, AnalyticsError> {
    let b = sql.as_bytes();
    let fail = |code: ErrorCode, message: &str, at: Option<usize>| {
        let error = AnalyticsError::new(code, message);
        match at {
            Some(byte) => error.with_offset(utf16_offset(sql, byte)),
            None => error,
        }
    };

    let mut param_names: Vec<String> = Vec::new();
    let mut first_keyword: Option<String> = None;
    let mut saw_token = false;
    let mut end = b.len();
    let mut i = 0;

    while i < b.len() {
        let c = b[i];

        if is_space(c) {
            i += 1;
            continue;
        }

        match skip_comment(b, i) {
            Comment::Unterminated => {
                return Err(fail(ErrorCode::Syntax, "Unterminated comment", Some(i)))
            }
            Comment::End(next) => {
                i = next;
                continue;
            }
            Comment::None => {}
        }

        if c == b';' {
            // Only whitespace and comments may follow.
            let mut j = i + 1;
            while j < b.len() {
                if is_space(b[j]) {
                    j += 1;
                    continue;
                }
                match skip_comment(b, j) {
                    Comment::Unterminated => {
                        return Err(fail(ErrorCode::Syntax, "Unterminated comment", Some(j)))
                    }
                    Comment::None => {
                        return Err(fail(
                            ErrorCode::MultipleStatements,
                            "Only one statement is allowed",
                            Some(j),
                        ))
                    }
                    Comment::End(next) => j = next,
                }
            }
            end = i;
            break;
        }

        if !saw_token {
            saw_token = true;
            if is_word_start(c) {
                let j = word_end(b, i);
                first_keyword = Some(sql[i..j].to_ascii_uppercase());
                i = j;
                continue;
            }
            first_keyword = None;
        }

        let closer = match c {
            b'\'' => Some(b'\''),
            b'"' => Some(b'"'),
            b'`' => Some(b'`'),
            b'[' => Some(b']'),
            _ => None,
        };
        if let Some(closer) = closer {
            let mut j = i + 1;
            let mut closed = false;
            while j < b.len() {
                if b[j] == closer {
                    // A doubled quote is an escaped quote (not for […]).
                    if c != b'[' && b.get(j + 1) == Some(&closer) {
                        j += 2;
                        continue;
                    }
                    closed = true;
                    break;
                }
                j += 1;
            }
            if !closed {
                let message = if c == b'\'' {
                    "Unterminated string"
                } else {
                    "Unterminated identifier"
                };
                return Err(fail(ErrorCode::Syntax, message, Some(i)));
            }
            i = j + 1;
            continue;
        }

        if c == b'?' {
            return Err(fail(
                ErrorCode::InvalidParam,
                "Positional parameters are not supported: use :name",
                Some(i),
            ));
        }

        if c == b':' || c == b'@' || c == b'$' {
            let j = i + 1;
            if j < b.len() && is_word_start(b[j]) {
                let k = word_end(b, j);
                let name = &sql[j..k];
                if !param_names.iter().any(|known| known == name) {
                    param_names.push(name.to_string());
                }
                i = k;
                continue;
            }
            i += 1;
            continue;
        }

        if is_word_start(c) {
            // Skip whole words so a "$" or ":" inside one is not a parameter.
            i = word_end(b, i);
            continue;
        }

        i += 1;
    }

    if !saw_token {
        return Err(fail(ErrorCode::Syntax, "The query is empty", None));
    }
    match first_keyword {
        Some(keyword) if READ_KEYWORDS.contains(&keyword.as_str()) => {}
        _ => {
            return Err(fail(
                ErrorCode::NotReadOnly,
                "Only read queries (SELECT, WITH, VALUES) are allowed",
                None,
            ))
        }
    }

    Ok(Lexed {
        sql: sql[..end].trim_end().to_string(),
        param_names,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EngineCase {
        sql: String,
        expect: String,
        param_names: Option<Vec<String>>,
        offset: Option<usize>,
        cleaned: Option<String>,
        #[allow(dead_code)]
        note: Option<String>,
    }

    const CASES: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../src/analytics/engine/engine-cases.json"
    ));

    /// The very cases of the TypeScript guard (`sqlGuard.test.ts`).
    #[test]
    fn matches_every_engine_case() {
        let cases: Vec<EngineCase> = serde_json::from_str(CASES).unwrap();
        assert!(cases.len() >= 40);
        for case in &cases {
            let result = check_sql(&case.sql);
            if case.expect == "ok" {
                let lexed = result.unwrap_or_else(|e| panic!("{:?} → {e}", case.sql));
                if let Some(names) = &case.param_names {
                    assert_eq!(&lexed.param_names, names, "{:?}", case.sql);
                }
                if let Some(cleaned) = &case.cleaned {
                    assert_eq!(&lexed.sql, cleaned, "{:?}", case.sql);
                }
            } else {
                let error = result.expect_err(&case.sql);
                assert_eq!(error.code.as_str(), case.expect, "{:?}", case.sql);
                if let Some(offset) = case.offset {
                    assert_eq!(error.offset, Some(offset), "{:?}", case.sql);
                }
            }
        }
    }

    #[test]
    fn returns_the_text_unchanged_without_semicolon() {
        let sql = "SELECT boat_name\nFROM v_boats -- all\n";
        assert_eq!(
            check_sql(sql).unwrap(),
            Lexed {
                sql: sql.trim_end().to_string(),
                param_names: vec![]
            }
        );
    }

    #[test]
    fn handles_non_ascii_text_and_offsets() {
        let lexed = check_sql("SELECT 'été 🚣' AS x, :saison_été").unwrap();
        // The parameter name stops at the first non-ASCII character.
        assert_eq!(lexed.param_names, vec!["saison_"]);
        let error = check_sql("SELECT '🚣'; DELETE FROM outing").unwrap_err();
        assert_eq!(error.code, ErrorCode::MultipleStatements);
        assert_eq!(error.offset, Some("SELECT '🚣'; ".encode_utf16().count()));
    }

    #[test]
    fn reports_multiple_statements_before_the_keyword_check() {
        let error = check_sql("DELETE FROM outing; SELECT 1").unwrap_err();
        assert_eq!(error.code, ErrorCode::MultipleStatements);
        let error = check_sql("SELECT 1; /* a */ -- b\n /* c").unwrap_err();
        assert_eq!(error.code, ErrorCode::Syntax);
    }
}
