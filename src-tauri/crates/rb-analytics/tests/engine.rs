//! Engine acceptance tests (plan section 3, WP1): the engine cannot write,
//! cannot leak a denied table or a private column in either privacy mode,
//! and cannot hang.

mod support;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rb_analytics::assets::{catalog, report_blocks};
use rb_analytics::engine::{self, open, run, EngineContext, EngineState};
use rb_analytics::error::ErrorCode;
use rb_analytics::ipc::{Privacy, QueryResult, RunQueryRequest};
use serde_json::{json, Value};

use support::{request, with_params, Options, TestDb, CURRENT_SEASON, NOW};

const MODES: [Privacy; 2] = [Privacy::Nominative, Privacy::Pseudonymised];

fn ctx(db: &TestDb, privacy: Privacy) -> EngineContext {
    EngineContext::economy(db.path.clone(), privacy)
}

fn run_in(
    db: &TestDb,
    privacy: Privacy,
    req: RunQueryRequest,
) -> Result<QueryResult, rb_analytics::AnalyticsError> {
    let state = EngineState::new();
    let req = RunQueryRequest { privacy, ..req };
    engine::run_query(&state, &ctx(db, privacy), &req)
}

fn ok(db: &TestDb, privacy: Privacy, sql: &str) -> QueryResult {
    run_in(db, privacy, request(sql)).unwrap_or_else(|e| panic!("{sql} [{privacy:?}]: {e}"))
}

fn err(db: &TestDb, privacy: Privacy, sql: &str) -> rb_analytics::AnalyticsError {
    match run_in(db, privacy, request(sql)) {
        Ok(result) => panic!("{sql} [{privacy:?}] succeeded: {:?}", result.rows),
        Err(e) => e,
    }
}

fn data_version(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("PRAGMA data_version", [], |r| r.get(0))
        .unwrap()
}

/// Asserts that running `f` changes neither the bytes of main.db and its
/// WAL nor `PRAGMA data_version` seen by another connection.
fn assert_unchanged(db: &TestDb, f: impl FnOnce()) {
    let observer = db.writer();
    let before_version = data_version(&observer);
    let before = db.files();
    f();
    assert_eq!(db.files(), before, "database files changed");
    assert_eq!(
        data_version(&observer),
        before_version,
        "data_version changed"
    );
}

// ------------------------------------------------------------------ lexer

#[derive(serde::Deserialize)]
struct EngineCase {
    sql: String,
    expect: String,
}

/// The rejections of `engine-cases.json` come out of `run_query` with the
/// same code (the lexer itself is tested case by case in `lexer.rs`).
#[test]
fn engine_cases_are_rejected_by_run_query() {
    let db = TestDb::new();
    let cases: Vec<EngineCase> = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../src/analytics/engine/engine-cases.json"
    )))
    .unwrap();
    assert_unchanged(&db, || {
        for case in cases.iter().filter(|c| c.expect != "ok") {
            let error = err(&db, Privacy::Nominative, &case.sql);
            assert_eq!(error.code.as_str(), case.expect, "{:?}: {error}", case.sql);
        }
    });
}

// ------------------------------------------------------------------ writes

const WRITES: [(&str, ErrorCode); 26] = [
    (
        "INSERT INTO outing (id) VALUES ('x')",
        ErrorCode::NotReadOnly,
    ),
    ("UPDATE rower SET first_name = 'x'", ErrorCode::NotReadOnly),
    ("DELETE FROM outing", ErrorCode::NotReadOnly),
    (
        "REPLACE INTO setting VALUES ('a', 'b')",
        ErrorCode::NotReadOnly,
    ),
    ("CREATE TABLE x (a)", ErrorCode::NotReadOnly),
    ("CREATE TEMP TABLE x (a)", ErrorCode::NotReadOnly),
    ("DROP TABLE outing", ErrorCode::NotReadOnly),
    ("DROP VIEW v_outings", ErrorCode::NotReadOnly),
    ("ALTER TABLE outing ADD COLUMN x", ErrorCode::NotReadOnly),
    ("ATTACH DATABASE 'x.db' AS x", ErrorCode::NotReadOnly),
    ("DETACH DATABASE temp", ErrorCode::NotReadOnly),
    ("VACUUM", ErrorCode::NotReadOnly),
    (
        "VACUUM INTO '/tmp/rb-analytics-copy.db'",
        ErrorCode::NotReadOnly,
    ),
    ("REINDEX", ErrorCode::NotReadOnly),
    ("ANALYZE", ErrorCode::NotReadOnly),
    ("PRAGMA query_only = OFF", ErrorCode::NotReadOnly),
    ("PRAGMA writable_schema = ON", ErrorCode::NotReadOnly),
    ("BEGIN IMMEDIATE", ErrorCode::NotReadOnly),
    ("SELECT load_extension('x')", ErrorCode::Denied),
    (
        "WITH x AS (DELETE FROM outing RETURNING id) SELECT * FROM x",
        ErrorCode::Syntax,
    ),
    ("WITH c AS (SELECT 1) DELETE FROM outing", ErrorCode::Denied),
    (
        "WITH c AS (SELECT 1) INSERT INTO setting VALUES ('a', 'b')",
        ErrorCode::Denied,
    ),
    (
        "WITH c AS (SELECT 1) UPDATE rower SET email = 'x'",
        ErrorCode::Denied,
    ),
    (
        "SELECT 1; DELETE FROM outing",
        ErrorCode::MultipleStatements,
    ),
    (
        "SELECT 'a;''b'; DROP TABLE outing",
        ErrorCode::MultipleStatements,
    ),
    (
        "SELECT * FROM v_outings /* ; */; PRAGMA query_only = 0",
        ErrorCode::MultipleStatements,
    ),
];

#[test]
fn writes_are_impossible_in_both_modes() {
    let db = TestDb::new();
    let before = ok(&db, Privacy::Nominative, "SELECT count(*) FROM outing").rows;
    assert_unchanged(&db, || {
        for privacy in MODES {
            for (sql, code) in WRITES {
                let error = err(&db, privacy, sql);
                assert_eq!(error.code, code, "{sql}: {error}");
            }
        }
    });
    assert_eq!(
        ok(&db, Privacy::Nominative, "SELECT count(*) FROM outing").rows,
        before
    );
    assert!(!std::path::Path::new("/tmp/rb-analytics-copy.db").exists());
}

/// Table-valued JSON functions only read their argument and stay usable.
#[test]
fn json_table_functions_are_allowed() {
    let db = TestDb::new();
    for privacy in MODES {
        let result = ok(&db, privacy, "SELECT value FROM json_each('[1, 2, 3]')");
        assert_eq!(
            result.rows,
            vec![vec![json!(1)], vec![json!(2)], vec![json!(3)]]
        );
        let result = ok(
            &db,
            privacy,
            "SELECT count(*) FROM json_tree('{\"a\": [1, 2]}')",
        );
        assert_eq!(result.rows, vec![vec![json!(4)]]);
        // Their argument is still authorized column by column.
        let result = ok(
            &db,
            privacy,
            "SELECT j.value FROM rower r, json_each(json_array(r.email, r.phone)) j",
        );
        assert!(result.rows.iter().all(|row| row[0].is_null()));
    }
}

