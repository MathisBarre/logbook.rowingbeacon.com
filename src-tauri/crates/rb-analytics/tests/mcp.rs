//! MCP server acceptance tests (plan section 3, WP2): scripted JSON-RPC
//! sessions for both protocol eras, the five tools, the proposals inbox,
//! cancellation, and the `rb-mcp` binary over real stdio pipes.
//!
//! Protocol tests use a fake `QueryRunner`; tool tests also run the real
//! engine on the test club of `support` (WP1), so privacy and the
//! read-only guarantee are checked end to end.

mod support;

use std::collections::BTreeSet;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde_json::{json, Value};

use rb_analytics::engine::EngineContext;
use rb_analytics::error::AnalyticsError;
use rb_analytics::ipc::{EngineObjects, Privacy, QueryResult, ResultColumn, RunQueryRequest};
use rb_analytics::mcp::tools::{
    EngineRunner, QueryRunner, ToolEnv, DISABLED_MESSAGE, PROPOSAL_SAVED_MESSAGE,
};
use rb_analytics::mcp::{inbox_list, inbox_remove, serve_with};

use support::TestDb;

const NOW: &str = support::NOW;
const MODERN: &str = "2026-07-28";

// ------------------------------------------------------------------ doubles

/// Records every request; answers one row whose columns are the
/// `AS <name>` aliases of the SQL (or `value`). SQL containing `SLOW`
/// blocks until cancelled (or 10 s); `FAIL` fails like the engine.
#[derive(Default)]
struct FakeRunner {
    requests: Mutex<Vec<RunQueryRequest>>,
    cancelled: Mutex<Vec<String>>,
    started: Mutex<Option<mpsc::Sender<String>>>,
}

impl FakeRunner {
    fn requests(&self) -> Vec<RunQueryRequest> {
        self.requests.lock().unwrap().clone()
    }

    fn cancelled(&self) -> Vec<String> {
        self.cancelled.lock().unwrap().clone()
    }
}

fn aliases(sql: &str) -> Vec<String> {
    let words: Vec<&str> = sql.split_whitespace().collect();
    let mut names: Vec<String> = words
        .windows(2)
        .filter(|w| w[0].eq_ignore_ascii_case("AS"))
        .map(|w| {
            w[1].trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .to_string()
        })
        .collect();
    if names.is_empty() {
        names.push("value".into());
    }
    names
}

impl QueryRunner for FakeRunner {
    fn run(
        &self,
        _ctx: &EngineContext,
        req: &RunQueryRequest,
    ) -> Result<QueryResult, AnalyticsError> {
        self.requests.lock().unwrap().push(req.clone());
        if req.sql.contains("FAIL") {
            return Err(AnalyticsError::new(
                rb_analytics::error::ErrorCode::Syntax,
                "near \"FAIL\": syntax error",
            ));
        }
        if req.sql.contains("SLOW") {
            if let Some(started) = self.started.lock().unwrap().as_ref() {
                let _ = started.send(req.request_id.clone());
            }
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if self.cancelled.lock().unwrap().contains(&req.request_id) {
                    return Err(AnalyticsError::new(
                        rb_analytics::error::ErrorCode::Cancelled,
                        "cancelled",
                    ));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        let columns: Vec<ResultColumn> = aliases(&req.sql)
            .into_iter()
            .map(|name| ResultColumn {
                name,
                decl_type: None,
            })
            .collect();
        let rows = vec![columns.iter().map(|_| json!(1)).collect()];
        Ok(QueryResult {
            columns,
            rows,
            truncated: false,
            elapsed_ms: 1,
            ignored_columns: Vec::new(),
            cached: false,
        })
    }

    fn objects(&self, _ctx: &EngineContext) -> Result<EngineObjects, AnalyticsError> {
        let dictionary = rb_analytics::assets::Dictionary::load();
        let mut objects = EngineObjects::default();
        for object in &dictionary.objects {
            match object.kind {
                rb_analytics::assets::ObjectKind::View => objects.views.push(object.name.clone()),
                rb_analytics::assets::ObjectKind::Table => objects.tables.push(object.name.clone()),
            }
        }
        Ok(objects)
    }

    fn cancel(&self, request_id: &str) {
        self.cancelled.lock().unwrap().push(request_id.to_string());
    }

    fn cancel_all(&self) {
        let ids: Vec<String> = self
            .requests()
            .into_iter()
            .map(|req| req.request_id)
            .collect();
        self.cancelled.lock().unwrap().extend(ids);
    }
}

// ------------------------------------------------------------------ helpers

/// A minimal `main.db`: only the `setting` table (JSON values).
fn settings_db(dir: &Path, settings: &[(&str, &str)]) -> PathBuf {
    let path = dir.join("main.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    )
    .unwrap();
    for (key, value) in settings {
        set(&conn, key, value);
    }
    path
}

fn set(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .unwrap();
}

fn env(db_path: PathBuf, inbox_dir: PathBuf) -> ToolEnv {
    ToolEnv {
        db_path,
        inbox_dir,
        now_override: Some(NOW.to_string()),
    }
}

/// Runs a scripted session (one line per entry) and returns the lines
/// written, each checked to be one JSON-RPC 2.0 message (or a batch).
fn session(env: ToolEnv, runner: Arc<dyn QueryRunner>, lines: &[String]) -> Vec<Value> {
    let mut input = lines.join("\n");
    input.push('\n');
    let mut output = Vec::new();
    serve_with(
        io::Cursor::new(input.into_bytes()),
        &mut output,
        env,
        runner,
    )
    .unwrap();
    parse_output(&output)
}

fn parse_output(output: &[u8]) -> Vec<Value> {
    let text = std::str::from_utf8(output).expect("stdout is UTF-8");
    assert!(
        text.is_empty() || text.ends_with('\n'),
        "every message ends with a newline"
    );
    text.lines()
        .map(|line| {
            let value: Value = serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("stdout line is not JSON ({e}): {line}"));
            let messages = match &value {
                Value::Array(items) => items.clone(),
                other => vec![other.clone()],
            };
            for message in messages {
                assert_eq!(message["jsonrpc"], "2.0", "{line}");
                assert!(
                    message.get("result").is_some() != message.get("error").is_some()
                        || message.get("method").is_some(),
                    "{line}"
                );
            }
            value
        })
        .collect()
}

fn line(value: Value) -> String {
    serde_json::to_string(&value).unwrap()
}

fn initialize(id: i64, version: &str) -> String {
    line(json!({
        "jsonrpc": "2.0", "id": id, "method": "initialize",
        "params": {
            "protocolVersion": version,
            "capabilities": {},
            "clientInfo": { "name": "test-client", "version": "1.0" }
        }
    }))
}

fn initialized() -> String {
    line(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
}

fn legacy(id: i64, method: &str, params: Value) -> String {
    line(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
}

fn modern_meta() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { "name": "modern-client", "version": "2" }
    })
}

fn modern(id: i64, method: &str, mut params: Value) -> String {
    params["_meta"] = modern_meta();
    line(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
}

fn call(name: &str, arguments: Value) -> Value {
    json!({ "name": name, "arguments": arguments })
}

fn by_id(replies: &[Value], id: i64) -> &Value {
    replies
        .iter()
        .find(|r| r["id"] == json!(id))
        .unwrap_or_else(|| panic!("no reply for id {id} in {replies:#?}"))
}

/// The tool result of a reply: (text, structuredContent, isError).
fn tool_result(reply: &Value) -> (String, Value, bool) {
    let result = &reply["result"];
    assert!(result.is_object(), "not a result: {reply}");
    let content = result["content"].as_array().expect("content");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"], "text");
    (
        content[0]["text"].as_str().unwrap().to_string(),
        result
            .get("structuredContent")
            .cloned()
            .unwrap_or(Value::Null),
        result["isError"].as_bool().expect("isError"),
    )
}

fn enabled_env(dir: &tempfile::TempDir) -> ToolEnv {
    let db = settings_db(dir.path(), &[("analytics.mcp.enabled", "true")]);
    env(db, dir.path().join("inbox"))
}

fn fake() -> Arc<FakeRunner> {
    Arc::new(FakeRunner::default())
}

// ------------------------------------------------------- legacy protocol

#[test]
fn legacy_session_initialize_list_and_call() {
    let dir = tempfile::tempdir().unwrap();
    let replies = session(
        enabled_env(&dir),
        fake(),
        &[
            initialize(1, "2025-06-18"),
            initialized(),
            legacy(2, "tools/list", json!({})),
            legacy(3, "tools/call", call("get_schema", json!({}))),
            legacy(4, "ping", json!({})),
        ],
    );
    assert_eq!(
        replies.len(),
        4,
        "the notification gets no reply: {replies:#?}"
    );

    let init = &by_id(&replies, 1)["result"];
    assert_eq!(init["protocolVersion"], "2025-06-18");
    assert_eq!(
        init["capabilities"],
        json!({ "tools": { "listChanged": false } })
    );
    assert_eq!(init["serverInfo"]["name"], "rowing-beacon");
    assert!(init["serverInfo"]["version"]
        .as_str()
        .unwrap()
        .contains('.'));
    let instructions = init["instructions"].as_str().unwrap();
    assert!(instructions.contains("get_schema"), "{instructions}");
    assert!(instructions.contains("pseudonymised"), "{instructions}");
    assert!(
        init.get("resultType").is_none(),
        "no modern fields for legacy clients"
    );

    let tools = by_id(&replies, 2)["result"]["tools"]
        .as_array()
        .unwrap()
        .clone();
    let names: BTreeSet<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        BTreeSet::from([
            "get_schema",
            "list_reports",
            "run_report",
            "run_query",
            "propose_chart"
        ])
    );
    for tool in &tools {
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false, "{tool}");
        assert!(tool["description"].as_str().unwrap().len() > 40, "{tool}");
        assert_eq!(
            tool["annotations"]["readOnlyHint"],
            tool["name"] != "propose_chart",
            "{tool}"
        );
    }
    assert!(by_id(&replies, 2)["result"].get("nextCursor").is_none());

