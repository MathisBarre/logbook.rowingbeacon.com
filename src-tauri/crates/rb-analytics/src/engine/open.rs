//! Opening an analytics connection (plan 2.2 steps 3 to 6): read-only
//! open with the WAL fallback, limits, defensive settings, the season start
//! month, the TEMP views of `views.sql`, then `query_only`.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use rusqlite::config::DbConfig;
use rusqlite::limits::Limit;
use rusqlite::{Connection, ErrorCode as SqliteCode, OpenFlags};

use crate::assets::{view_blocks, SqlBlock};
use crate::error::{AnalyticsError, ErrorCode};

/// The default `analytics.seasonStartMonth` (August, like `getSeasonDate`).
pub const DEFAULT_SEASON_START_MONTH: u8 = 8;
pub const SEASON_START_MONTH_KEY: &str = "analytics.seasonStartMonth";
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(2);

/// Largest string, blob or row record a statement may build. The webview
/// only ever gets 1,000 characters of a value (`values::MAX_TEXT_UNITS`)
/// and no readable column holds anything near 1 MB, so this costs nothing,
/// and it bounds what one row adds to the heap between two memory checks
/// to `SQLITE_LIMIT_COLUMN` MB (review C, 1).
pub const MAX_VALUE_BYTES: i32 = 1_000_000;

/// SQLite limits of every analytics connection (plan 2.2 step 4).
pub const LIMITS: [(Limit, i32); 8] = [
    (Limit::SQLITE_LIMIT_ATTACHED, 0),
    (Limit::SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES),
    (Limit::SQLITE_LIMIT_SQL_LENGTH, 100_000),
    (Limit::SQLITE_LIMIT_COLUMN, 200),
    (Limit::SQLITE_LIMIT_EXPR_DEPTH, 200),
    (Limit::SQLITE_LIMIT_COMPOUND_SELECT, 50),
    (Limit::SQLITE_LIMIT_VARIABLE_NUMBER, 100),
    (Limit::SQLITE_LIMIT_TRIGGER_DEPTH, 0),
];

/// `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`: the only shape substituted for
/// `{{NOW}}`, so the substitution cannot inject SQL.
pub fn is_local_date_time(now: &str) -> bool {
    let b = now.as_bytes();
    b.len() == 16
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 => *c == b':',
            _ => c.is_ascii_digit(),
        })
}

pub(crate) fn sqlite_code(error: &rusqlite::Error) -> Option<SqliteCode> {
    match error {
        rusqlite::Error::SqliteFailure(e, _) => Some(e.code),
        rusqlite::Error::SqlInputError { error, .. } => Some(error.code),
        _ => None,
    }
}

/// Errors while opening or preparing the connection (not user SQL).
pub(crate) fn setup_error(context: &str, error: rusqlite::Error) -> AnalyticsError {
    match sqlite_code(&error) {
        Some(SqliteCode::DatabaseBusy | SqliteCode::DatabaseLocked) => AnalyticsError::new(
            ErrorCode::Busy,
            format!("The database is busy ({context}): {error}"),
        ),
        _ => AnalyticsError::internal(format!("{context}: {error}")),
    }
}

const READ_ONLY: OpenFlags = OpenFlags::SQLITE_OPEN_READ_ONLY
    .union(OpenFlags::SQLITE_OPEN_NO_MUTEX)
    .union(OpenFlags::SQLITE_OPEN_URI);
/// The fallback has no `CREATE`: it never creates a database.
const READ_WRITE: OpenFlags = OpenFlags::SQLITE_OPEN_READ_WRITE
    .union(OpenFlags::SQLITE_OPEN_NO_MUTEX)
    .union(OpenFlags::SQLITE_OPEN_URI);