/// Opening, hardening and creating the 11 views stays cheap.
#[test]
fn a_trivial_query_is_fast() {
    let db = TestDb::exclusive();
    let mut best = u64::MAX;
    for _ in 0..5 {
        best = best.min(ok(&db, Privacy::Nominative, "SELECT 1").elapsed_ms);
    }
    eprintln!("SELECT 1 with the views: {best} ms");
    assert!(best < 100, "{best} ms");
}

/// The layers behind the lexer hold on their own: writing statements sent
/// straight to a prepared connection (as if the lexer had a bug) are all
/// refused by the authorizer, `readonly()` or `query_only`.
#[test]
fn writes_are_refused_without_the_lexer() {
    let db = TestDb::new();
    // A writer holds uncommitted-to-main.db pages in the WAL meanwhile.
    let writer = db.writer();
    writer
        .execute_batch("PRAGMA wal_autocheckpoint = 0;")
        .unwrap();
    writer
        .execute("UPDATE boat SET name = name || ' ' WHERE id = 'boat-1'", [])
        .unwrap();
    let statements = [
        "INSERT INTO outing (id, boat_id, start_date_time, created_at, updated_at) VALUES ('x', 'boat-0', '2026-01-01T10:00', 'a', 'a')",
        "UPDATE rower SET first_name = 'x'",
        "DELETE FROM outing",
        "REPLACE INTO setting VALUES ('a', 'b')",
        "CREATE TABLE x (a)",
        "CREATE TEMP TABLE x (a)",
        "CREATE TEMP VIEW x AS SELECT 1",
        "DROP VIEW v_outings",
        "DROP TABLE outing",
        "ALTER TABLE outing ADD COLUMN x",
        "ATTACH DATABASE ':memory:' AS x",
        "DETACH DATABASE temp",
        "VACUUM",
        "VACUUM INTO '/tmp/rb-analytics-copy.db'",
        "REINDEX",
        "ANALYZE",
        "PRAGMA query_only = OFF",
        "PRAGMA writable_schema = ON",
        "PRAGMA journal_mode = DELETE",
        "PRAGMA user_version = 3",
        "PRAGMA table_info(rower)",
        "BEGIN IMMEDIATE",
        "SAVEPOINT a",
        "SELECT load_extension('x')",
        "WITH c AS (SELECT 1) DELETE FROM outing",
        "CREATE VIRTUAL TABLE x USING fts5(a)",
    ];
    let guard = || run::Guard::new(Arc::new(AtomicBool::new(false)), 5000);
    assert_unchanged(&db, || {
        for privacy in MODES {
            for sql in statements {
                let prepared = open::prepare_connection(&db.path, NOW).unwrap();
                let req = RunQueryRequest {
                    privacy,
                    ..request(sql)
                };
                let error = run::execute(
                    &prepared.conn,
                    &prepared.views,
                    &req,
                    sql,
                    privacy,
                    &guard(),
                )
                .map(|(result, _)| result.rows)
                .expect_err(sql);
                assert!(
                    matches!(error.code, ErrorCode::Denied | ErrorCode::NotReadOnly),
                    "{sql}: {error}"
                );
                // The connection still answers reads.
                let outings: i64 = prepared
                    .conn
                    .query_row("SELECT count(*) FROM outing", [], |r| r.get(0))
                    .unwrap();
                assert!(outings > 0);
            }
        }
    });
    writer
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
}

/// `query_only` and the read-only open hold even without the authorizer.
#[test]
fn connection_is_read_only_before_the_authorizer() {
    let db = TestDb::new();
    let prepared = open::prepare_connection(&db.path, NOW).unwrap();
    for sql in [
        "DELETE FROM outing",
        "CREATE TEMP TABLE x (a)",
        "PRAGMA user_version = 3",
    ] {
        let error = prepared.conn.execute_batch(sql).expect_err(sql);
        let text = error.to_string();
        assert!(
            text.contains("readonly")
                || text.contains("read-only")
                || text.contains("attempt to write"),
            "{sql}: {text}"
        );
    }
    let error = prepared
        .conn
        .execute_batch("ATTACH DATABASE ':memory:' AS x")
        .unwrap_err();
    assert!(
        error.to_string().contains("too many attached databases"),
        "{error}"
    );
}

// ---------------------------------------------------------- denied objects

#[test]
fn denied_tables_cannot_be_read_in_any_way() {
    let db = TestDb::new();
    let cases: [(&str, Option<&str>); 22] = [
        ("SELECT * FROM setting", Some("setting")),
        (
            "SELECT value FROM setting WHERE key = 'adminPasswordHash'",
            Some("setting"),
        ),
        ("SELECT count(*) FROM setting", Some("setting")),
        ("SELECT 1 FROM setting LIMIT 1", Some("setting")),
        ("SELECT EXISTS (SELECT 1 FROM setting)", Some("setting")),
        (
            "SELECT * FROM v_outings WHERE outing_id IN (SELECT key FROM setting)",
            Some("setting"),
        ),
        (
            "WITH s AS (SELECT * FROM main.setting) SELECT count(*) FROM s",
            Some("setting"),
        ),
        ("SELECT * FROM efa_record", Some("efa_record")),
        ("SELECT * FROM change_log", Some("change_log")),
        ("SELECT * FROM session", Some("session")),
        ("SELECT * FROM session_rowers", Some("session_rowers")),
        ("SELECT * FROM migration", Some("migration")),
        ("SELECT * FROM analytics_query", Some("analytics_query")),
        (
            "SELECT * FROM analytics_dashboard_item",
            Some("analytics_dashboard_item"),
        ),
        ("SELECT * FROM boat_level_config", Some("boat_level_config")),
        ("SELECT * FROM sqlite_master", Some("sqlite_master")),
        ("SELECT * FROM sqlite_schema", Some("sqlite_master")),
        (
            "SELECT sql FROM sqlite_temp_master",
            Some("sqlite_temp_master"),
        ),
        ("SELECT * FROM pragma_table_info('rower')", None),
        ("SELECT * FROM pragma_database_list", None),
        ("SELECT * FROM dbstat", None),
        ("SELECT * FROM temp.rower", None),
    ];
    for privacy in MODES {
        for (sql, object) in cases {
            let error = run_in(&db, privacy, request(sql)).expect_err(sql);
            assert!(
                matches!(error.code, ErrorCode::Denied | ErrorCode::Syntax),
                "{sql}: {error}"
            );
            if let Some(object) = object {
                assert_eq!(error.code, ErrorCode::Denied, "{sql}: {error}");
                assert_eq!(error.object.as_deref(), Some(object), "{sql}");
            }
            for marker in support::DENIED_MARKERS {
                assert!(!error.message.contains(marker), "{sql}: {}", error.message);
            }
        }
    }
    // Pragma functions are refused by the authorizer, not by a missing name.
    let error = err(
        &db,
        Privacy::Nominative,
        "SELECT name FROM pragma_table_info('rower')",
    );
    assert_eq!(error.code, ErrorCode::Denied, "{error}");
    let error = err(&db, Privacy::Nominative, "SELECT * FROM dbstat");
    assert_eq!(error.code, ErrorCode::Denied, "{error}");
}

/// No query on the allowed objects shows a denied row either.
#[test]
fn denied_rows_never_appear_in_results() {
    let db = TestDb::new();
    for privacy in MODES {
        for sql in [
            "SELECT * FROM v_settings",
            "SELECT * FROM outing",
            "SELECT * FROM rower",
            "SELECT * FROM v_outing_rowers",
        ] {
            let text = support::result_text(&ok(&db, privacy, sql));
            for marker in support::DENIED_MARKERS {
                assert!(!text.contains(marker), "{sql}: {marker}");
            }
        }
    }
}