    let (text, schema, is_error) = tool_result(by_id(&replies, 3));
    assert!(!is_error, "{text}");
    assert_eq!(schema["privacy"], "pseudonymised");
    assert_eq!(schema["season_start_month"], 8);
    assert_eq!(schema["today"], &NOW[..10]);
    assert_eq!(schema["current_season"], support::CURRENT_SEASON);
    assert!(text.contains("v_outings"), "{text}");

    assert_eq!(by_id(&replies, 4)["result"], json!({}));
}

#[test]
fn legacy_versions_are_negotiated() {
    let dir = tempfile::tempdir().unwrap();
    for (asked, answered) in [
        ("2025-11-25", "2025-11-25"),
        ("2025-06-18", "2025-06-18"),
        ("2025-03-26", "2025-03-26"),
        ("2024-11-05", "2024-11-05"),
        ("2099-01-01", "2025-11-25"),
        ("1.0", "2025-11-25"),
    ] {
        let replies = session(enabled_env(&dir), fake(), &[initialize(1, asked)]);
        assert_eq!(replies[0]["result"]["protocolVersion"], answered, "{asked}");
    }
    // 2024-11-05 predates tool titles and annotations.
    let replies = session(
        enabled_env(&dir),
        fake(),
        &[
            initialize(1, "2024-11-05"),
            legacy(2, "tools/list", json!({})),
        ],
    );
    let tool = &by_id(&replies, 2)["result"]["tools"][0];
    assert!(
        tool.get("annotations").is_none() && tool.get("title").is_none(),
        "{tool}"
    );
    assert!(by_id(&replies, 1)["result"]["serverInfo"]
        .get("title")
        .is_none());
}

#[test]
fn legacy_requests_need_initialize_first() {
    let dir = tempfile::tempdir().unwrap();
    let replies = session(
        enabled_env(&dir),
        fake(),
        &[
            legacy(1, "tools/list", json!({})),
            legacy(2, "ping", json!({})),
            legacy(3, "initialize", json!({})),
        ],
    );
    assert_eq!(by_id(&replies, 1)["error"]["code"], -32602);
    assert_eq!(
        by_id(&replies, 2)["result"],
        json!({}),
        "ping works at any time"
    );
    assert_eq!(
        by_id(&replies, 3)["error"]["code"],
        -32602,
        "protocolVersion is required"
    );
}