/// Opens with `open(flags)` read-only, and once more read-write (never
/// create) when SQLite answers `SQLITE_CANTOPEN` (plan 2.2 step 3). The
/// first read happens here, because SQLite opens the WAL files lazily.
/// Safety never depends on the flags: `query_only`, the authorizer and
/// `readonly()` hold on both paths.
///
/// Verified as a non-root user (WP1): a read-only folder holding main.db,
/// -wal and -shm opens read-only; a -wal without -shm in a read-only folder
/// cannot be read by any SQLite mode (both opens fail, `immutable=1`
/// ignores the WAL), so `open_read_only` explains it instead.
pub(crate) fn open_with_fallback<F>(mut open: F) -> rusqlite::Result<(Connection, bool)>
where
    F: FnMut(OpenFlags) -> rusqlite::Result<Connection>,
{
    let attempt = |open: &mut F, flags: OpenFlags| -> rusqlite::Result<Connection> {
        let conn = open(flags)?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        // Never checkpoint when this connection closes: closing the last
        // connection of a WAL database would otherwise write main.db.
        conn.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)?;
        conn.query_row("SELECT count(*) FROM main.sqlite_master", [], |_| Ok(()))?;
        Ok(conn)
    };
    match attempt(&mut open, READ_ONLY) {
        Ok(conn) => Ok((conn, false)),
        Err(error) if sqlite_code(&error) == Some(SqliteCode::CannotOpen) => {
            attempt(&mut open, READ_WRITE).map(|conn| (conn, true))
        }
        Err(error) => Err(error),
    }
}

/// A read-only connection to `db_path`, without views or authorizer (the
/// engine adds them; the `data_version` stamp uses it as is). The boolean
/// tells whether the read-write fallback was needed.
pub(crate) fn open_read_only(db_path: &Path) -> Result<(Connection, bool), AnalyticsError> {
    if !db_path.is_file() {
        return Err(AnalyticsError::internal(format!(
            "No database at {}",
            db_path.display()
        )));
    }
    open_with_fallback(|flags| Connection::open_with_flags(db_path, flags)).map_err(|error| {
        let side = |suffix: &str| {
            let mut name = db_path.as_os_str().to_os_string();
            name.push(suffix);
            std::path::PathBuf::from(name).exists()
        };
        if sqlite_code(&error) == Some(SqliteCode::CannotOpen) && side("-wal") && !side("-shm") {
            // No SQLite mode can read the WAL without its index; reading
            // main.db alone (`immutable=1`) would silently miss changes.
            AnalyticsError::internal(format!(
                "Cannot read {}: its -wal file has no -shm file and the folder cannot be written. \
                 Open Rowing Beacon once, or copy the -shm file with the database ({error})",
                db_path.display()
            ))
        } else {
            setup_error("cannot open the database", error)
        }
    })
}

/// How long a settings read waits for a lock (`open_settings_reader`): a
/// read that cannot get one falls back to safe values instead of holding
/// the query up.
pub const SETTINGS_BUSY_TIMEOUT: Duration = Duration::from_millis(200);

/// A read-only connection for reading settings outside the engine
/// (`perf::read_choice`): the engine's open, its defensive settings and
/// limits, a short busy timeout, and `query_only`.
pub(crate) fn open_settings_reader(db_path: &Path) -> Result<Connection, AnalyticsError> {
    let (conn, _fallback) = open_read_only(db_path)?;
    harden(&conn).map_err(|e| setup_error("configuring the connection", e))?;
    conn.busy_timeout(SETTINGS_BUSY_TIMEOUT)
        .and_then(|()| conn.execute_batch("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;"))
        .map_err(|e| setup_error("locking the connection", e))?;
    Ok(conn)
}

/// Defensive settings and limits (before anything runs on the connection).
fn harden(conn: &Connection) -> rusqlite::Result<()> {
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, false)?;
    for (limit, value) in LIMITS {
        conn.set_limit(limit, value);
    }
    // TEMP views and sorts stay in memory (no temp files on an SD card);
    // the progress handler bounds that memory (`run::MEMORY_BUDGET_BYTES`).
    conn.execute_batch("PRAGMA temp_store = MEMORY;")
}