// ----------------------------------------------------------------- privacy

fn column<'a>(result: &'a QueryResult, name: &str) -> Vec<&'a Value> {
    let index = result
        .columns
        .iter()
        .position(|c| c.name == name)
        .unwrap_or_else(|| panic!("no column {name}"));
    result.rows.iter().map(|row| &row[index]).collect()
}

fn all_null(values: &[&Value]) -> bool {
    !values.is_empty() && values.iter().all(|v| v.is_null())
}

#[test]
fn pseudonymised_mode_hides_personal_and_free_text_columns() {
    let db = TestDb::new();
    let p = Privacy::Pseudonymised;

    let result = ok(
        &db,
        p,
        "SELECT first_name, last_name, birth_date, id FROM rower",
    );
    assert!(all_null(&column(&result, "first_name")));
    assert!(all_null(&column(&result, "last_name")));
    assert!(all_null(&column(&result, "birth_date")));
    assert!(column(&result, "id").iter().all(|v| v.is_string()));
    assert_eq!(
        result.ignored_columns,
        vec!["rower.birth_date", "rower.first_name", "rower.last_name"]
    );

    let result = ok(
        &db,
        p,
        "SELECT rower_code, display_name, birth_year FROM v_rowers",
    );
    assert!(all_null(&column(&result, "display_name")));
    assert!(all_null(&column(&result, "birth_year")));
    assert!(column(&result, "rower_code").iter().all(|v| v
        .as_str()
        .is_some_and(|code| code.starts_with("R-") && code.len() == 10)));
    assert!(result
        .ignored_columns
        .contains(&"rower.first_name".to_string()));

    // No oracle through WHERE, LIKE, length or comparisons.
    for (sql, expected) in [
        (
            "SELECT count(*) FROM rower WHERE first_name = 'Anouk'",
            json!(0),
        ),
        (
            "SELECT count(*) FROM rower WHERE first_name LIKE 'A%'",
            json!(0),
        ),
        (
            "SELECT count(*) FROM rower WHERE length(last_name) > 0",
            json!(0),
        ),
        (
            "SELECT count(*) FROM rower WHERE first_name IS NOT NULL",
            json!(0),
        ),
        (
            "SELECT count(*) FROM v_rowers WHERE display_name > ''",
            json!(0),
        ),
        (
            "SELECT count(*) FROM rower WHERE birth_date < '2000'",
            json!(0),
        ),
        ("SELECT max(length(comment)) FROM outing", Value::Null),
        (
            "SELECT count(*) FROM outing WHERE comment LIKE '%SECRET%'",
            json!(0),
        ),
        (
            "SELECT count(*) FROM incident WHERE instr(message, 'S') > 0",
            json!(0),
        ),
    ] {
        let result = ok(&db, p, sql);
        assert_eq!(result.rows, vec![vec![expected.clone()]], "{sql}");
        assert!(!result.ignored_columns.is_empty(), "{sql}");
    }

    // ORDER BY a hidden column sorts by NULL: same order as no ORDER BY key.
    let by_name = ok(&db, p, "SELECT id FROM rower ORDER BY last_name, id");
    let by_id = ok(&db, p, "SELECT id FROM rower ORDER BY id");
    assert_eq!(by_name.rows, by_id.rows);
    assert!(by_name
        .ignored_columns
        .contains(&"rower.last_name".to_string()));

    // A CTE named like a view cannot read birth dates either.
    let result = ok(
        &db,
        p,
        "WITH v_rowers AS (SELECT birth_date AS display_name, first_name || last_name AS rower_code FROM rower) SELECT * FROM v_rowers",
    );
    assert!(all_null(&column(&result, "display_name")));
    assert!(all_null(&column(&result, "rower_code")));

    // Free text, directly and through the views.
    for (sql, name) in [
        ("SELECT comment FROM outing", "comment"),
        ("SELECT comment FROM v_outings", "comment"),
        ("SELECT message FROM v_incidents", "message"),
        ("SELECT description FROM v_damages", "description"),
        ("SELECT repair_note FROM boat_damage", "repair_note"),
        ("SELECT note FROM boat", "note"),
        ("SELECT note FROM route", "note"),
        ("SELECT display_name FROM v_outing_rowers", "display_name"),
        ("SELECT age_in_year FROM v_outing_rowers", "age_in_year"),
    ] {
        let result = ok(&db, p, sql);
        assert!(all_null(&column(&result, name)), "{sql}");
    }

    // Whole tables and views: no marker, no name anywhere.
    for sql in [
        "SELECT * FROM rower",
        "SELECT * FROM outing",
        "SELECT * FROM incident",
        "SELECT * FROM boat_damage",
        "SELECT * FROM boat",
        "SELECT * FROM route",
        "SELECT * FROM v_rowers",
        "SELECT * FROM v_outings",
        "SELECT * FROM v_outing_rowers",
        "SELECT * FROM v_incidents",
        "SELECT * FROM v_damages",
        "SELECT group_concat(first_name || last_name || email || note) FROM rower",
    ] {
        let text = support::result_text(&ok(&db, p, sql));
        for marker in support::CONTACT_MARKERS
            .iter()
            .chain(support::FREE_TEXT_MARKERS.iter())
            .chain(support::FIRST_NAMES.iter())
            .chain(support::LAST_NAMES.iter())
        {
            assert!(!text.contains(marker), "{sql} leaks {marker}");
        }
    }
}

/// Review A, M2: a private boat's owner is usually a member's name, and
/// a group name can name a family: personal, like the rowers' names.
#[test]
fn boat_owners_and_group_names_are_personal() {
    let db = TestDb::new();
    db.writer()
        .execute(
            "UPDATE boat SET owner = 'Anouk Abgrall' WHERE id = 'boat-0'",
            [],
        )
        .unwrap();
    let hidden = ok(
        &db,
        Privacy::Pseudonymised,
        "SELECT b.owner AS a, v.owner AS b, g.name AS c FROM boat b \
         JOIN v_boats v ON v.boat_id = b.id, rower_group g WHERE b.id = 'boat-0'",
    );
    assert_eq!(
        hidden.rows,
        vec![vec![Value::Null, Value::Null, Value::Null]]
    );
    for ignored in ["boat.owner", "rower_group.name"] {
        assert!(
            hidden.ignored_columns.contains(&ignored.to_string()),
            "{:?}",
            hidden.ignored_columns
        );
    }
    let named = ok(
        &db,
        Privacy::Nominative,
        "SELECT owner, (SELECT name FROM rower_group) FROM v_boats WHERE boat_id = 'boat-0'",
    );
    assert_eq!(
        named.rows,
        vec![vec![json!("Anouk Abgrall"), json!("Loisir")]]
    );
}