#[test]
fn errors_of_the_json_rpc_layer() {
    let dir = tempfile::tempdir().unwrap();
    let replies = session(
        enabled_env(&dir),
        fake(),
        &[
            "{not json".to_string(),
            "".to_string(),
            initialize(1, "2025-11-25"),
            legacy(2, "resources/list", json!({})),
            legacy(3, "tools/call", call("drop_table", json!({}))),
            legacy(4, "tools/call", json!({ "arguments": {} })),
            legacy(
                5,
                "tools/call",
                json!({ "name": "run_query", "arguments": [1] }),
            ),
            line(json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/list", "params": [] })),
            line(json!({ "jsonrpc": "1.0", "id": 7, "method": "ping" })),
            line(json!({ "jsonrpc": "2.0", "method": "notifications/whatever", "params": {} })),
            line(json!({ "jsonrpc": "2.0", "id": 99, "result": {} })),
            "[]".to_string(),
            line(json!([
                { "jsonrpc": "2.0", "id": 8, "method": "ping" },
                { "jsonrpc": "2.0", "method": "notifications/initialized" },
                { "jsonrpc": "2.0", "id": 9, "method": "nope" }
            ])),
        ],
    );
    assert_eq!(replies[0]["error"]["code"], -32700);
    assert_eq!(replies[0]["id"], Value::Null);
    assert_eq!(by_id(&replies, 2)["error"]["code"], -32601);
    let unknown = &by_id(&replies, 3)["error"];
    assert_eq!(unknown["code"], -32602);
    assert_eq!(unknown["message"], "Unknown tool: drop_table");
    assert_eq!(by_id(&replies, 4)["error"]["code"], -32602);
    assert_eq!(by_id(&replies, 5)["error"]["code"], -32602);
    assert_eq!(by_id(&replies, 6)["error"]["code"], -32602);
    assert_eq!(by_id(&replies, 7)["error"]["code"], -32600);
    // Notifications and client responses get nothing; an empty batch is
    // an invalid request; a batch is answered with an array.
    let empty_batch = replies
        .iter()
        .find(|r| r["error"]["code"] == -32600 && r["id"].is_null())
        .expect("empty batch error");
    assert_eq!(empty_batch["error"]["message"], "Empty batch");
    let batch = replies
        .last()
        .unwrap()
        .as_array()
        .expect("batch reply")
        .clone();
    assert_eq!(batch.len(), 2);
    assert_eq!(batch[0]["result"], json!({}));
    assert_eq!(batch[1]["error"]["code"], -32601);
    assert_eq!(replies.len(), 10, "{replies:#?}");
}

// ------------------------------------------------------- modern protocol

#[test]
fn modern_session_discover_then_calls() {
    let dir = tempfile::tempdir().unwrap();
    let runner = fake();
    let replies = session(
        enabled_env(&dir),
        runner.clone(),
        &[
            modern(1, "server/discover", json!({})),
            modern(2, "tools/list", json!({})),
            modern(
                3,
                "tools/call",
                call("run_query", json!({ "sql": "SELECT 1 AS one" })),
            ),
            modern(4, "ping", json!({})),
            modern(5, "prompts/list", json!({})),
        ],
    );
    let discover = &by_id(&replies, 1)["result"];
    assert_eq!(discover["resultType"], "complete");
    assert_eq!(discover["supportedVersions"][0], MODERN);
    assert!(discover["supportedVersions"]
        .as_array()
        .unwrap()
        .contains(&json!("2025-11-25")));
    assert_eq!(discover["capabilities"]["tools"]["listChanged"], false);
    assert_eq!(
        discover["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
        "rowing-beacon"
    );
    assert!(discover["instructions"]
        .as_str()
        .unwrap()
        .contains("get_schema"));

    for id in [2, 3, 4] {
        let result = &by_id(&replies, id)["result"];
        assert_eq!(result["resultType"], "complete", "{result}");
        assert_eq!(
            result["_meta"]["io.modelcontextprotocol/serverInfo"]["version"],
            discover["_meta"]["io.modelcontextprotocol/serverInfo"]["version"]
        );
    }
    assert_eq!(
        by_id(&replies, 2)["result"]["tools"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    let (_, structured, is_error) = tool_result(by_id(&replies, 3));
    assert!(!is_error);
    assert_eq!(structured["columns"], json!(["one"]));
    assert_eq!(by_id(&replies, 5)["error"]["code"], -32601);
    // The engine got the MCP id as its request id (for cancellation).
    assert_eq!(runner.requests()[0].request_id, "mcp:3");
}

#[test]
fn modern_version_errors() {
    let dir = tempfile::tempdir().unwrap();
    let mut wrong = modern_meta();
    wrong["io.modelcontextprotocol/protocolVersion"] = json!("2030-01-01");
    let mut no_capabilities = modern_meta();
    no_capabilities
        .as_object_mut()
        .unwrap()
        .remove("io.modelcontextprotocol/clientCapabilities");
    let replies = session(
        enabled_env(&dir),
        fake(),
        &[
            legacy(1, "server/discover", json!({ "_meta": wrong })),
            legacy(2, "tools/list", json!({ "_meta": no_capabilities })),
            // A legacy-style discover probe without _meta: an error that is
            // not a modern one, as the stdio fallback rules expect.
            legacy(3, "server/discover", json!({})),
        ],
    );
    let error = &by_id(&replies, 1)["error"];
    assert_eq!(error["code"], -32022);
    assert_eq!(error["message"], "Unsupported protocol version");
    assert_eq!(error["data"]["requested"], "2030-01-01");
    let supported = error["data"]["supported"].as_array().unwrap();
    assert_eq!(supported[0], MODERN);
    assert!(supported.contains(&json!("2025-11-25")));
    assert_eq!(by_id(&replies, 2)["error"]["code"], -32602);
    assert_eq!(by_id(&replies, 3)["error"]["code"], -32602);
}

#[test]
fn modern_subscriptions_are_acknowledged_and_closed() {
    let dir = tempfile::tempdir().unwrap();
    let (to_server, from_test) = mpsc::channel::<Vec<u8>>();
    let output = SharedOutput::default();
    let server = {
        let (output, env) = (output.clone(), enabled_env(&dir));
        std::thread::spawn(move || {
            serve_with(
                BufReader::new(ChannelReader::new(from_test)),
                output,
                env,
                fake(),
            )
            .unwrap()
        })
    };
    let send = |text: String| to_server.send(format!("{text}\n").into_bytes()).unwrap();
    send(modern(
        7,
        "subscriptions/listen",
        json!({ "notifications": { "toolsListChanged": true } }),
    ));
    output.wait_for(1);
    send(line(
        json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 7 } }),
    ));
    send(modern(8, "ping", json!({})));
    output.wait_for(2);
    drop(to_server);
    server.join().unwrap();
    let replies = parse_output(&output.bytes());
    assert_eq!(
        replies.len(),
        2,
        "nothing more for a closed subscription: {replies:#?}"
    );
    let ack = &replies[0];
    assert_eq!(ack["method"], "notifications/subscriptions/acknowledged");
    assert!(ack.get("id").is_none());
    assert_eq!(
        ack["params"]["_meta"]["io.modelcontextprotocol/subscriptionId"],
        7
    );
    assert_eq!(ack["params"]["notifications"], json!({}));
    assert_eq!(replies[1]["id"], 8);
}

// ------------------------------------------------------------------- tools

#[test]
fn every_tool_answers_the_disabled_error_when_access_is_off() {
    let dir = tempfile::tempdir().unwrap();
    let db = settings_db(dir.path(), &[("analytics.mcp.enabled", "false")]);
    let runner = fake();
    let tools = [
        ("get_schema", json!({})),
        ("list_reports", json!({})),
        ("run_report", json!({ "id": "season-overview" })),
        ("run_query", json!({ "sql": "SELECT 1" })),
        (
            "propose_chart",
            json!({ "title": "t", "sql": "SELECT 1 AS a", "chart": { "type": "table" } }),
        ),
    ];
    let mut lines = vec![initialize(1, "2025-11-25")];
    for (i, (name, args)) in tools.iter().enumerate() {
        lines.push(legacy(
            10 + i as i64,
            "tools/call",
            call(name, args.clone()),
        ));
    }
    let replies = session(
        env(db.clone(), dir.path().join("inbox")),
        runner.clone(),
        &lines,
    );
    for i in 0..tools.len() {
        let (text, _, is_error) = tool_result(by_id(&replies, 10 + i as i64));
        assert!(is_error);
        assert_eq!(text, DISABLED_MESSAGE);
    }
    assert!(runner.requests().is_empty(), "no SQL ran");
    assert!(!dir.path().join("inbox").exists());

    // No setting at all: off by default. Read at each call: no restart.
    let dir2 = tempfile::tempdir().unwrap();
    let db2 = settings_db(dir2.path(), &[]);
    let replies = session(
        env(db2.clone(), dir2.path().join("inbox")),
        fake(),
        &[
            initialize(1, "2025-11-25"),
            legacy(2, "tools/call", call("get_schema", json!({}))),
        ],
    );
    assert_eq!(tool_result(by_id(&replies, 2)).0, DISABLED_MESSAGE);
}

#[test]
fn the_setting_is_read_at_each_call() {
    let dir = tempfile::tempdir().unwrap();
    let db = settings_db(dir.path(), &[("analytics.mcp.enabled", "false")]);
    let (to_server, from_test) = mpsc::channel::<Vec<u8>>();
    let output = SharedOutput::default();
    let server = {
        let output = output.clone();
        let env = env(db.clone(), dir.path().join("inbox"));
        std::thread::spawn(move || {
            serve_with(
                BufReader::new(ChannelReader::new(from_test)),
                output,
                env,
                fake(),
            )
            .unwrap()
        })
    };
    let send = |text: String| to_server.send(format!("{text}\n").into_bytes()).unwrap();
    send(initialize(1, "2025-11-25"));
    send(legacy(
        2,
        "tools/call",
        call("run_query", json!({ "sql": "SELECT 1 AS a" })),
    ));
    output.wait_for(2);
    set(
        &Connection::open(&db).unwrap(),
        "analytics.mcp.enabled",
        "true",
    );
    send(legacy(
        3,
        "tools/call",
        call("run_query", json!({ "sql": "SELECT 1 AS a" })),
    ));
    output.wait_for(3);
    drop(to_server);
    server.join().unwrap();
    let replies = parse_output(&output.bytes());
    assert!(tool_result(by_id(&replies, 2)).2);
    assert!(!tool_result(by_id(&replies, 3)).2);
}

#[test]
fn missing_database_is_a_tool_error_naming_the_db_option() {
    let dir = tempfile::tempdir().unwrap();
    let replies = session(
        env(dir.path().join("nowhere.db"), dir.path().join("inbox")),
        fake(),
        &[
            initialize(1, "2025-11-25"),
            legacy(2, "tools/call", call("get_schema", json!({}))),
        ],
    );
    let (text, _, is_error) = tool_result(by_id(&replies, 2));
    assert!(is_error);
    assert!(text.contains("--db"), "{text}");
    assert!(
        !dir.path().join("nowhere.db").exists(),
        "the database is never created"
    );
}

#[test]
fn run_query_limits_and_season_with_the_fake() {
    let dir = tempfile::tempdir().unwrap();
    let db = settings_db(
        dir.path(),
        &[
            ("analytics.mcp.enabled", "true"),
            ("analytics.mcp.privacy", "\"nominative\""),
            ("analytics.seasonStartMonth", "9"),
            ("analytics.performance.profile", "\"economy\""),
        ],
    );
    let runner = fake();
    let replies = session(
        env(db, dir.path().join("inbox")),
        runner.clone(),
        &[
            initialize(1, "2025-11-25"),
            legacy(
                2,
                "tools/call",
                call(
                    "run_query",
                    json!({ "sql": "SELECT 1 AS a", "params": { "season": "current" } }),
                ),
            ),
            legacy(
                3,
                "tools/call",
                call("run_query", json!({ "sql": "SELECT FAIL" })),
            ),
            legacy(4, "tools/call", call("run_query", json!({ "sql": " " }))),
            legacy(
                5,
                "tools/call",
                call("run_query", json!({ "sql": "SELECT 1", "extra": 1 })),
            ),
            legacy(
                6,
                "tools/call",
                call(
                    "run_query",
                    json!({ "sql": "SELECT 1", "params": { "": 1 } }),
                ),
            ),
        ],
    );
    let requests = runner.requests();
    assert_eq!(requests.len(), 2, "only valid calls reach the engine");
    let first = &requests[0];
    assert_eq!(first.max_rows, 500);
    assert_eq!(first.timeout_ms, 10_000);
    assert_eq!(first.privacy, Privacy::Nominative);
    assert_eq!(first.now, NOW);
    // 2026-06-20 with seasons starting in September: season 2025.
    assert_eq!(first.params["season"], json!(2025));
    let (text, _, is_error) = tool_result(by_id(&replies, 3));
    assert!(is_error && text.contains("syntax error"), "{text}");
    for id in [4, 5, 6] {
        assert!(tool_result(by_id(&replies, id)).2, "id {id}");
    }
}

/// The club's performance profile sets the MCP timeouts (rows stay 500:
/// the client's context bounds them, not the machine).
#[test]
fn run_query_follows_the_performance_profile() {
    for (profile, timeout) in [
        ("standard", 20_000),
        ("powerful", 30_000),
        ("economy", 10_000),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let setting = format!("\"{profile}\"");
        let db = settings_db(
            dir.path(),
            &[
                ("analytics.mcp.enabled", "true"),
                ("analytics.performance.profile", &setting),
            ],
        );
        let runner = fake();
        session(
            env(db, dir.path().join("inbox")),
            runner.clone(),
            &[
                initialize(1, "2025-11-25"),
                legacy(
                    2,
                    "tools/call",
                    call("run_query", json!({ "sql": "SELECT 1" })),
                ),
            ],
        );
        let requests = runner.requests();
        assert_eq!(requests.len(), 1, "{profile}");
        assert_eq!(requests[0].timeout_ms, timeout, "{profile}");
        assert_eq!(requests[0].max_rows, 500, "{profile}");
    }
}

#[test]
fn run_report_resolves_current_with_the_fake() {
    let dir = tempfile::tempdir().unwrap();
    let runner = fake();
    let replies = session(
        enabled_env(&dir),
        runner.clone(),
        &[
            initialize(1, "2025-11-25"),
            legacy(
                2,
                "tools/call",
                call("run_report", json!({ "id": "season-overview" })),
            ),
            legacy(
                3,
                "tools/call",
                call(
                    "run_report",
                    json!({ "id": "season-overview", "params": { "season": 2019 } }),
                ),
            ),
            legacy(
                4,
                "tools/call",
                call("run_report", json!({ "id": "no-such-report" })),
            ),
            legacy(
                5,
                "tools/call",
                call(
                    "run_report",
                    json!({ "id": "season-overview", "params": { "colour": 1 } }),
                ),
            ),
        ],
    );
    let (_, structured, is_error) = tool_result(by_id(&replies, 2));
    assert!(!is_error);
    assert_eq!(structured["report_id"], "season-overview");
    assert_eq!(
        structured["applied_params"]["season"],
        support::CURRENT_SEASON
    );
    assert!(structured["report_title"].as_str().unwrap().len() > 3);
    assert_eq!(
        tool_result(by_id(&replies, 3)).1["applied_params"]["season"],
        2019
    );
    assert!(tool_result(by_id(&replies, 4)).2);
    assert!(
        tool_result(by_id(&replies, 5)).2,
        "unknown params are refused"
    );
    let request = &runner.requests()[0];
    assert_eq!(
        request.sql,
        rb_analytics::assets::report_sql("season-overview").unwrap()
    );
    assert_eq!(request.privacy, Privacy::Pseudonymised);
}

#[test]
fn list_reports_follows_modules_and_privacy() {
    let dir = tempfile::tempdir().unwrap();
    let replies = session(
        enabled_env(&dir),
        fake(),
        &[
            initialize(1, "2025-11-25"),
            legacy(2, "tools/call", call("list_reports", json!({}))),
        ],
    );
    let (_, structured, is_error) = tool_result(by_id(&replies, 2));
    assert!(!is_error);
    let ids: BTreeSet<&str> = structured["reports"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains("season-overview"));
    // No module enabled: the outing-types report is not offered; the
    // nominative ones neither in pseudonymised mode.
    assert!(!ids.contains("outing-types"));
    assert!(!ids.contains("km-challenge"));
    let unavailable: BTreeSet<&str> = structured["unavailable"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();
    assert!(unavailable.contains("outing-types"));
    for report in structured["reports"].as_array().unwrap() {
        assert!(
            report["title_fr"].as_str().is_some_and(|t| !t.is_empty()),
            "{report}"
        );
        assert!(
            report["description"]
                .as_str()
                .is_some_and(|t| !t.is_empty()),
            "{report}"
        );
    }
}

fn propose(id: i64, args: Value) -> String {
    legacy(id, "tools/call", call("propose_chart", args))
}

#[test]
fn propose_chart_writes_the_inbox_and_validates() {
    let dir = tempfile::tempdir().unwrap();
    let inbox = dir.path().join("deep").join("inbox");
    let db = settings_db(dir.path(), &[("analytics.mcp.enabled", "true")]);
    let good = json!({
        "title": "Sorties par mois",
        "description": "Nombre de sorties par mois de la saison",
        "sql": "SELECT 1 AS month, 2 AS outings",
        "params": [{ "name": "season", "type": "season", "label": "Saison", "required": true, "default": "current" }],
        "chart": { "type": "bar", "x": "month", "y": ["outings"] }
    });
    let mut bad_sql = good.clone();
    bad_sql["sql"] = json!("SELECT FAIL");
    let mut bad_chart = good.clone();
    bad_chart["chart"] = json!({ "type": "bar", "x": "month" });
    let mut wrong_column = good.clone();
    wrong_column["chart"] = json!({ "type": "bar", "x": "month", "y": ["km"] });
    let mut bad_params = good.clone();
    bad_params["params"] = json!([{ "name": "Season!", "type": "season" }]);
    let replies = session(
        env(db, inbox.clone()),
        fake(),
        &[
            initialize(1, "2025-11-25"),
            propose(2, bad_sql),
            propose(3, bad_chart),
            propose(4, wrong_column),
            propose(5, bad_params),
            propose(6, json!({ "title": "x" })),
        ],
    );
    for id in 2..=6 {
        let (text, _, is_error) = tool_result(by_id(&replies, id));
        assert!(is_error, "id {id}: {text}");
    }
    assert!(tool_result(by_id(&replies, 4)).0.contains("km"));
    assert!(!inbox.exists(), "nothing written for invalid proposals");

    let replies = session(
        env(dir.path().join("main.db"), inbox.clone()),
        fake(),
        &[initialize(1, "2025-11-25"), propose(2, good.clone())],
    );
    let (text, structured, is_error) = tool_result(by_id(&replies, 2));
    assert!(!is_error, "{text}");
    assert_eq!(text, PROPOSAL_SAVED_MESSAGE);
    assert!(text.starts_with(
        "Proposition enregistrée. Ouvrez Rowing Beacon › Statistiques › Explorer › Propositions"
    ));
    let id = structured["id"].as_str().unwrap().to_string();

    // One file, named after its id, nothing left over (.tmp renamed).
    let files: Vec<String> = std::fs::read_dir(&inbox)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(files, vec![format!("{id}.json")]);
    let file: Value =
        serde_json::from_slice(&std::fs::read(inbox.join(format!("{id}.json"))).unwrap()).unwrap();
    assert_eq!(file["id"], id);
    assert_eq!(file["title"], good["title"]);
    assert_eq!(file["description"], good["description"]);
    assert_eq!(file["sql"], good["sql"]);
    assert_eq!(file["params"], good["params"]);
    assert_eq!(file["chart"], good["chart"]);
    assert_eq!(file["client"], "test-client");
    let created = file["createdAt"].as_str().unwrap();
    assert!(created.len() == 24 && created.ends_with('Z'), "{created}");

    // The app's side: listed, then removed.
    let listed = inbox_list(&inbox).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].error, None);
    assert_eq!(listed[0].client.as_deref(), Some("test-client"));
    inbox_remove(&inbox, &id).unwrap();
    assert!(inbox_list(&inbox).unwrap().is_empty());
    assert!(inbox_remove(&inbox, "../main").is_err());
}