/// Tables of the main database.
fn main_tables(conn: &Connection) -> rusqlite::Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'")?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))?;
    names.collect()
}

/// `analytics.seasonStartMonth`: a JSON integer, clamped to 1..=12; 8 when
/// missing or invalid (same rule as `readSeasonStartMonth` in TS).
pub fn parse_season_start_month(value: Option<&str>) -> u8 {
    let parsed = value.and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok());
    match parsed.as_ref().and_then(serde_json::Value::as_f64) {
        Some(n) if n.fract() == 0.0 => n.clamp(1.0, 12.0) as u8,
        _ => DEFAULT_SEASON_START_MONTH,
    }
}

fn read_season_start_month(
    conn: &Connection,
    tables: &HashSet<String>,
) -> Result<u8, AnalyticsError> {
    if !tables.contains("setting") {
        return Ok(DEFAULT_SEASON_START_MONTH);
    }
    let value = conn.query_row(
        "SELECT value FROM main.setting WHERE key = ?1",
        [SEASON_START_MONTH_KEY],
        |row| row.get::<_, Option<String>>(0),
    );
    match value {
        Ok(value) => Ok(parse_season_start_month(value.as_deref())),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(DEFAULT_SEASON_START_MONTH),
        Err(error) => match sqlite_code(&error) {
            Some(SqliteCode::DatabaseBusy | SqliteCode::DatabaseLocked) => {
                Err(setup_error("reading the settings", error))
            }
            // A value of another type: the default.
            _ => Ok(DEFAULT_SEASON_START_MONTH),
        },
    }
}

/// `{{SEASON_START_MONTH}}` and `{{NOW}}` of a view block. The caller has
/// validated both values.
pub fn render_view(block: &SqlBlock, season_start_month: u8, now: &str) -> String {
    debug_assert!((1..=12).contains(&season_start_month) && is_local_date_time(now));
    block
        .sql
        .replace("{{SEASON_START_MONTH}}", &season_start_month.to_string())
        .replace("{{NOW}}", now)
}

/// A connection ready for user SQL (authorizer not installed yet). Low
/// level: `engine::run_query` is the API; tests use it to bypass the lexer.
pub struct Prepared {
    pub conn: Connection,
    pub views: Vec<String>,
    pub missing_views: Vec<String>,
    /// Dictionary tables present in the database, in dictionary order.
    pub tables: Vec<String>,
}

/// Creates the views whose tables exist. A view that SQLite refuses (a
/// column renamed by a later migration, a view it depends on missing) is
/// dropped and listed as missing instead of breaking every query.
fn create_views(
    conn: &Connection,
    tables: &HashSet<String>,
    season_start_month: u8,
    now: &str,
) -> Result<(Vec<String>, Vec<String>), AnalyticsError> {
    let mut created = Vec::new();
    let mut missing = Vec::new();
    for block in view_blocks() {
        if !block.requires.iter().all(|table| tables.contains(table)) {
            missing.push(block.name);
            continue;
        }
        let sql = render_view(&block, season_start_month, now);
        // Preparing a SELECT on the view checks every name it uses.
        let outcome = conn.execute_batch(&sql).and_then(|()| {
            conn.prepare(&format!("SELECT * FROM temp.\"{}\" LIMIT 0", block.name))
                .map(|_| ())
        });
        match outcome {
            Ok(()) => created.push(block.name),
            Err(error) if sqlite_code(&error) == Some(SqliteCode::Unknown) => {
                // SQLITE_ERROR: the view does not fit this database.
                let _ = conn.execute_batch(&format!("DROP VIEW IF EXISTS temp.\"{}\"", block.name));
                missing.push(block.name);
            }
            Err(error) => return Err(setup_error("creating the analytics views", error)),
        }
    }
    Ok((created, missing))
}