#[test]
fn nominative_mode_reads_names_but_never_contact_columns() {
    let db = TestDb::new();
    let n = Privacy::Nominative;
    let result = ok(&db, n, "SELECT first_name, last_name, birth_date, email, phone, address, license_number, note FROM rower ORDER BY id");
    assert_eq!(column(&result, "first_name")[0], &json!("Anouk"));
    assert_eq!(column(&result, "last_name")[0], &json!("Abgrall"));
    assert!(column(&result, "birth_date")[0].is_string());
    for contact in ["email", "phone", "address", "license_number", "note"] {
        assert!(all_null(&column(&result, contact)), "{contact}");
    }
    assert_eq!(
        result.ignored_columns,
        vec![
            "rower.address",
            "rower.email",
            "rower.license_number",
            "rower.note",
            "rower.phone"
        ]
    );
    let result = ok(
        &db,
        n,
        "SELECT display_name FROM v_rowers WHERE rower_id LIKE 'a1b2c300%'",
    );
    assert_eq!(result.rows, vec![vec![json!("Anouk Abgrall")]]);
    assert!(result.ignored_columns.is_empty());
    let result = ok(
        &db,
        n,
        "SELECT count(*) FROM rower WHERE email LIKE '%@%' OR phone IS NOT NULL",
    );
    assert_eq!(result.rows, vec![vec![json!(0)]]);

    for sql in [
        "SELECT * FROM rower",
        "SELECT * FROM v_rowers",
        "SELECT group_concat(email || phone || address || license_number || note) FROM rower",
    ] {
        let text = support::result_text(&ok(&db, n, sql));
        for marker in support::CONTACT_MARKERS {
            assert!(!text.contains(marker), "{sql} leaks {marker}");
        }
    }
    // Free text is readable in nominative mode.
    let text = support::result_text(&ok(&db, n, "SELECT comment FROM v_outings LIMIT 1"));
    assert!(text.contains("COMMENT-SECRET"));
}

#[test]
fn select_star_works_in_both_modes() {
    let db = TestDb::new();
    for privacy in MODES {
        let result = ok(&db, privacy, "SELECT * FROM rower");
        assert_eq!(result.columns.len(), 19);
        assert_eq!(result.rows.len(), 13);
    }
}

/// The views read only public, personal and free-text base columns: in
/// nominative mode nothing is ignored, in pseudonymised mode only what the
/// dictionary marks personal or free text.
#[test]
fn views_read_only_classified_columns() {
    let db = TestDb::new();
    let objects = engine::list_objects(&ctx(&db, Privacy::Nominative)).unwrap();
    assert_eq!(objects.views.len(), 11);
    let private: Vec<&str> = vec![
        "boat.note",
        "boat.owner",
        "boat_damage.description",
        "boat_damage.repair_note",
        "incident.message",
        "outing.comment",
        "route.note",
        "rower.birth_date",
        "rower.first_name",
        "rower.last_name",
    ];
    for view in &objects.views {
        let sql = format!("SELECT * FROM {view}");
        let nominative = ok(&db, Privacy::Nominative, &sql);
        assert!(
            nominative.ignored_columns.is_empty(),
            "{view}: {:?}",
            nominative.ignored_columns
        );
        let pseudonymised = ok(&db, Privacy::Pseudonymised, &sql);
        for ignored in &pseudonymised.ignored_columns {
            assert!(private.contains(&ignored.as_str()), "{view}: {ignored}");
        }
    }
}

/// A column added by a later migration is private until the dictionary
/// classifies it.
#[test]
fn unclassified_columns_read_as_null() {
    let db = TestDb::new();
    db.writer()
        .execute_batch("ALTER TABLE rower ADD COLUMN health_note TEXT; UPDATE rower SET health_note = 'HEALTH-SECRET';")
        .unwrap();
    for privacy in MODES {
        let result = ok(&db, privacy, "SELECT health_note, * FROM rower");
        assert!(all_null(&column(&result, "health_note")));
        assert!(!support::result_text(&result).contains("HEALTH-SECRET"));
        assert!(result
            .ignored_columns
            .contains(&"rower.health_note".to_string()));
    }
}

/// The context's privacy wins over a request asking for more (MCP).
#[test]
fn a_request_cannot_widen_the_context_privacy() {
    let db = TestDb::new();
    let state = EngineState::new();
    let req = RunQueryRequest {
        privacy: Privacy::Nominative,
        ..request("SELECT first_name FROM rower")
    };
    let result = engine::run_query(&state, &ctx(&db, Privacy::Pseudonymised), &req).unwrap();
    assert!(all_null(&column(&result, "first_name")));
}

/// Plan risk 12: a statement prepared in nominative mode must not be
/// reused in pseudonymised mode (Python's statement cache did it). Same
/// state, same SQL, cache on.
#[test]
fn privacy_modes_never_share_a_statement_or_a_cached_result() {
    let db = TestDb::new();
    let state = EngineState::new();
    let sql = "SELECT display_name FROM v_rowers ORDER BY rower_id LIMIT 1";
    let run = |privacy: Privacy| {
        let req = RunQueryRequest {
            privacy,
            use_cache: true,
            ..request(sql)
        };
        engine::run_query(&state, &ctx(&db, privacy), &req).unwrap()
    };
    let named = run(Privacy::Nominative);
    assert_eq!(named.rows, vec![vec![json!("Anouk Abgrall")]]);
    let hidden = run(Privacy::Pseudonymised);
    assert!(!hidden.cached);
    assert_eq!(hidden.rows, vec![vec![Value::Null]]);
    let hidden_again = run(Privacy::Pseudonymised);
    assert!(hidden_again.cached);
    assert_eq!(hidden_again.rows, vec![vec![Value::Null]]);
    assert_eq!(run(Privacy::Nominative).rows, named.rows);
}

// ----------------------------------------------------------------- reports

fn report_params(id: &str) -> serde_json::Map<String, Value> {
    let entry = catalog().into_iter().find(|e| e.id == id);
    let mut params = serde_json::Map::new();
    if let Some(defs) = entry.as_ref().and_then(|e| e.params.as_array()) {
        for def in defs {
            let name = def["name"].as_str().unwrap().to_string();
            let value = match &def["default"] {
                Value::String(s) if s == "current" => json!(CURRENT_SEASON),
                other => other.clone(),
            };
            params.insert(name, value);
        }
    }
    params
}

#[test]
fn every_report_runs_in_both_modes() {
    let db = TestDb::new();
    let blocks = report_blocks();
    assert!(blocks.len() >= 2);
    assert_unchanged(&db, || {
        for block in &blocks {
            for privacy in MODES {
                for season in [CURRENT_SEASON, CURRENT_SEASON - 1] {
                    let mut req = request(&block.sql);
                    req.params = report_params(&block.name);
                    if req.params.contains_key("season") {
                        req.params.insert("season".into(), json!(season));
                    }
                    let result = run_in(&db, privacy, req)
                        .unwrap_or_else(|e| panic!("{} [{privacy:?}]: {e}", block.name));
                    assert!(!result.columns.is_empty(), "{}", block.name);
                    let text = support::result_text(&result);
                    for marker in support::CONTACT_MARKERS
                        .iter()
                        .chain(support::DENIED_MARKERS.iter())
                    {
                        assert!(!text.contains(marker), "{} leaks {marker}", block.name);
                    }
                    if privacy == Privacy::Pseudonymised {
                        for marker in support::FREE_TEXT_MARKERS
                            .iter()
                            .chain(support::FIRST_NAMES.iter())
                            .chain(support::LAST_NAMES.iter())
                        {
                            assert!(!text.contains(marker), "{} leaks {marker}", block.name);
                        }
                    }
                }
            }
        }
    });
    let mut req = request(
        &report_blocks()
            .into_iter()
            .find(|b| b.name == "season-overview")
            .unwrap()
            .sql,
    );
    req.params = report_params("season-overview");
    let result = run_in(&db, Privacy::Nominative, req).unwrap();
    assert!(
        column(&result, "outings")[0].as_i64().unwrap() > 50,
        "{:?}",
        result.rows
    );
}

