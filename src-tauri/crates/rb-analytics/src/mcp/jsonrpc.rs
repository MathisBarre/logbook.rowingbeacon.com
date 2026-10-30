//! JSON-RPC 2.0 framing of the MCP stdio transport: one message per line,
//! no embedded newlines (`serde_json` escapes them), UTF-8.

use serde_json::{json, Map, Value};

pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;
/// MCP 2026-07-28 `UnsupportedProtocolVersion`.
pub const UNSUPPORTED_PROTOCOL_VERSION: i64 = -32022;

/// One incoming message.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Request {
        id: Value,
        method: String,
        params: Map<String, Value>,
    },
    Notification {
        method: String,
        params: Map<String, Value>,
    },
    /// A response from the client: the server never sends requests, so
    /// these are ignored.
    Response,
    /// Not a valid message: answer with this error (id may be null).
    Invalid(Value),
}

pub fn error_response(
    id: Value,
    code: i64,
    message: impl Into<String>,
    data: Option<Value>,
) -> Value {
    let mut error = json!({ "code": code, "message": message.into() });
    if let Some(data) = data {
        error["data"] = data;
    }
    json!({ "jsonrpc": "2.0", "id": id, "error": error })
}

pub fn result_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

/// A key that tells `1` from `"1"` (cancellation bookkeeping).
pub fn id_key(id: &Value) -> String {
    id.to_string()
}

/// Classifies one parsed JSON value (an element of a batch, or a line).
pub fn classify(value: Value) -> Incoming {
    let Value::Object(mut message) = value else {
        return Incoming::Invalid(error_response(
            Value::Null,
            INVALID_REQUEST,
            "A JSON-RPC message is an object",
            None,
        ));
    };
    let id = message.remove("id");
    let reply_id = id.clone().unwrap_or(Value::Null);
    if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Incoming::Invalid(error_response(
            reply_id,
            INVALID_REQUEST,
            "jsonrpc must be \"2.0\"",
            None,
        ));
    }
    let method = match message.remove("method") {
        Some(Value::String(method)) => method,
        Some(_) => {
            return Incoming::Invalid(error_response(
                reply_id,
                INVALID_REQUEST,
                "method must be a string",
                None,
            ))
        }
        None if message.contains_key("result") || message.contains_key("error") => {
            return Incoming::Response
        }
        None => {
            return Incoming::Invalid(error_response(
                reply_id,
                INVALID_REQUEST,
                "method is missing",
                None,
            ))
        }
    };
    let params = match message.remove("params") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(params)) => params,
        Some(_) => {
            // MCP params are always an object.
            return match id {
                Some(id) => Incoming::Invalid(error_response(
                    id,
                    INVALID_PARAMS,
                    "params must be an object",
                    None,
                )),
                None => Incoming::Notification {
                    method,
                    params: Map::new(),
                },
            };
        }
    };
    match id {
        None => Incoming::Notification { method, params },
        Some(id @ (Value::String(_) | Value::Number(_))) => {
            if id.as_number().is_some_and(|n| !(n.is_i64() || n.is_u64())) {
                return Incoming::Invalid(error_response(
                    id,
                    INVALID_REQUEST,
                    "id must be a string or an integer",
                    None,
                ));
            }
            Incoming::Request { id, method, params }
        }
        Some(_) => Incoming::Invalid(error_response(
            Value::Null,
            INVALID_REQUEST,
            "id must be a string or an integer (not null)",
            None,
        )),
    }
}

/// The parsed content of one line: a message or a batch (arrays were
/// allowed by MCP 2025-03-26 only, and are still answered).
pub enum Line {
    Single(Value),
    Batch(Vec<Value>),
    /// Not JSON: answer `-32700` with a null id.
    ParseError(Value),
    Empty,
}

pub fn parse_line(line: &str) -> Line {
    let trimmed = line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if trimmed.is_empty() {
        return Line::Empty;
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Array(items)) => Line::Batch(items),
        Ok(value) => Line::Single(value),
        Err(error) => Line::ParseError(error_response(
            Value::Null,
            PARSE_ERROR,
            format!("Parse error: {error}"),
            None,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_messages() {
        let request = classify(json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }));
        assert_eq!(
            request,
            Incoming::Request {
                id: json!(1),
                method: "ping".into(),
                params: Map::new()
            }
        );
        let note = classify(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        assert!(matches!(note, Incoming::Notification { .. }));
        assert_eq!(
            classify(json!({ "jsonrpc": "2.0", "id": 4, "result": {} })),
            Incoming::Response
        );
        for (bad, code) in [
            (json!([1]), INVALID_REQUEST),
            (json!({ "id": 1, "method": "ping" }), INVALID_REQUEST),
            (
                json!({ "jsonrpc": "2.0", "id": null, "method": "ping" }),
                INVALID_REQUEST,
            ),
            (
                json!({ "jsonrpc": "2.0", "id": 1.5, "method": "ping" }),
                INVALID_REQUEST,
            ),
            (
                json!({ "jsonrpc": "2.0", "id": 1, "method": 3 }),
                INVALID_REQUEST,
            ),
            (json!({ "jsonrpc": "2.0", "id": 1 }), INVALID_REQUEST),
            (
                json!({ "jsonrpc": "2.0", "id": 1, "method": "x", "params": [1] }),
                INVALID_PARAMS,
            ),
        ] {
            match classify(bad.clone()) {
                Incoming::Invalid(response) => assert_eq!(response["error"]["code"], code, "{bad}"),
                other => panic!("{bad}: {other:?}"),
            }
        }
    }

    #[test]
    fn parses_lines() {
        assert!(matches!(parse_line("  \r"), Line::Empty));
        assert!(matches!(parse_line("{\"a\":1}\r"), Line::Single(_)));
        assert!(matches!(parse_line("\u{feff}{}"), Line::Single(_)));
        assert!(matches!(parse_line("[{}]"), Line::Batch(_)));
        match parse_line("{oops") {
            Line::ParseError(response) => {
                assert_eq!(response["error"]["code"], PARSE_ERROR);
                assert_eq!(response["id"], Value::Null);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn serialized_messages_have_no_newline() {
        let response = result_response(json!(1), json!({ "text": "a\nb\r\nc" }));
        assert!(!serde_json::to_string(&response).unwrap().contains('\n'));
        assert_eq!(id_key(&json!(1)), "1");
        assert_eq!(id_key(&json!("1")), "\"1\"");
    }
}