// ------------------------------------------------------------ cancellation

/// stdin fed by the test, line by line.
struct ChannelReader {
    receiver: mpsc::Receiver<Vec<u8>>,
    pending: Vec<u8>,
}

impl ChannelReader {
    fn new(receiver: mpsc::Receiver<Vec<u8>>) -> Self {
        ChannelReader {
            receiver,
            pending: Vec::new(),
        }
    }
}

impl Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pending.is_empty() {
            match self.receiver.recv() {
                Ok(bytes) => self.pending = bytes,
                Err(_) => return Ok(0),
            }
        }
        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

/// stdout shared with the test.
#[derive(Clone, Default)]
struct SharedOutput(Arc<Mutex<Vec<u8>>>);

impl SharedOutput {
    fn bytes(&self) -> Vec<u8> {
        self.0.lock().unwrap().clone()
    }

    fn wait_for(&self, lines: usize) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.bytes().iter().filter(|b| **b == b'\n').count() < lines {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {lines} lines"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Write for SharedOutput {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn a_running_query_is_cancelled_and_never_answered() {
    let dir = tempfile::tempdir().unwrap();
    let runner = fake();
    let (started_tx, started_rx) = mpsc::channel();
    *runner.started.lock().unwrap() = Some(started_tx);
    let (to_server, from_test) = mpsc::channel::<Vec<u8>>();
    let output = SharedOutput::default();
    let server = {
        let (output, env, runner) = (output.clone(), enabled_env(&dir), runner.clone());
        std::thread::spawn(move || {
            serve_with(
                BufReader::new(ChannelReader::new(from_test)),
                output,
                env,
                runner,
            )
            .unwrap()
        })
    };
    let send = |text: String| to_server.send(format!("{text}\n").into_bytes()).unwrap();
    send(modern(
        5,
        "tools/call",
        call("run_query", json!({ "sql": "SELECT SLOW AS x" })),
    ));
    let request_id = started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(request_id, "mcp:5");
    let began = Instant::now();
    send(line(
        json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 5, "reason": "user" } }),
    ));
    send(modern(6, "ping", json!({})));
    output.wait_for(1);
    assert!(
        began.elapsed() < Duration::from_secs(5),
        "the query stopped at once"
    );
    drop(to_server);
    server.join().unwrap();
    let replies = parse_output(&output.bytes());
    assert_eq!(
        replies.len(),
        1,
        "no answer for the cancelled request: {replies:#?}"
    );
    assert_eq!(replies[0]["id"], 6);
    assert_eq!(runner.cancelled(), vec!["mcp:5".to_string()]);
}