// -------------------------------------------------------- timeouts, cancel

const ENDLESS: &str =
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c";

#[test]
fn an_endless_query_stops_at_its_timeout() {
    let db = TestDb::exclusive();
    let req = RunQueryRequest {
        timeout_ms: 500,
        ..request(ENDLESS)
    };
    let started = Instant::now();
    let error = run_in(&db, Privacy::Nominative, req).unwrap_err();
    let elapsed = started.elapsed();
    assert_eq!(error.code, ErrorCode::Timeout, "{error}");
    assert!(elapsed >= Duration::from_millis(500), "{elapsed:?}");
    assert!(elapsed < Duration::from_millis(700), "{elapsed:?}");
}

#[test]
fn cancel_from_another_thread_stops_a_query() {
    let db = TestDb::new();
    let state = Arc::new(EngineState::new());
    let req = RunQueryRequest {
        timeout_ms: 30_000,
        ..request(ENDLESS)
    };
    let id = req.request_id.clone();
    let canceller = {
        let state = Arc::clone(&state);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            engine::cancel(&state, &id);
        })
    };
    let started = Instant::now();
    let error = engine::run_query(&state, &ctx(&db, Privacy::Nominative), &req).unwrap_err();
    canceller.join().unwrap();
    assert_eq!(error.code, ErrorCode::Cancelled, "{error}");
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(state.cancels.lock().unwrap().is_empty(), "flag removed");
}

#[test]
fn a_cancel_received_before_the_query_stops_it() {
    let db = TestDb::new();
    let state = EngineState::new();
    let req = request("SELECT 1");
    engine::cancel(&state, &req.request_id);
    let error = engine::run_query(&state, &ctx(&db, Privacy::Nominative), &req).unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    // A later run with another id is not affected.
    assert!(
        engine::run_query(&state, &ctx(&db, Privacy::Nominative), &request("SELECT 1")).is_ok()
    );
}

// ------------------------------------------------------------------ limits

#[test]
fn limits_stop_oversized_queries_and_results() {
    let db = TestDb::new();
    let n = Privacy::Nominative;

    let long = format!("SELECT '{}'", "x".repeat(200_000));
    let error = err(&db, n, &long);
    assert_eq!(error.code, ErrorCode::Syntax);
    assert!(error.message.contains("too long"), "{error}");

    for sql in [
        "SELECT randomblob(2e9)",
        "SELECT length(zeroblob(2000000000))",
        "SELECT length(replace(hex(zeroblob(6000000)), '0', 'ab'))",
    ] {
        let error = err(&db, n, sql);
        assert_eq!(error.code, ErrorCode::TooLarge, "{sql}: {error}");
    }

    let deep = format!("SELECT 1{}", " + 1".repeat(300));
    assert_eq!(err(&db, n, &deep).code, ErrorCode::Syntax);
    let compound = vec!["SELECT 1"; 60].join(" UNION ALL ");
    assert_eq!(err(&db, n, &compound).code, ErrorCode::Syntax);
    let wide = format!(
        "SELECT {}",
        (0..201)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    assert_eq!(err(&db, n, &wide).code, ErrorCode::Syntax);

    // 8 MB of JSON: 5000 rows of 2000 characters (cut to 1000 each, twice).
    let error = err(
        &db,
        n,
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5000) SELECT printf('%.*c', 2000, 'a') AS a, printf('%.*c', 2000, 'b') AS b, printf('%.*c', 2000, 'c') AS c, x FROM c",
    );
    assert_eq!(error.code, ErrorCode::TooLarge, "{error}");
}

// The memory budget and the heap limits: `tests/memory.rs`, a process
// of their own (SQLite counts the memory of the whole process).

#[test]
fn rows_stop_at_max_rows() {
    let db = TestDb::new();
    let sql = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5001) SELECT x FROM c";
    let result = ok(&db, Privacy::Nominative, sql);
    assert_eq!(result.rows.len(), 5000);
    assert!(result.truncated);
    assert_eq!(result.rows[4999], vec![json!(5000)]);
    // Économe clamps maxRows to 5000; above the absolute bound it is refused.
    let clamped = run_in(
        &db,
        Privacy::Nominative,
        RunQueryRequest {
            max_rows: 5001,
            ..request(sql)
        },
    )
    .unwrap();
    assert_eq!(clamped.rows.len(), 5000, "clamped to Économe's 5000");
    assert!(clamped.truncated);
    let refused = run_in(
        &db,
        Privacy::Nominative,
        RunQueryRequest {
            max_rows: run::MAX_ROWS + 1,
            ..request(sql)
        },
    )
    .unwrap_err();
    assert_eq!(refused.code, ErrorCode::Internal);
    let small = run_in(
        &db,
        Privacy::Nominative,
        RunQueryRequest {
            max_rows: 3,
            ..request("VALUES (1), (2), (3)")
        },
    )
    .unwrap();
    assert_eq!(small.rows.len(), 3);
    assert!(!small.truncated);
}

/// The context's profile clamps each request (rows and time) and sets
/// the result size; the memory limits stay Économe's here, since the heap
/// limit is process-wide and the other tests of this binary check it.
#[test]
fn the_profile_of_the_context_clamps_every_request() {
    use rb_analytics::perf;
    let db = TestDb::new();
    let state = EngineState::new();
    let wider = EngineContext {
        limits: perf::PerformanceLimits {
            max_rows: 6_000,
            max_timeout_ms: 400,
            result_bytes: 1024 * 1024,
            ..perf::ECONOMY
        },
        ..ctx(&db, Privacy::Nominative)
    };
    let rows = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 7000) SELECT x FROM c";
    let result = engine::run_query(
        &state,
        &wider,
        &RunQueryRequest {
            max_rows: 7_000,
            ..request(rows)
        },
    )
    .unwrap();
    assert_eq!(result.rows.len(), 6_000);
    assert!(result.truncated);

    // A request asking for 20 s gets the profile's 400 ms.
    let endless =
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n";
    let started = Instant::now();
    let error = engine::run_query(
        &state,
        &wider,
        &RunQueryRequest {
            timeout_ms: 20_000,
            ..request(endless)
        },
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Timeout, "{error}");
    assert!(error.message.contains("400 ms"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(5));

    // 1 MB of result instead of 8.
    let big = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000) SELECT printf('%.*c', 900, 'a') AS a FROM c";
    let error = engine::run_query(&state, &wider, &request(big)).unwrap_err();
    assert_eq!(error.code, ErrorCode::TooLarge, "{error}");
    assert!(error.message.contains("exceeds 1 MB"), "{error}");
    assert!(ok(&db, Privacy::Nominative, big).rows.len() == 2000);
}

// ------------------------------------------------------------------ values