/// Steps 3 to 6 of plan 2.2. `now` must be a valid local date-time.
pub fn prepare_connection(db_path: &Path, now: &str) -> Result<Prepared, AnalyticsError> {
    if !is_local_date_time(now) {
        return Err(AnalyticsError::internal(format!(
            "Invalid local date-time: {now}"
        )));
    }
    let (conn, _fallback) = open_read_only(db_path)?;
    harden(&conn).map_err(|e| setup_error("configuring the connection", e))?;
    let tables = main_tables(&conn).map_err(|e| setup_error("listing the tables", e))?;
    let season_start_month = read_season_start_month(&conn, &tables)?;
    let (views, missing_views) = create_views(&conn, &tables, season_start_month, now)?;
    conn.execute_batch("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;")
        .map_err(|e| setup_error("locking the connection", e))?;
    let dictionary_tables = super::authorizer::dictionary()
        .tables()
        .filter(|table| tables.contains(&table.name))
        .map(|table| table.name.clone())
        .collect();
    Ok(Prepared {
        conn,
        views,
        missing_views,
        tables: dictionary_tables,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn validates_local_date_times() {
        assert!(is_local_date_time("2026-06-20T09:47"));
        for bad in [
            "2026-06-20 09:47",
            "2026-06-20T09:47:00",
            "2026-6-20T09:47",
            "2026-06-20T09:4'",
            "２026-06-20T09:47",
            "",
        ] {
            assert!(!is_local_date_time(bad), "{bad}");
        }
    }

    #[test]
    fn parses_the_season_start_month() {
        assert_eq!(parse_season_start_month(None), 8);
        assert_eq!(parse_season_start_month(Some("9")), 9);
        assert_eq!(parse_season_start_month(Some("1")), 1);
        assert_eq!(parse_season_start_month(Some("13")), 12);
        assert_eq!(parse_season_start_month(Some("0")), 1);
        assert_eq!(parse_season_start_month(Some("-4")), 1);
        assert_eq!(parse_season_start_month(Some("9.5")), 8);
        assert_eq!(parse_season_start_month(Some("\"9\"")), 8);
        assert_eq!(parse_season_start_month(Some("nope")), 8);
    }

    #[test]
    fn renders_view_templates() {
        let block = SqlBlock {
            name: "v".into(),
            requires: vec![],
            sql: "SELECT {{SEASON_START_MONTH}} AS m, '{{NOW}}' AS now, {{SEASON_START_MONTH}};"
                .into(),
        };
        assert_eq!(
            render_view(&block, 9, "2026-06-20T09:47"),
            "SELECT 9 AS m, '2026-06-20T09:47' AS now, 9;"
        );
    }

    /// The fallback logic, with an opener that fails like a read-only
    /// folder holding a `-wal` without `-shm` (cannot be reproduced as
    /// root, which ignores folder permissions).
    #[test]
    fn retries_read_write_without_create_on_cantopen() {
        let seen = RefCell::new(Vec::new());
        let (_conn, fallback) = open_with_fallback(|flags| {
            seen.borrow_mut().push(flags);
            if flags.contains(OpenFlags::SQLITE_OPEN_READ_ONLY) {
                Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                    None,
                ))
            } else {
                Connection::open_in_memory()
            }
        })
        .unwrap();
        assert!(fallback);
        let seen = seen.into_inner();
        assert_eq!(seen.len(), 2);
        assert!(seen[1].contains(OpenFlags::SQLITE_OPEN_READ_WRITE));
        assert!(!seen[1].contains(OpenFlags::SQLITE_OPEN_CREATE));
        assert!(!seen[1].contains(OpenFlags::SQLITE_OPEN_READ_ONLY));
    }

    #[test]
    fn does_not_retry_on_other_errors() {
        let mut calls = 0;
        let result = open_with_fallback(|_| {
            calls += 1;
            Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_NOTADB),
                None,
            ))
        });
        assert!(result.is_err());
        assert_eq!(calls, 1);
    }
}