/// Review A, L6: a client that closes stdin (Claude Desktop restarting
/// the server) does not keep the old process busy with its last query.
#[test]
fn closing_stdin_stops_the_running_query_after_a_grace_period() {
    let dir = tempfile::tempdir().unwrap();
    let runner = fake();
    let (started_tx, started_rx) = mpsc::channel();
    *runner.started.lock().unwrap() = Some(started_tx);
    let (to_server, from_test) = mpsc::channel::<Vec<u8>>();
    let output = SharedOutput::default();
    let server = {
        let (output, env, runner) = (output.clone(), enabled_env(&dir), runner.clone());
        std::thread::spawn(move || {
            serve_with(
                BufReader::new(ChannelReader::new(from_test)),
                output,
                env,
                runner,
            )
            .unwrap()
        })
    };
    let send = |text: String| to_server.send(format!("{text}\n").into_bytes()).unwrap();
    send(modern(
        5,
        "tools/call",
        call("run_query", json!({ "sql": "SELECT SLOW AS x" })),
    ));
    send(modern(6, "ping", json!({})));
    started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let closed = Instant::now();
    drop(to_server);
    server.join().unwrap();
    let elapsed = closed.elapsed();
    assert!(
        elapsed >= rb_analytics::mcp::stdio::EOF_GRACE && elapsed < Duration::from_secs(8),
        "stopped after the grace period, not after the 10 s query: {elapsed:?}"
    );
    assert_eq!(runner.cancelled(), vec!["mcp:5".to_string()]);
    let replies = parse_output(&output.bytes());
    assert_eq!(replies.len(), 1, "{replies:#?}");
    assert_eq!(
        replies[0]["id"], 5,
        "the query answers, the ping is dropped"
    );
}