#[test]
fn values_are_converted_for_javascript() {
    let db = TestDb::new();
    let result = ok(
        &db,
        Privacy::Nominative,
        "SELECT 9007199254740991 AS safe, 9007199254740993 AS big, -9007199254740993 AS neg, \
         1.5 AS real, 0.0 / 0 AS nan, 1e999 AS inf, -1e999 AS ninf, x'00ff10' AS blob, \
         printf('%.*c', 1500, 'z') AS long, 'été 🚣' AS text, NULL AS empty, 2 = 2 AS bool",
    );
    let row = &result.rows[0];
    assert_eq!(row[0], json!(9007199254740991i64));
    assert_eq!(row[1], json!("9007199254740993"));
    assert_eq!(row[2], json!("-9007199254740993"));
    assert_eq!(row[3], json!(1.5));
    assert_eq!(row[4], Value::Null);
    assert_eq!(row[5], Value::Null);
    assert_eq!(row[6], Value::Null);
    assert_eq!(row[7], json!("[blob 3 octets]"));
    assert_eq!(row[8], json!(format!("{}…", "z".repeat(1000))));
    assert_eq!(row[9], json!("été 🚣"));
    assert_eq!(row[10], Value::Null);
    assert_eq!(row[11], json!(1));
}

#[test]
fn columns_keep_duplicate_names_and_declared_types() {
    let db = TestDb::new();
    let result = ok(
        &db,
        Privacy::Nominative,
        "SELECT b.name, r.name, b.build_year, 1 AS name FROM boat b JOIN route r LIMIT 1",
    );
    let names: Vec<&str> = result.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["name", "name", "build_year", "name"]);
    let types: Vec<Option<&str>> = result
        .columns
        .iter()
        .map(|c| c.decl_type.as_deref())
        .collect();
    assert_eq!(
        types,
        vec![Some("TEXT"), Some("TEXT"), Some("INTEGER"), None]
    );
    assert_eq!(result.rows[0].len(), 4);
}

#[test]
fn named_parameters_are_bound() {
    let db = TestDb::new();
    let n = Privacy::Nominative;
    let req = with_params(
        request("SELECT :a, @b, $c, :missing IS NULL, :flag, :real, :a"),
        &[
            ("a", json!("x'); DROP TABLE outing; --")),
            ("b", json!(2025)),
            ("c", json!(null)),
            ("flag", json!(true)),
            ("real", json!(2.5)),
            ("unused", json!(1)),
        ],
    );
    let result = run_in(&db, n, req).unwrap();
    assert_eq!(
        result.rows[0],
        vec![
            json!("x'); DROP TABLE outing; --"),
            json!(2025),
            Value::Null,
            json!(1),
            json!(1),
            json!(2.5),
            json!("x'); DROP TABLE outing; --")
        ]
    );
    let bad = with_params(request("SELECT :a"), &[("a", json!([1, 2]))]);
    let error = run_in(&db, n, bad).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParam);
    assert_eq!(error.object.as_deref(), Some("a"));
    let bad_name = with_params(request("SELECT 1"), &[("A; DROP", json!(1))]);
    assert_eq!(
        run_in(&db, n, bad_name).unwrap_err().code,
        ErrorCode::InvalidParam
    );
    let season = with_params(
        request("SELECT count(*) FROM v_outings WHERE season = :season"),
        &[("season", json!(CURRENT_SEASON))],
    );
    assert!(run_in(&db, n, season).unwrap().rows[0][0].as_i64().unwrap() > 0);
}

#[test]
fn syntax_errors_carry_utf16_offsets() {
    let db = TestDb::new();
    let sql = "SELECT 'été 🚣' AS x FORM v_outings";
    let error = err(&db, Privacy::Nominative, sql);
    assert_eq!(error.code, ErrorCode::Syntax);
    let expected = sql[..sql.find("FORM").unwrap()].encode_utf16().count();
    // SQLite points at the token it could not parse ("v_outings" after FORM).
    let offset = error.offset.expect("offset");
    assert!(
        offset >= expected && offset <= expected + 5,
        "{offset} vs {expected}: {error}"
    );
    let error = err(&db, Privacy::Nominative, "SELECT nope FROM v_outings");
    assert_eq!(error.code, ErrorCode::Syntax);
    assert!(error.message.contains("nope"), "{error}");
    let error = err(&db, Privacy::Nominative, "SELECT * FROM v_unknown");
    assert_eq!(error.code, ErrorCode::Syntax);
}

// ------------------------------------------------------- views and objects

#[test]
fn views_need_their_tables() {
    let without = TestDb::with(Options {
        damages: false,
        ..Options::default()
    });
    let objects = engine::list_objects(&ctx(&without, Privacy::Nominative)).unwrap();
    assert_eq!(objects.missing_views, vec!["v_damages"]);
    assert_eq!(objects.views.len(), 10);
    assert!(!objects.tables.contains(&"boat_damage".to_string()));
    assert!(objects.tables.contains(&"rower".to_string()));
    let error = err(&without, Privacy::Nominative, "SELECT * FROM v_damages");
    assert_eq!(error.code, ErrorCode::Syntax, "{error}");
    let error = err(&without, Privacy::Nominative, "SELECT * FROM boat_damage");
    assert_eq!(error.code, ErrorCode::Syntax, "{error}");

    let with = TestDb::new();
    let objects = engine::list_objects(&ctx(&with, Privacy::Nominative)).unwrap();
    assert!(objects.missing_views.is_empty());
    assert_eq!(
        objects.views,
        vec![
            "v_settings",
            "v_boats",
            "v_rowers",
            "v_routes",
            "v_outing_types",
            "v_outings",
            "v_outing_rowers",
            "v_seasons",
            "v_days",
            "v_incidents",
            "v_damages"
        ]
    );
    let expected_tables: Vec<String> = [
        "boat",
        "boat_configuration",
        "rower",
        "route",
        "outing_type",
        "outing",
        "outing_crew",
        "incident",
        "rower_group",
        "rower_group_member",
        "boat_damage",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(objects.tables, expected_tables);
    assert!(
        ok(&with, Privacy::Nominative, "SELECT count(*) FROM v_damages").rows[0][0]
            .as_i64()
            .unwrap()
            > 0
    );
}

#[test]
fn an_empty_database_gets_the_views_too() {
    let db = TestDb::with(Options {
        seed: false,
        season_start_month: None,
        ..Options::default()
    });
    for view in engine::list_objects(&ctx(&db, Privacy::Nominative))
        .unwrap()
        .views
    {
        let result = ok(
            &db,
            Privacy::Pseudonymised,
            &format!("SELECT * FROM {view}"),
        );
        // v_settings, v_seasons and v_days always have rows; v_outing_types
        // lists the built-in types of the migration.
        if [
            "v_boats",
            "v_rowers",
            "v_routes",
            "v_outings",
            "v_outing_rowers",
            "v_incidents",
            "v_damages",
        ]
        .contains(&view.as_str())
        {
            assert!(result.rows.is_empty(), "{view}");
        }
    }
    let settings = ok(
        &db,
        Privacy::Nominative,
        "SELECT season_start_month, now, today, current_season FROM v_settings",
    );
    assert_eq!(
        settings.rows[0],
        vec![json!(8), json!(NOW), json!("2026-06-20"), json!(2025)]
    );
}

#[test]
fn the_season_start_month_setting_is_applied() {
    let db = TestDb::with(Options {
        season_start_month: Some("9"),
        ..Options::default()
    });
    let result = ok(
        &db,
        Privacy::Nominative,
        "SELECT season_start_month, current_season FROM v_settings",
    );
    assert_eq!(result.rows[0], vec![json!(9), json!(2025)]);
    let result = ok(&db, Privacy::Nominative, "SELECT DISTINCT season FROM v_outings WHERE start_date BETWEEN '2025-08-01' AND '2025-08-31'");
    assert_eq!(
        result.rows,
        vec![vec![json!(2024)]],
        "August belongs to the previous season"
    );
    let january = TestDb::with(Options {
        season_start_month: Some("1"),
        ..Options::default()
    });
    let result = ok(
        &january,
        Privacy::Nominative,
        "SELECT current_season FROM v_settings",
    );
    assert_eq!(result.rows[0], vec![json!(2026)]);
}

#[test]
fn a_missing_database_is_an_error_and_is_not_created() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nothing.db");
    let state = EngineState::new();
    let context = EngineContext::economy(path.clone(), Privacy::Nominative);
    let error = engine::run_query(&state, &context, &request("SELECT 1")).unwrap_err();
    assert_eq!(error.code, ErrorCode::Internal);
    assert!(engine::list_objects(&context).is_err());
    assert!(!path.exists());
}

