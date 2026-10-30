//! The SQLite authorizer of analytics connections (plan 2.2 step 7 and 2.4).
//!
//! SQLite asks it about every action of a statement while the statement is
//! prepared (and re-prepared after a schema change), including the base
//! columns a view reads when it is expanded. It is an allowlist:
//!
//! - `SELECT`, functions (except a few dangerous ones) and recursive CTEs
//!   are allowed; every other action (PRAGMA, ATTACH, writes, DDL,
//!   transactions…) is denied.
//! - Reads: TEMP views created by the engine are allowed; base tables must
//!   be in `dictionary.json`, anything else (`setting`, `efa_record`,
//!   `change_log`, `sqlite_master`, `analytics_*`, pragma functions, any
//!   unknown table) is denied.
//! - Columns of a dictionary table: contact columns always read as NULL
//!   (`SQLITE_IGNORE`), personal and free-text columns read as NULL in
//!   `pseudonymised` mode, columns the dictionary does not list read as NULL
//!   (a new column is private until it is classified). Each column read as
//!   NULL is reported in `ignoredColumns`.
//!
//! SQLite consults the authorizer at prepare time only: a statement
//! prepared in one mode must never run in another, so the engine never uses
//! `prepare_cached` and opens a fresh connection for each query.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::Connection;

use crate::assets::{ColumnClass, Dictionary};
use crate::ipc::Privacy;

/// Functions refused even though functions are allowed: extension loading
/// and file access (not compiled in, refused anyway in case they ever are).
const DENIED_FUNCTIONS: [&str; 6] = [
    "load_extension",
    "fts3_tokenizer",
    "readfile",
    "writefile",
    "edit",
    "sqlite_dbpage",
];

/// The embedded `dictionary.json`, parsed once.
pub fn dictionary() -> &'static Dictionary {
    static DICTIONARY: OnceLock<Dictionary> = OnceLock::new();
    DICTIONARY.get_or_init(Dictionary::load)
}

/// Base tables of the dictionary and the class of each listed column.
#[derive(Debug)]
pub struct Policy {
    tables: HashMap<String, HashMap<String, ColumnClass>>,
}

impl Policy {
    pub fn from_dictionary(dictionary: &Dictionary) -> Policy {
        let tables = dictionary
            .tables()
            .map(|table| {
                let columns = table
                    .columns
                    .iter()
                    .map(|column| (column.name.clone(), column.class))
                    .collect();
                (table.name.clone(), columns)
            })
            .collect();
        Policy { tables }
    }

    /// The policy of the embedded `dictionary.json`.
    pub fn shared() -> &'static Policy {
        static POLICY: OnceLock<Policy> = OnceLock::new();
        POLICY.get_or_init(|| Policy::from_dictionary(dictionary()))
    }

    pub fn is_table(&self, name: &str) -> bool {
        self.tables.contains_key(name)
    }
}

/// What the authorizer saw while a statement was prepared.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AuthLog {
    /// `table.column` read as NULL.
    pub ignored: BTreeSet<String>,
    /// The first object refused: a table, a function or a pragma.
    pub denied: Option<String>,
}

/// Table-valued functions that only read their arguments.
const ALLOWED_TABLE_FUNCTIONS: [&str; 2] = ["json_each", "json_tree"];

/// The objects of one connection the authorizer needs to know.
#[derive(Debug, Default, Clone)]
pub struct Scope {
    /// TEMP views created by the engine.
    pub views: HashSet<String>,
    /// Every table, view and virtual table of the main and temp schemas,
    /// lower case.
    pub objects: HashSet<String>,
}

impl Scope {
    pub fn new(views: &[String], objects: impl IntoIterator<Item = String>) -> Scope {
        Scope {
            views: views.iter().cloned().collect(),
            objects: objects
                .into_iter()
                .map(|o| o.to_ascii_lowercase())
                .collect(),
        }
    }
}