/// What was read before stdin closed is answered when it is quick.
#[test]
fn closing_stdin_still_answers_quick_requests() {
    let dir = tempfile::tempdir().unwrap();
    let runner = fake();
    let began = Instant::now();
    let replies = session(
        enabled_env(&dir),
        runner.clone(),
        &[
            modern(
                1,
                "tools/call",
                call("run_query", json!({ "sql": "SELECT 1 AS a" })),
            ),
            modern(2, "ping", json!({})),
        ],
    );
    assert_eq!(replies.len(), 2, "{replies:#?}");
    assert!(runner.cancelled().is_empty());
    assert!(
        began.elapsed() < rb_analytics::mcp::stdio::EOF_GRACE,
        "no wait for the grace period once everything is answered"
    );
}

#[test]
fn a_queued_request_cancelled_before_it_starts_never_runs() {
    let dir = tempfile::tempdir().unwrap();
    let runner = fake();
    let (started_tx, started_rx) = mpsc::channel();
    *runner.started.lock().unwrap() = Some(started_tx);
    let (to_server, from_test) = mpsc::channel::<Vec<u8>>();
    let output = SharedOutput::default();
    let server = {
        let (output, env, runner) = (output.clone(), enabled_env(&dir), runner.clone());
        std::thread::spawn(move || {
            serve_with(
                BufReader::new(ChannelReader::new(from_test)),
                output,
                env,
                runner,
            )
            .unwrap()
        })
    };
    let send = |text: String| to_server.send(format!("{text}\n").into_bytes()).unwrap();
    let cancel = |id: i64| {
        line(
            json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": id } }),
        )
    };
    send(modern(
        1,
        "tools/call",
        call("run_query", json!({ "sql": "SELECT SLOW AS x" })),
    ));
    started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    // While 1 runs, 2 waits in the queue; both are cancelled.
    send(modern(
        2,
        "tools/call",
        call("run_query", json!({ "sql": "SELECT 2 AS y" })),
    ));
    send(cancel(2));
    send(cancel(1));
    send(modern(3, "ping", json!({})));
    output.wait_for(1);
    drop(to_server);
    server.join().unwrap();
    let replies = parse_output(&output.bytes());
    assert_eq!(replies.len(), 1, "{replies:#?}");
    assert_eq!(replies[0]["id"], 3);
    let ran: Vec<String> = runner
        .requests()
        .into_iter()
        .map(|r| r.request_id)
        .collect();
    assert_eq!(
        ran,
        vec!["mcp:1".to_string()],
        "request 2 never reached the engine"
    );
}