// --------------------------------------------------------------------- WAL

/// Readers never block the boathouse: a writer keeps inserting while 20
/// engine runs read the same database.
#[test]
fn concurrent_runs_never_block_a_writer() {
    let db = TestDb::exclusive();
    let stop = Arc::new(AtomicBool::new(false));
    // Stops the writer even when an assertion below fails: it would keep
    // inserting until the test binary ends otherwise.
    struct StopOnDrop(Arc<AtomicBool>);
    impl Drop for StopOnDrop {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Relaxed);
        }
    }
    let _stop_writer = StopOnDrop(Arc::clone(&stop));
    // The writer connection is set up before any reader starts, with the
    // default busy timeout: a brand-new connection's first schema read can
    // get a transient SQLITE_BUSY while 20 others open the WAL index
    // (review A, L7), and that says nothing about readers blocking writes.
    let conn = rusqlite::Connection::open(&db.path).unwrap();
    conn.execute_batch("PRAGMA synchronous = NORMAL;").unwrap();
    let _: i64 = conn
        .query_row("SELECT count(*) FROM outing", [], |row| row.get(0))
        .unwrap();
    // From here on, no busy wait at all: a lock held by a reader would
    // fail an insert instead of slowing it down.
    conn.busy_timeout(Duration::ZERO).unwrap();
    let writer = {
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            let mut times = Vec::new();
            let mut count = 0;
            while !stop.load(Ordering::Relaxed) || count < 50 {
                let started = Instant::now();
                conn.execute(
                    "INSERT INTO outing (id, boat_id, start_date_time, end_date_time, created_at, updated_at)
                     VALUES (?1, 'boat-0', '2026-06-20T08:00', '2026-06-20T09:00', 'x', 'x')",
                    [format!("w-{count}")],
                )
                .expect("an insert never waits for a reader (busy_timeout 0)");
                times.push(started.elapsed());
                count += 1;
            }
            times
        })
    };
    let readers: Vec<_> = (0..20)
        .map(|i| {
            let path = db.path.clone();
            std::thread::spawn(move || {
                let state = EngineState::new();
                let context = EngineContext::economy(path, if i % 2 == 0 { Privacy::Nominative } else { Privacy::Pseudonymised });
                for _ in 0..3 {
                    let result = engine::run_query(
                        &state,
                        &context,
                        &request("SELECT boat_name, count(*), sum(duration_min) FROM v_outings GROUP BY boat_name"),
                    )
                    .unwrap();
                    assert!(!result.rows.is_empty());
                }
            })
        })
        .collect();
    for reader in readers {
        reader.join().unwrap();
    }
    stop.store(true, Ordering::Relaxed);
    let mut times = writer.join().unwrap();
    assert!(times.len() >= 50);
    times.sort();
    // Every insert succeeded without any busy wait, which is the proof
    // that readers hold no lock against the writer. Timing on a shared,
    // loaded test machine (debug SQLite, 20 reader threads on few cores)
    // gets scheduler outliers, so the 50 ms bound applies to the 95th
    // percentile; the worst insert stays far below the 2 s busy timeout.
    let p95 = times[times.len() * 95 / 100];
    let worst = *times.last().unwrap();
    assert!(p95 < Duration::from_millis(50), "95th percentile {p95:?}");
    assert!(
        worst < Duration::from_millis(500),
        "slowest insert {worst:?}"
    );
}

#[test]
fn a_locked_database_answers_busy() {
    let db = TestDb::with(Options {
        wal: false,
        ..Options::default()
    });
    let locker = db.writer();
    locker
        .execute_batch("BEGIN EXCLUSIVE; UPDATE boat SET name = name;")
        .unwrap();
    let started = Instant::now();
    let error = err(&db, Privacy::Nominative, "SELECT count(*) FROM outing");
    assert_eq!(error.code, ErrorCode::Busy, "{error}");
    assert!(started.elapsed() >= Duration::from_millis(1900));
    locker.execute_batch("ROLLBACK;").unwrap();
    ok(&db, Privacy::Nominative, "SELECT count(*) FROM outing");
}

/// Copies the database with its WAL (holding committed changes that are
/// not in main.db yet) into a new folder, optionally with the -shm file,
/// then makes the folder and the files read-only.
#[cfg(unix)]
fn read_only_copy(db: &TestDb, with_shm: bool) -> (tempfile::TempDir, std::path::PathBuf, bool) {
    use std::os::unix::fs::PermissionsExt;

    let writer = db.writer();
    writer
        .execute_batch("PRAGMA wal_autocheckpoint = 0;")
        .unwrap();
    writer
        .execute(
            "UPDATE boat SET name = 'Skiff Odet WAL' WHERE id = 'boat-0'",
            [],
        )
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let copy = dir.path().join("main.db");
    // Copied while the writer holds them (no checkpoint on close).
    std::fs::copy(&db.path, &copy).unwrap();
    std::fs::copy(
        db.path.with_extension("db-wal"),
        copy.with_extension("db-wal"),
    )
    .unwrap();
    if with_shm {
        std::fs::copy(
            db.path.with_extension("db-shm"),
            copy.with_extension("db-shm"),
        )
        .unwrap();
    }
    drop(writer);
    for file in std::fs::read_dir(dir.path()).unwrap() {
        std::fs::set_permissions(file.unwrap().path(), std::fs::Permissions::from_mode(0o444))
            .unwrap();
    }
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let privileged = std::fs::write(dir.path().join("probe"), b"x").is_ok();
    if privileged {
        let _ = std::fs::remove_file(dir.path().join("probe"));
        eprintln!("privileged user: folder permissions are ignored, the read-only case is only exercised as a normal user");
    }
    (dir, copy, privileged)
}

