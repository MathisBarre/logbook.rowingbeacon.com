//! MCP methods, both eras (plan 2.12, checked against the 2026-07-28 and
//! 2025-11-25 specifications on 2026-10-29).
//!
//! - Legacy clients (2025-11-25 and before) send `initialize`, then
//!   `notifications/initialized`, `tools/list`, `tools/call`, `ping`.
//! - Modern clients (2026-07-28) are stateless: every request carries
//!   `_meta["io.modelcontextprotocol/protocolVersion"]` and
//!   `_meta["io.modelcontextprotocol/clientCapabilities"]`; they may probe
//!   with `server/discover`. Modern results carry `resultType: "complete"`
//!   and the server identity in `_meta`.
//!
//! The era is decided per request: `initialize` is legacy, a request with
//! the modern `_meta` version is modern, anything else is legacy and needs
//! a prior `initialize` (except `ping`). A probe from a modern client
//! therefore never gets a legacy answer, and a legacy client never sees
//! modern fields.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Map, Value};

use super::jsonrpc::{
    self, classify, error_response, id_key, notification, parse_line, result_response, Incoming,
    Line, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, UNSUPPORTED_PROTOCOL_VERSION,
};
use super::tools::{instructions, tool_definitions, CallContext, Tools};

pub const MODERN_VERSION: &str = "2026-07-28";
/// Versions answered to `initialize`, newest first.
pub const LEGACY_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
pub const SERVER_NAME: &str = "rowing-beacon";
pub const SERVER_TITLE: &str = "Rowing Beacon";

pub const META_PROTOCOL_VERSION: &str = "io.modelcontextprotocol/protocolVersion";
pub const META_CLIENT_CAPABILITIES: &str = "io.modelcontextprotocol/clientCapabilities";
pub const META_CLIENT_INFO: &str = "io.modelcontextprotocol/clientInfo";
pub const META_SERVER_INFO: &str = "io.modelcontextprotocol/serverInfo";
pub const META_SUBSCRIPTION_ID: &str = "io.modelcontextprotocol/subscriptionId";

const TAURI_CONF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tauri.conf.json"
));

/// Every version this server speaks, for `server/discover` and `-32022`.
pub fn supported_versions() -> Vec<&'static str> {
    let mut versions = vec![MODERN_VERSION];
    versions.extend(LEGACY_VERSIONS);
    versions
}