// ---------------------------------------------------- real engine, real db

fn club(privacy: &str) -> TestDb {
    let db = TestDb::new();
    let conn = db.writer();
    set(&conn, "analytics.mcp.enabled", "true");
    set(&conn, "analytics.mcp.privacy", &format!("\"{privacy}\""));
    set(
        &conn,
        "modules.enabled",
        "[\"distances\",\"outingTypes\",\"guests\"]",
    );
    drop(conn);
    db
}

fn engine() -> Arc<dyn QueryRunner> {
    Arc::new(EngineRunner::new())
}

#[test]
fn real_engine_privacy_and_row_cap() {
    for (privacy, names_visible) in [("pseudonymised", false), ("nominative", true)] {
        let db = club(privacy);
        let replies = session(
            env(db.path.clone(), db.dir.path().join("inbox")),
            engine(),
            &[
                initialize(1, "2025-11-25"),
                legacy(
                    2,
                    "tools/call",
                    call(
                        "run_query",
                        json!({ "sql": "SELECT display_name, rower_code FROM v_rowers ORDER BY rower_code" }),
                    ),
                ),
                legacy(
                    3,
                    "tools/call",
                    call(
                        "run_query",
                        json!({ "sql": "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000) SELECT x FROM c" }),
                    ),
                ),
                legacy(4, "tools/call", call("get_schema", json!({}))),
                legacy(
                    5,
                    "tools/call",
                    call("run_query", json!({ "sql": "DELETE FROM rower" })),
                ),
                legacy(
                    6,
                    "tools/call",
                    call("run_query", json!({ "sql": "SELECT value FROM setting" })),
                ),
            ],
        );
        let (text, structured, is_error) = tool_result(by_id(&replies, 2));
        assert!(!is_error, "{text}");
        let rows = structured["rows"].as_array().unwrap();
        assert!(!rows.is_empty());
        assert!(
            rows.iter().all(|r| r[1].is_string()),
            "rower_code always present"
        );
        let any_name = rows.iter().any(|r| r[0].is_string());
        assert_eq!(any_name, names_visible, "{privacy}: {text}");
        let all_output = serde_json::to_string(&replies).unwrap();
        for marker in support::CONTACT_MARKERS
            .iter()
            .chain(support::DENIED_MARKERS.iter())
        {
            assert!(!all_output.contains(marker), "{privacy}: {marker} leaked");
        }
        if !names_visible {
            for name in support::LAST_NAMES {
                assert!(
                    !all_output.contains(&format!("\"{name}")),
                    "{privacy}: {name} leaked"
                );
            }
        }

        let (_, capped, is_error) = tool_result(by_id(&replies, 3));
        assert!(!is_error);
        assert_eq!(capped["rows"].as_array().unwrap().len(), 500);
        assert_eq!(capped["truncated"], true);

        let (_, schema, _) = tool_result(by_id(&replies, 4));
        assert_eq!(schema["privacy"], privacy);
        assert_eq!(
            schema["enabled_modules"],
            json!(["distances", "outingTypes", "guests"])
        );

        assert!(tool_result(by_id(&replies, 5)).2, "writes are refused");
        assert!(
            tool_result(by_id(&replies, 6)).2,
            "the setting table is not readable"
        );
    }
}

#[test]
fn real_engine_reports_proposals_and_untouched_database() {
    let db = club("pseudonymised");
    let inbox = db.dir.path().join("inbox");
    let before = db.files();
    let replies = session(
        env(db.path.clone(), inbox.clone()),
        engine(),
        &[
            modern(1, "server/discover", json!({})),
            modern(2, "tools/call", call("get_schema", json!({}))),
            modern(3, "tools/call", call("list_reports", json!({}))),
            modern(
                4,
                "tools/call",
                call(
                    "run_report",
                    json!({ "id": "season-overview", "params": { "season": "current" } }),
                ),
            ),
            modern(
                5,
                "tools/call",
                call("run_report", json!({ "id": "boat-usage-ranking" })),
            ),
            modern(
                6,
                "tools/call",
                call(
                    "propose_chart",
                    json!({
                        "title": "Sorties par bateau",
                        "sql": "SELECT boat_name, COUNT(*) AS outings FROM v_outings WHERE season = :season GROUP BY boat_name",
                        "params": [{ "name": "season", "type": "season", "label": "Saison", "required": true, "default": "current" }],
                        "chart": { "type": "bar", "x": "boat_name", "y": ["outings"], "orientation": "horizontal" }
                    }),
                ),
            ),
            modern(
                7,
                "tools/call",
                call(
                    "propose_chart",
                    json!({
                        "title": "Bad",
                        "sql": "SELECT nope FROM v_outings",
                        "chart": { "type": "table" }
                    }),
                ),
            ),
            modern(
                8,
                "tools/call",
                call(
                    "propose_chart",
                    json!({
                        "title": "Bad chart",
                        "sql": "SELECT boat_name FROM v_outings",
                        "chart": { "type": "pie", "label": "boat_name" }
                    }),
                ),
            ),
        ],
    );
    for id in 2..=6 {
        let (text, _, is_error) = tool_result(by_id(&replies, id));
        assert!(!is_error, "id {id}: {text}");
    }
    let (_, report, _) = tool_result(by_id(&replies, 4));
    assert_eq!(report["applied_params"]["season"], support::CURRENT_SEASON);
    assert!(!report["rows"].as_array().unwrap().is_empty());
    assert!(tool_result(by_id(&replies, 7)).2);
    assert!(tool_result(by_id(&replies, 8)).2);
    let listed = inbox_list(&inbox).unwrap();
    assert_eq!(listed.len(), 1, "only the valid proposal");
    assert_eq!(listed[0].client.as_deref(), Some("modern-client"));
    assert_eq!(db.files(), before, "main.db and its WAL are unchanged");
}