/// The table names of the main and temp schemas (before the authorizer).
pub fn schema_objects(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM main.sqlite_master WHERE type IN ('table', 'view') \
         UNION SELECT name FROM temp.sqlite_master WHERE type IN ('table', 'view')",
    )?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))?;
    names.collect()
}

/// Whether a FROM item read without any column (`SELECT count(*) FROM x`)
/// may be read. SQLite reports these with the name and schema as written
/// in the query, unresolved, so `x` can be a table, a view or a CTE.
fn may_read_unresolved(policy: &Policy, scope: &Scope, database: Option<&str>, name: &str) -> bool {
    let schema = database.map(str::to_ascii_lowercase);
    if !matches!(schema.as_deref(), None | Some("main") | Some("temp")) {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    if policy.tables.keys().any(|t| t.eq_ignore_ascii_case(&lower))
        || scope.views.iter().any(|v| v.eq_ignore_ascii_case(&lower))
        || ALLOWED_TABLE_FUNCTIONS.contains(&lower.as_str())
    {
        return true;
    }
    // Any other existing object, a system table or an eponymous virtual
    // table is refused; an unknown name is a CTE (a CTE named like a
    // denied table is refused too, which is harmless).
    let system = lower.starts_with("sqlite_")
        || lower.starts_with("pragma_")
        || ["dbstat", "fts3tokenize", "fts5vocab", "rtree", "geopoly"].contains(&lower.as_str());
    !(system || scope.objects.contains(&lower))
}

/// One authorizer decision. Pure, so the policy can be tested without
/// SQLite; `install` wires it to a connection.
pub fn decide(
    policy: &Policy,
    privacy: Privacy,
    scope: &Scope,
    ctx: &AuthContext<'_>,
    log: &mut AuthLog,
) -> Authorization {
    let mut deny = |object: Option<&str>| {
        if log.denied.is_none() {
            log.denied = object.map(String::from);
        }
        Authorization::Deny
    };
    match ctx.action {
        AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Function { function_name } => {
            let lower = function_name.to_ascii_lowercase();
            if DENIED_FUNCTIONS.contains(&lower.as_str()) {
                deny(Some(function_name))
            } else {
                Authorization::Allow
            }
        }
        // `SELECT count(*) FROM t`: a table read without any column.
        AuthAction::Read {
            table_name,
            column_name: "",
        } => {
            if may_read_unresolved(policy, scope, ctx.database_name, table_name) {
                Authorization::Allow
            } else {
                deny(Some(table_name))
            }
        }
        // A column of a resolved table: declared names, actual schema.
        AuthAction::Read {
            table_name,
            column_name,
        } => match ctx.database_name {
            // The engine's TEMP views (privacy is enforced on the base
            // columns they read, which SQLite authorizes too).
            Some("temp") if scope.views.contains(table_name) => Authorization::Allow,
            Some("main") if ALLOWED_TABLE_FUNCTIONS.contains(&table_name) => Authorization::Allow,
            Some("main") => match policy.tables.get(table_name) {
                None => deny(Some(table_name)),
                Some(columns) => {
                    let ignore = match columns.get(column_name) {
                        None | Some(ColumnClass::Contact) => true,
                        Some(ColumnClass::Personal | ColumnClass::FreeText) => {
                            privacy == Privacy::Pseudonymised
                        }
                        Some(ColumnClass::Public) => false,
                    };
                    if ignore {
                        log.ignored.insert(format!("{table_name}.{column_name}"));
                        Authorization::Ignore
                    } else {
                        Authorization::Allow
                    }
                }
            },
            _ => deny(Some(table_name)),
        },
        AuthAction::Pragma { pragma_name, .. } => deny(Some(pragma_name)),
        _ => deny(None),
    }
}

/// Installs the authorizer on `conn` and returns the log it fills. Call
/// it after the views are created and the pragmas are set: both would be
/// refused.
pub fn install(conn: &Connection, privacy: Privacy, scope: Scope) -> Arc<Mutex<AuthLog>> {
    let log = Arc::new(Mutex::new(AuthLog::default()));
    let policy = Policy::shared();
    let sink = Arc::clone(&log);
    conn.authorizer(Some(move |ctx: AuthContext<'_>| match sink.lock() {
        Ok(mut log) => decide(policy, privacy, &scope, &ctx, &mut log),
        // A poisoned log cannot record what is ignored: refuse everything.
        Err(_) => Authorization::Deny,
    }));
    log
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::hooks::TransactionOperation;

    fn read<'a>(db: &'a str, table: &'a str, column: &'a str) -> AuthContext<'a> {
        AuthContext {
            action: AuthAction::Read {
                table_name: table,
                column_name: column,
            },
            database_name: Some(db),
            accessor: None,
        }
    }

    fn scope() -> Scope {
        Scope::new(
            &["v_rowers".to_string()],
            ["rower", "setting", "Efa_Record", "v_rowers"].map(String::from),
        )
    }

    fn run(privacy: Privacy, ctx: AuthContext<'_>) -> (Authorization, AuthLog) {
        let mut log = AuthLog::default();
        let decision = decide(Policy::shared(), privacy, &scope(), &ctx, &mut log);
        (decision, log)
    }

    #[test]
    fn denies_tables_outside_the_dictionary() {
        for table in [
            "setting",
            "efa_record",
            "change_log",
            "session",
            "session_rowers",
            "migration",
            "analytics_query",
            "analytics_dashboard_item",
            "boat_level_config",
            "sqlite_master",
            "sqlite_temp_master",
            "pragma_table_info",
            "dbstat",
            "unknown",
        ] {
            for privacy in [Privacy::Nominative, Privacy::Pseudonymised] {
                let (decision, log) = run(privacy, read("main", table, "x"));
                assert_eq!(decision, Authorization::Deny, "{table}");
                assert_eq!(log.denied.as_deref(), Some(table));
            }
        }
        // A dictionary table name in another schema, or a view in main.
        assert_eq!(
            run(Privacy::Nominative, read("temp", "rower", "id")).0,
            Authorization::Deny
        );
        assert_eq!(
            run(Privacy::Nominative, read("main", "v_rowers", "x")).0,
            Authorization::Deny
        );
        assert_eq!(
            run(Privacy::Nominative, read("temp", "v_outings", "x")).0,
            Authorization::Deny
        );
    }

    #[test]
    fn applies_column_classes_per_mode() {
        let cases = [
            ("rower", "id", false, false),
            ("rower", "first_name", false, true),
            ("rower", "last_name", false, true),
            ("rower", "birth_date", false, true),
            ("rower", "email", true, true),
            ("rower", "phone", true, true),
            ("rower", "address", true, true),
            ("rower", "license_number", true, true),
            ("rower", "note", true, true),
            ("outing", "comment", false, true),
            ("incident", "message", false, true),
            ("boat_damage", "description", false, true),
            ("boat_damage", "repair_note", false, true),
            ("boat", "note", false, true),
            ("route", "note", false, true),
            ("rower", "not_in_dictionary", true, true),
            ("rower", "ROWID", true, true),
        ];
        for (table, column, nominative, pseudonymised) in cases {
            for (privacy, ignored) in [
                (Privacy::Nominative, nominative),
                (Privacy::Pseudonymised, pseudonymised),
            ] {
                let (decision, log) = run(privacy, read("main", table, column));
                let expected = if ignored {
                    Authorization::Ignore
                } else {
                    Authorization::Allow
                };
                assert_eq!(decision, expected, "{table}.{column} {privacy:?}");
                assert_eq!(log.ignored.contains(&format!("{table}.{column}")), ignored);
                assert_eq!(log.denied, None);
            }
        }
        // Table-valued JSON functions only read their arguments.
        assert_eq!(
            run(Privacy::Pseudonymised, read("main", "json_each", "value")).0,
            Authorization::Allow
        );
        // Views created on the connection are readable.
        assert_eq!(
            run(
                Privacy::Pseudonymised,
                read("temp", "v_rowers", "display_name")
            )
            .0,
            Authorization::Allow
        );
    }

    /// `SELECT count(*) FROM x`: names as written, schema as written.
    #[test]
    fn checks_tables_read_without_columns() {
        let unresolved = |db: Option<&'static str>, name: &'static str| AuthContext {
            action: AuthAction::Read {
                table_name: name,
                column_name: "",
            },
            database_name: db,
            accessor: None,
        };
        for (db, name) in [
            (None, "rower"),
            (None, "ROWER"),
            (Some("main"), "outing"),
            (Some("MAIN"), "Outing"),
            (None, "v_rowers"),
            (None, "V_ROWERS"),
            (Some("temp"), "v_rowers"),
            (None, "my_cte"),
            (None, "json_each"),
        ] {
            assert_eq!(
                run(Privacy::Pseudonymised, unresolved(db, name)).0,
                Authorization::Allow,
                "{db:?}.{name}"
            );
        }
        for (db, name) in [
            (None, "setting"),
            (None, "SETTING"),
            (Some("main"), "setting"),
            (None, "efa_record"),
            (None, "sqlite_master"),
            (None, "sqlite_schema"),
            (None, "SQLITE_TEMP_MASTER"),
            (None, "pragma_table_info"),
            (None, "dbstat"),
            (Some("other"), "rower"),
        ] {
            let (decision, log) = run(Privacy::Nominative, unresolved(db, name));
            assert_eq!(decision, Authorization::Deny, "{db:?}.{name}");
            assert_eq!(log.denied.as_deref(), Some(name));
        }
    }

    #[test]
    fn denies_every_other_action() {
        let actions = [
            AuthAction::Pragma {
                pragma_name: "query_only",
                pragma_value: Some("0"),
            },
            AuthAction::Attach { filename: "x.db" },
            AuthAction::Detach { database_name: "x" },
            AuthAction::Insert {
                table_name: "outing",
            },
            AuthAction::Update {
                table_name: "rower",
                column_name: "first_name",
            },
            AuthAction::Delete {
                table_name: "outing",
            },
            AuthAction::CreateTempView { view_name: "x" },
            AuthAction::CreateTable { table_name: "x" },
            AuthAction::DropTempView {
                view_name: "v_rowers",
            },
            AuthAction::Transaction {
                operation: TransactionOperation::Begin,
            },
            AuthAction::Analyze { table_name: "x" },
            AuthAction::Reindex { index_name: "x" },
            AuthAction::AlterTable {
                database_name: "main",
                table_name: "x",
            },
            AuthAction::CreateVtable {
                table_name: "x",
                module_name: "fts5",
            },
            AuthAction::Function {
                function_name: "load_extension",
            },
            AuthAction::Function {
                function_name: "LOAD_EXTENSION",
            },
            AuthAction::Function {
                function_name: "fts3_tokenizer",
            },
        ];
        for action in actions {
            let ctx = AuthContext {
                action,
                database_name: Some("main"),
                accessor: None,
            };
            assert_eq!(
                run(Privacy::Nominative, ctx).0,
                Authorization::Deny,
                "{action:?}"
            );
        }
        for action in [
            AuthAction::Select,
            AuthAction::Recursive,
            AuthAction::Function {
                function_name: "printf",
            },
        ] {
            let ctx = AuthContext {
                action,
                database_name: None,
                accessor: None,
            };
            assert_eq!(run(Privacy::Pseudonymised, ctx).0, Authorization::Allow);
        }
    }

    #[test]
    fn keeps_the_first_denied_object() {
        let mut log = AuthLog::default();
        decide(
            Policy::shared(),
            Privacy::Nominative,
            &scope(),
            &read("main", "setting", "key"),
            &mut log,
        );
        decide(
            Policy::shared(),
            Privacy::Nominative,
            &scope(),
            &read("main", "efa_record", "x"),
            &mut log,
        );
        assert_eq!(log.denied.as_deref(), Some("setting"));
    }
}