#[cfg(unix)]
fn restore_permissions(dir: &tempfile::TempDir) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// The realistic read-only case (the MCP server sandboxed with read access
/// to the app folder while the app runs): main.db, -wal and -shm exist, the
/// folder and the files are read-only. The WAL content is read and nothing
/// is written.
#[cfg(unix)]
#[test]
fn a_read_only_folder_with_its_wal_files_opens() {
    let db = TestDb::new();
    let (dir, copy, _) = read_only_copy(&db, true);
    let before = (
        std::fs::read(&copy).unwrap(),
        std::fs::read(copy.with_extension("db-wal")).unwrap(),
    );
    let state = EngineState::new();
    let context = EngineContext::economy(copy.clone(), Privacy::Nominative);
    let result = engine::run_query(
        &state,
        &context,
        &request("SELECT boat_name FROM v_boats WHERE boat_id = 'boat-0'"),
    );
    let objects = engine::list_objects(&context);
    let after = (
        std::fs::read(&copy).unwrap(),
        std::fs::read(copy.with_extension("db-wal")).unwrap(),
    );
    restore_permissions(&dir);
    assert_eq!(
        result.unwrap().rows,
        vec![vec![json!("Skiff Odet WAL")]],
        "WAL content is read"
    );
    assert_eq!(objects.unwrap().views.len(), 11);
    assert!(after == before, "nothing written");
}

/// A -wal without -shm in a read-only folder (plan risk 13). As a normal
/// user no SQLite mode can read it: the engine says why instead of
/// returning stale data from main.db alone. As root (folder permissions
/// ignored) it simply opens. The fallback decision itself is unit-tested
/// in `open.rs`.
#[cfg(unix)]
#[test]
fn a_wal_without_shm_in_a_read_only_folder_is_never_read_stale() {
    let db = TestDb::new();
    let (dir, copy, privileged) = read_only_copy(&db, false);
    let before = std::fs::read(&copy).unwrap();
    let state = EngineState::new();
    let context = EngineContext::economy(copy.clone(), Privacy::Nominative);
    let result = engine::run_query(
        &state,
        &context,
        &request("SELECT boat_name FROM v_boats WHERE boat_id = 'boat-0'"),
    );
    let after = std::fs::read(&copy).unwrap();
    restore_permissions(&dir);
    assert!(after == before, "main.db untouched");
    match result {
        Ok(result) => {
            assert!(
                privileged,
                "only a privileged user can create the -shm file here"
            );
            assert_eq!(
                result.rows,
                vec![vec![json!("Skiff Odet WAL")]],
                "WAL content is read"
            );
        }
        Err(error) => {
            assert!(!privileged, "{error}");
            assert_eq!(error.code, ErrorCode::Internal);
            assert!(error.message.contains("-shm"), "{error}");
        }
    }
}

// ------------------------------------------------------------------- cache

/// Demo mode (ADR 0009): `main.db` and `demo.db` share one engine state
/// (and its result cache), so the same SQL on two files must never serve
/// one's result for the other, even when both stamps look alike.
#[test]
fn the_cache_never_serves_one_database_for_another() {
    let main = TestDb::new();
    let demo = TestDb::new();
    demo.writer()
        .execute(
            "INSERT INTO outing (id, boat_id, start_date_time, created_at, updated_at) VALUES ('demo-only', 'boat-0', '2026-06-20T08:00', 'x', 'x')",
            [],
        )
        .unwrap();
    let state = EngineState::new();
    let cached = RunQueryRequest {
        use_cache: true,
        ..request("SELECT count(*) FROM v_outings")
    };
    let count = |db: &TestDb| {
        let result = engine::run_query(&state, &ctx(db, Privacy::Nominative), &cached).unwrap();
        (result.cached, result.rows[0][0].as_i64().unwrap())
    };
    let (cached_first, main_count) = count(&main);
    assert!(!cached_first);
    let (cached_demo, demo_count) = count(&demo);
    assert!(!cached_demo, "the other file starts its own entry");
    assert_eq!(demo_count, main_count + 1);
    // Back and forth: each file hits its own entry.
    assert_eq!(count(&main), (true, main_count));
    assert_eq!(count(&demo), (true, demo_count));
}

#[test]
fn results_are_cached_until_the_database_changes() {
    let db = TestDb::new();
    let state = EngineState::new();
    let context = ctx(&db, Privacy::Nominative);
    let cached = |sql: &str| RunQueryRequest {
        use_cache: true,
        ..request(sql)
    };
    let sql = "SELECT count(*) FROM v_outings";
    let first = engine::run_query(&state, &context, &cached(sql)).unwrap();
    assert!(!first.cached);
    let second = engine::run_query(&state, &context, &cached(sql)).unwrap();
    assert!(second.cached);
    assert_eq!(second.rows, first.rows);
    // `useCache: false` always runs (and refreshes the entry).
    let fresh = engine::run_query(&state, &context, &request(sql)).unwrap();
    assert!(!fresh.cached);

    // Another connection commits: the next run is fresh.
    db.writer()
        .execute(
            "INSERT INTO outing (id, boat_id, start_date_time, created_at, updated_at) VALUES ('new', 'boat-0', '2026-06-20T08:00', 'x', 'x')",
            [],
        )
        .unwrap();
    let after = engine::run_query(&state, &context, &cached(sql)).unwrap();
    assert!(!after.cached);
    assert_eq!(
        after.rows[0][0].as_i64().unwrap(),
        first.rows[0][0].as_i64().unwrap() + 1
    );
    assert!(
        engine::run_query(&state, &context, &cached(sql))
            .unwrap()
            .cached
    );

    // Parameters, maxRows and the hour of `now` are part of the key.
    let with_param = with_params(cached("SELECT :x"), &[("x", json!(1))]);
    assert!(
        !engine::run_query(&state, &context, &with_param)
            .unwrap()
            .cached
    );
    let other_param = with_params(cached("SELECT :x"), &[("x", json!(2))]);
    let other = engine::run_query(&state, &context, &other_param).unwrap();
    assert!(!other.cached);
    assert_eq!(other.rows, vec![vec![json!(2)]]);
    let later = RunQueryRequest {
        now: "2026-06-20T10:01".into(),
        ..cached(sql)
    };
    assert!(!engine::run_query(&state, &context, &later).unwrap().cached);
    let same_hour = RunQueryRequest {
        now: "2026-06-20T10:59".into(),
        ..cached(sql)
    };
    assert!(
        engine::run_query(&state, &context, &same_hour)
            .unwrap()
            .cached
    );
    // Errors are never cached.
    assert!(engine::run_query(&state, &context, &cached("SELECT * FROM setting")).is_err());
    assert!(engine::run_query(&state, &context, &cached("SELECT * FROM setting")).is_err());
    assert!(state.cached_results() >= 4);
    state.clear_cache();
    assert_eq!(state.cached_results(), 0);
}

/// A database file replaced under the same path (not through SQL) is
/// noticed by the stamp.
#[cfg(unix)]
#[test]
fn a_replaced_database_file_invalidates_the_cache() {
    let db = TestDb::new();
    let other = TestDb::with(Options {
        seed: false,
        ..Options::default()
    });
    let state = EngineState::new();
    let context = ctx(&db, Privacy::Nominative);
    let req = || RunQueryRequest {
        use_cache: true,
        ..request("SELECT count(*) FROM outing")
    };
    let before = engine::run_query(&state, &context, &req()).unwrap();
    assert!(before.rows[0][0].as_i64().unwrap() > 0);
    let staging = db.dir.path().join("staging.db");
    std::fs::copy(&other.path, &staging).unwrap();
    std::fs::rename(&staging, &db.path).unwrap();
    let _ = std::fs::remove_file(db.path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db.path.with_extension("db-shm"));
    let after = engine::run_query(&state, &context, &req()).unwrap();
    assert!(!after.cached);
    assert_eq!(after.rows, vec![vec![json!(0)]]);
}