// --------------------------------------------------------- the real binary

fn spawn(db: &Path, inbox: &Path) -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_rb-mcp"))
        .arg("--mcp")
        .arg("--db")
        .arg(db)
        .arg(format!("--inbox={}", inbox.display()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

#[test]
fn binary_over_stdio_pipes() {
    let db = club("pseudonymised");
    let inbox = db.dir.path().join("first").join("inbox");
    let before = db.files();
    let mut child = spawn(&db.path, &inbox);
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ask = |stdin: &mut std::process::ChildStdin, text: String| -> Value {
        writeln!(stdin, "{text}").unwrap();
        stdin.flush().unwrap();
        let mut reply = String::new();
        stdout.read_line(&mut reply).unwrap();
        assert!(reply.ends_with('\n'));
        serde_json::from_str(&reply).unwrap_or_else(|e| panic!("{e}: {reply}"))
    };
    let init = ask(&mut stdin, initialize(1, "2025-06-18"));
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    writeln!(stdin, "{}", initialized()).unwrap();
    let list = ask(&mut stdin, legacy(2, "tools/list", json!({})));
    assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 5);
    let schema = ask(
        &mut stdin,
        legacy(3, "tools/call", call("get_schema", json!({}))),
    );
    assert_eq!(schema["result"]["isError"], false);
    assert!(!inbox.exists());
    let proposal = ask(
        &mut stdin,
        legacy(
            4,
            "tools/call",
            call(
                "propose_chart",
                json!({
                    "title": "Sorties",
                    "sql": "SELECT COUNT(*) AS outings FROM v_outings",
                    "chart": { "type": "kpi", "items": [{ "value": "outings", "format": "integer" }] }
                }),
            ),
        ),
    );
    assert_eq!(proposal["result"]["isError"], false, "{proposal}");
    assert!(inbox.is_dir(), "the inbox is created on the first proposal");

    // A query that would run for its whole 10 s budget, then cancelled.
    writeln!(
        stdin,
        "{}",
        legacy(5, "tools/call", call("run_query", json!({ "sql": "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c" })))
    )
    .unwrap();
    stdin.flush().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    let began = Instant::now();
    writeln!(stdin, "{}", line(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 5 } }))).unwrap();
    let pong = ask(&mut stdin, legacy(6, "ping", json!({})));
    assert_eq!(
        pong["id"], 6,
        "no answer for the cancelled request comes first: {pong}"
    );
    assert!(
        began.elapsed() < Duration::from_secs(5),
        "cancelled in {:?}",
        began.elapsed()
    );

    // Closing stdin ends the server with status 0, stdout clean.
    drop(stdin);
    let mut rest = String::new();
    stdout.read_to_string(&mut rest).unwrap();
    assert_eq!(rest, "", "nothing after the last answer");
    let status = child.wait().unwrap();
    assert!(status.success(), "{status}");
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(stderr.contains("rowing-beacon-mcp:"), "{stderr}");
    assert!(
        stderr.lines().all(|l| l.starts_with("rowing-beacon-mcp: ")),
        "{stderr}"
    );
    assert_eq!(db.files(), before, "main.db and its WAL are unchanged");
}

#[test]
fn binary_answers_a_piped_script_then_exits() {
    // `printf ... | rb-mcp`: stdin is closed right after the script; every
    // message already sent is still answered.
    let dir = tempfile::tempdir().unwrap();
    let db = settings_db(dir.path(), &[("analytics.mcp.enabled", "true")]);
    let mut child = spawn(&db, &dir.path().join("inbox"));
    let script = [
        modern(1, "server/discover", json!({})),
        "{oops".to_string(),
        modern(2, "nope", json!({})),
        modern(
            3,
            "tools/call",
            call("run_query", json!({ "sql": "SELECT 42 AS answer" })),
        ),
    ]
    .join("\n");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(script.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let replies = parse_output(&output.stdout);
    assert_eq!(replies.len(), 4, "{replies:#?}");
    assert_eq!(replies[0]["result"]["resultType"], "complete");
    assert_eq!(replies[1]["error"]["code"], -32700);
    assert_eq!(replies[2]["error"]["code"], -32601);
    assert_eq!(tool_result(&replies[3]).1["rows"], json!([[42]]));
}

// ------------------------------------------------------------ last call

#[test]
fn a_tool_call_records_the_client_and_local_time() {
    let dir = tempfile::tempdir().unwrap();
    let env = enabled_env(&dir);
    let inbox = env.inbox_dir.clone();
    assert_eq!(rb_analytics::mcp::last_call(&inbox), None);
    // Listing the tools is not a question: nothing recorded.
    session(
        env.clone(),
        fake(),
        &[
            initialize(1, "2025-06-18"),
            legacy(2, "tools/list", json!({})),
        ],
    );
    assert_eq!(rb_analytics::mcp::last_call(&inbox), None);
    session(
        env,
        fake(),
        &[modern(1, "tools/call", call("get_schema", json!({})))],
    );
    let last = rb_analytics::mcp::last_call(&inbox).expect("recorded");
    assert_eq!(last.client.as_deref(), Some("modern-client"));
    assert_eq!(last.at, NOW);
    assert!(
        dir.path().join("mcp-last-call.json").exists(),
        "next to the inbox folder"
    );
}