/// The app version (`tauri.conf.json`), so a client sees which Rowing
/// Beacon it talks to.
pub fn server_version() -> &'static str {
    static VERSION: OnceLock<String> = OnceLock::new();
    VERSION.get_or_init(|| {
        serde_json::from_str::<Value>(TAURI_CONF)
            .ok()
            .and_then(|conf| {
                conf.get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
    })
}

pub fn server_info() -> Value {
    json!({ "name": SERVER_NAME, "title": SERVER_TITLE, "version": server_version() })
}

fn capabilities() -> Value {
    json!({ "tools": { "listChanged": false } })
}

/// The JSON-RPC id of a request as the engine request id (cancellation).
pub fn engine_request_id(id: &Value) -> String {
    format!("mcp:{}", id_key(id))
}

/// Ids named by `notifications/cancelled`, shared with the reader thread,
/// which records them (and stops the engine) while a request runs.
#[derive(Debug, Default)]
pub struct Cancellations {
    ids: Mutex<HashSet<String>>,
}

impl Cancellations {
    /// Records a cancelled request id; returns its key.
    pub fn record(&self, id: &Value) -> String {
        let key = id_key(id);
        if let Ok(mut ids) = self.ids.lock() {
            // Ids of requests already answered are removed when the
            // notification itself is handled; this only guards against a
            // client cancelling unknown ids in a loop.
            if ids.len() >= 10_000 {
                ids.clear();
            }
            ids.insert(key.clone());
        }
        key
    }

    pub fn is_cancelled(&self, id: &Value) -> bool {
        self.ids
            .lock()
            .map(|ids| ids.contains(&id_key(id)))
            .unwrap_or(false)
    }

    fn forget(&self, key: &str) {
        if let Ok(mut ids) = self.ids.lock() {
            ids.remove(key);
        }
    }
}

/// The `requestId` of a `notifications/cancelled`, if well formed.
pub fn cancelled_request_id(message: &Value) -> Option<&Value> {
    if message.get("method").and_then(Value::as_str) != Some("notifications/cancelled")
        || message.get("id").is_some()
    {
        return None;
    }
    message
        .get("params")?
        .get("requestId")
        .filter(|id| id.is_string() || id.as_i64().is_some() || id.as_u64().is_some())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacySession {
    version: String,
    client: Option<String>,
}

/// How a request is to be answered.
enum Era {
    Legacy,
    Modern { client: Option<String> },
}

/// One MCP server: its tools and the legacy session, if any.
pub struct Server {
    tools: Tools,
    legacy: Option<LegacySession>,
    /// Open `subscriptions/listen` requests (id keys).
    listening: HashSet<String>,
    cancellations: std::sync::Arc<Cancellations>,
}

impl Server {
    pub fn new(tools: Tools, cancellations: std::sync::Arc<Cancellations>) -> Self {
        Server {
            tools,
            legacy: None,
            listening: HashSet::new(),
            cancellations,
        }
    }

    pub fn tools(&self) -> &Tools {
        &self.tools
    }

    /// The negotiated legacy version, once `initialize` was answered.
    pub fn legacy_version(&self) -> Option<&str> {
        self.legacy.as_ref().map(|s| s.version.as_str())
    }

    /// Handles one line of input; returns the messages to write, in order
    /// (none for notifications and cancelled requests).
    pub fn handle_line(&mut self, line: &str) -> Vec<Value> {
        match parse_line(line) {
            Line::Empty => Vec::new(),
            Line::ParseError(response) => vec![response],
            Line::Single(value) => self.handle_value(value),
            Line::Batch(items) => {
                if items.is_empty() {
                    return vec![error_response(
                        Value::Null,
                        INVALID_REQUEST,
                        "Empty batch",
                        None,
                    )];
                }
                let replies: Vec<Value> = items
                    .into_iter()
                    .flat_map(|item| self.handle_value(item))
                    .collect();
                if replies.is_empty() {
                    Vec::new()
                } else {
                    vec![Value::Array(replies)]
                }
            }
        }
    }

    /// Handles one parsed message.
    pub fn handle_value(&mut self, value: Value) -> Vec<Value> {
        match classify(value) {
            Incoming::Invalid(response) => vec![response],
            Incoming::Response => Vec::new(),
            Incoming::Notification { method, params } => {
                self.handle_notification(&method, &params);
                Vec::new()
            }
            Incoming::Request { id, method, params } => {
                if self.cancellations.is_cancelled(&id) {
                    // Cancelled before it started: no answer at all.
                    return Vec::new();
                }
                let replies = self.handle_request(&id, &method, &params);
                if self.cancellations.is_cancelled(&id) {
                    Vec::new()
                } else {
                    replies
                }
            }
        }
    }

    fn handle_notification(&mut self, method: &str, params: &Map<String, Value>) {
        // `notifications/initialized`, progress, roots changes...: nothing
        // to do; unknown notifications are ignored.
        if method != "notifications/cancelled" {
            return;
        }
        if let Some(id) = params.get("requestId") {
            let key = id_key(id);
            // The request came before this notification on the same
            // stream, so it has been handled by now.
            self.cancellations.forget(&key);
            self.listening.remove(&key);
        }
    }

    fn handle_request(
        &mut self,
        id: &Value,
        method: &str,
        params: &Map<String, Value>,
    ) -> Vec<Value> {
        if method == "initialize" {
            return vec![self.initialize(id, params)];
        }
        let era = match self.era(params) {
            Ok(era) => era,
            Err(error) => return vec![error.into_response(id.clone())],
        };
        match era {
            Era::Legacy => vec![self.legacy_request(id, method, params)],
            Era::Modern { client } => self.modern_request(id, method, params, client),
        }
    }

    fn era(&self, params: &Map<String, Value>) -> Result<Era, RpcError> {
        let meta = params.get("_meta").and_then(Value::as_object);
        let Some(version) = meta.and_then(|m| m.get(META_PROTOCOL_VERSION)) else {
            return Ok(Era::Legacy);
        };
        let meta = meta.expect("checked above");
        match version.as_str() {
            Some(MODERN_VERSION) => {}
            Some(requested) => {
                return Err(RpcError::with_data(
                    UNSUPPORTED_PROTOCOL_VERSION,
                    "Unsupported protocol version",
                    json!({ "supported": supported_versions(), "requested": requested }),
                ))
            }
            None => {
                return Err(RpcError::new(
                    INVALID_PARAMS,
                    format!("_meta[\"{META_PROTOCOL_VERSION}\"] must be a string"),
                ))
            }
        }
        if !meta
            .get(META_CLIENT_CAPABILITIES)
            .is_some_and(Value::is_object)
        {
            return Err(RpcError::new(
                INVALID_PARAMS,
                format!("_meta[\"{META_CLIENT_CAPABILITIES}\"] is required (an object)"),
            ));
        }
        Ok(Era::Modern {
            client: meta.get(META_CLIENT_INFO).and_then(client_label),
        })
    }

    // ------------------------------------------------------------- legacy

    fn initialize(&mut self, id: &Value, params: &Map<String, Value>) -> Value {
        let requested = match params.get("protocolVersion") {
            Some(Value::String(version)) => version.as_str(),
            _ => {
                return error_response(
                    id.clone(),
                    INVALID_PARAMS,
                    "initialize needs a protocolVersion (a string)",
                    Some(json!({ "supported": supported_versions() })),
                )
            }
        };
        let version = LEGACY_VERSIONS
            .iter()
            .find(|v| **v == requested)
            .copied()
            .unwrap_or(LEGACY_VERSIONS[0]);
        self.legacy = Some(LegacySession {
            version: version.to_string(),
            client: params.get("clientInfo").and_then(client_label),
        });
        let mut info = server_info();
        if version < "2025-06-18" {
            // `title` came with 2025-06-18.
            if let Some(info) = info.as_object_mut() {
                info.remove("title");
            }
        }
        result_response(
            id.clone(),
            json!({
                "protocolVersion": version,
                "capabilities": capabilities(),
                "serverInfo": info,
                "instructions": instructions(self.tools.privacy_hint()),
            }),
        )
    }

    fn legacy_request(&mut self, id: &Value, method: &str, params: &Map<String, Value>) -> Value {
        if method == "ping" {
            return result_response(id.clone(), json!({}));
        }
        let Some(session) = self.legacy.clone() else {
            if is_known_method(method) {
                return error_response(
                    id.clone(),
                    INVALID_PARAMS,
                    format!(
                        "Send initialize first (legacy clients), or the _meta \"{META_PROTOCOL_VERSION}\" \
                         \"{MODERN_VERSION}\" with each request (modern clients)"
                    ),
                    Some(json!({ "supported": supported_versions() })),
                );
            }
            return method_not_found(id, method);
        };
        match method {
            "tools/list" => result_response(id.clone(), self.list_tools(&session.version)),
            "tools/call" => match self.call_tool(id, params, session.client) {
                Ok(result) => result_response(id.clone(), result),
                Err(error) => error.into_response(id.clone()),
            },
            _ => method_not_found(id, method),
        }
    }

    fn list_tools(&self, version: &str) -> Value {
        let mut tools = tool_definitions();
        if version < "2025-06-18" {
            // Before 2025-06-18: no `title`, no `outputSchema`.
            if let Some(list) = tools.as_array_mut() {
                for tool in list.iter_mut().filter_map(Value::as_object_mut) {
                    tool.remove("title");
                    tool.remove("outputSchema");
                }
            }
        }
        if version < "2025-03-26" {
            // Annotations came with 2025-03-26.
            if let Some(list) = tools.as_array_mut() {
                for tool in list.iter_mut().filter_map(Value::as_object_mut) {
                    tool.remove("annotations");
                }
            }
        }
        json!({ "tools": tools })
    }

    /// `tools/call`: protocol errors for a malformed request or an unknown
    /// tool, a result with `isError` for everything the tool reports.
    fn call_tool(
        &self,
        id: &Value,
        params: &Map<String, Value>,
        client: Option<String>,
    ) -> Result<Value, RpcError> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new(INVALID_PARAMS, "tools/call needs a tool name"))?;
        let empty = Map::new();
        let args = match params.get("arguments") {
            None | Some(Value::Null) => &empty,
            Some(Value::Object(args)) => args,
            Some(_) => return Err(RpcError::new(INVALID_PARAMS, "arguments must be an object")),
        };
        let call = CallContext {
            client,
            request_id: engine_request_id(id),
        };
        let started = std::time::Instant::now();
        let outcome = self
            .tools
            .call(name, args, &call)
            .ok_or_else(|| RpcError::new(INVALID_PARAMS, format!("Unknown tool: {name}")))?;
        // Lets the settings show that an AI app is connected.
        self.tools.record_call(call.client.as_deref());
        super::log(&format!(
            "tools/call {name}: {} in {} ms",
            if outcome.is_error { "error" } else { "ok" },
            started.elapsed().as_millis()
        ));
        Ok(outcome.to_result())
    }

    // ------------------------------------------------------------- modern

    fn modern_request(
        &mut self,
        id: &Value,
        method: &str,
        params: &Map<String, Value>,
        client: Option<String>,
    ) -> Vec<Value> {
        let result = match method {
            "server/discover" => Ok(json!({
                "supportedVersions": supported_versions(),
                "capabilities": capabilities(),
                "instructions": instructions(self.tools.privacy_hint()),
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(self.list_tools(MODERN_VERSION)),
            "tools/call" => self.call_tool(id, params, client),
            "subscriptions/listen" => {
                // Nothing here ever changes (`listChanged: false`): the
                // acknowledgement grants no notification, and the request
                // stays open until the client cancels it.
                self.listening.insert(id_key(id));
                return vec![notification(
                    "notifications/subscriptions/acknowledged",
                    json!({ "_meta": { META_SUBSCRIPTION_ID: id }, "notifications": {} }),
                )];
            }
            _ => Err(RpcError::new(
                METHOD_NOT_FOUND,
                format!("Method not found: {method}"),
            )),
        };
        match result {
            Ok(mut result) => {
                if let Some(object) = result.as_object_mut() {
                    object.insert("resultType".into(), json!("complete"));
                    let meta = object.entry("_meta").or_insert_with(|| json!({}));
                    if let Some(meta) = meta.as_object_mut() {
                        meta.insert(META_SERVER_INFO.into(), server_info());
                    }
                }
                vec![result_response(id.clone(), result)]
            }
            Err(error) => vec![error.into_response(id.clone())],
        }
    }
}

fn is_known_method(method: &str) -> bool {
    matches!(
        method,
        "tools/list" | "tools/call" | "server/discover" | "subscriptions/listen"
    )
}

fn method_not_found(id: &Value, method: &str) -> Value {
    error_response(
        id.clone(),
        METHOD_NOT_FOUND,
        format!("Method not found: {method}"),
        None,
    )
}

/// `clientInfo.name` (e.g. "claude-ai"), for the proposals' `client`.
fn client_label(info: &Value) -> Option<String> {
    let name: String = info
        .get("name")?
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect();
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

struct RpcError {
    code: i64,
    message: String,
    data: Option<Value>,
}

impl RpcError {
    fn new(code: i64, message: impl Into<String>) -> Self {
        RpcError {
            code,
            message: message.into(),
            data: None,
        }
    }

    fn with_data(code: i64, message: impl Into<String>, data: Value) -> Self {
        RpcError {
            code,
            message: message.into(),
            data: Some(data),
        }
    }

    fn into_response(self, id: Value) -> Value {
        jsonrpc::error_response(id, self.code, self.message, self.data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_app_version() {
        let conf: Value = serde_json::from_str(TAURI_CONF).unwrap();
        assert_eq!(server_version(), conf["version"].as_str().unwrap());
        assert_eq!(server_info()["name"], "rowing-beacon");
    }

    #[test]
    fn versions_are_newest_first_and_comparable() {
        let versions = supported_versions();
        assert_eq!(versions[0], MODERN_VERSION);
        assert!(versions.windows(2).all(|w| w[0] > w[1]));
    }

    #[test]
    fn labels_clients() {
        assert_eq!(
            client_label(&json!({ "name": "claude-ai", "version": "0.1.0" })).as_deref(),
            Some("claude-ai")
        );
        assert_eq!(
            client_label(&json!({ "name": "x\n" })).as_deref(),
            Some("x")
        );
        assert_eq!(client_label(&json!({ "name": " " })), None);
        assert_eq!(client_label(&json!({ "version": "1" })), None);
    }

    #[test]
    fn finds_cancelled_ids() {
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 7 } });
        assert_eq!(cancelled_request_id(&note), Some(&json!(7)));
        let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "notifications/cancelled", "params": { "requestId": 7 } });
        assert_eq!(cancelled_request_id(&request), None);
        let bad = json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": null } });
        assert_eq!(cancelled_request_id(&bad), None);
        assert_eq!(engine_request_id(&json!("a")), "mcp:\"a\"");
        assert_eq!(engine_request_id(&json!(3)), "mcp:3");
    }
}
