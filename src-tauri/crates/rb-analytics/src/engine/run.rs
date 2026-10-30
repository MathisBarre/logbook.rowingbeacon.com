//! Running one user statement on a prepared connection (plan 2.2 steps 1
//! and 7 to 12): request checks, authorizer, prepare, `readonly()`,
//! progress handler, binding, stepping and error mapping.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rusqlite::{Connection, ErrorCode as SqliteCode, Statement};

use crate::error::{utf16_offset, AnalyticsError, ErrorCode};
use crate::ipc::{Privacy, QueryResult, ResultColumn, RunQueryRequest};
use crate::perf::PerformanceLimits;

use super::authorizer::{self, AuthLog};
use super::open::is_local_date_time;
use super::values::{json_size, param_to_sql, to_json};

pub const MAX_SQL_BYTES: usize = 100_000;
/// Absolute bounds of a request: outside them it is refused. Inside, the
/// engine clamps `maxRows` and `timeoutMs` to the profile of its context
/// (`perf::PerformanceLimits::max_rows` and `max_timeout_ms`: 5,000 rows
/// and 30 s on Économe).
pub const MAX_ROWS: u32 = 50_000;
pub const MIN_TIMEOUT_MS: u64 = 100;
pub const MAX_TIMEOUT_MS: u64 = 300_000;
/// Largest result sent to the webview (JSON estimate) on Économe; the
/// other profiles allow more (`perf`).
pub const MAX_RESULT_BYTES: usize = 8 * 1024 * 1024;
/// Virtual machine steps between two checks of the deadline, the cancel
/// flag and the memory budget. A check costs tens of nanoseconds; 1,000
/// steps keep what one row can allocate between two checks small.
pub const PROGRESS_STEPS: i32 = 1_000;
/// SQLite heap one run may add on top of what was in use when it started:
/// sorts, DISTINCT, GROUP BY, window partitions, recursive CTEs and TEMP
/// b-trees all live in memory (`temp_store = MEMORY`), so without it a
/// cross join with ORDER BY grows by gigabytes before its deadline and gets
/// the app killed on a Raspberry Pi. The heaviest prebuilt report adds
/// about 43 MB on six seasons of 115,000 outings (review A, H1). Économe's
/// value; the other profiles allow more (`perf`).
pub const MEMORY_BUDGET_BYTES: i64 = 256 * 1024 * 1024;
/// Process-wide ceiling of SQLite's heap (`sqlite3_hard_heap_limit64`),
/// for an allocation the progress handler cannot see coming (between two
/// checks). Between two checks one statement can add at most about one
/// row: `SQLITE_LIMIT_COLUMN` values of at most `SQLITE_LIMIT_LENGTH`
/// (200 x 1 MB, `open::LIMITS`), so a run peaks near the budget plus
/// 200 MB (review C, 1). The app's own connections share this SQLite (sqlx
/// uses the same `libsqlite3-sys`): page caches of 2 MB each, sorts in temp
/// files, so 512 MB is far above them, and an allocation over it fails
/// (`too_large`, `SQLITE_NOMEM` for the app, which rolls back) instead of
/// the process. Économe's value; on the other profiles it grows with the
/// machine's memory, to at most a quarter of it (`perf::limits_on`).
pub const HEAP_HARD_LIMIT_BYTES: i64 = 512 * 1024 * 1024;
/// What every run leaves under the process-wide heap limit (review D, M1):
/// a run stops once SQLite's heap reaches `limit - HEAP_HEADROOM_BYTES`,
/// whatever its own budget, so one more row between two checks (200 x
/// 1 MB, review C) still fits under the limit with room for the app's own
/// writes. `perf` keeps `concurrent_queries x budget + headroom <= limit`.
pub const HEAP_HEADROOM_BYTES: i64 = 256 * 1024 * 1024;

/// Bytes SQLite has allocated in this process (every connection).
pub fn sqlite_memory_used() -> i64 {
    // SAFETY: a read of SQLite's memory statistics, no precondition.
    unsafe { rusqlite::ffi::sqlite3_memory_used() }
}

/// The process-wide heap limit in place (0: none).
pub fn current_heap_limit() -> i64 {
    // SAFETY: a negative argument only reads the current limit.
    unsafe { rusqlite::ffi::sqlite3_hard_heap_limit64(-1) }
}

/// Runs inside `execute` in this process right now (the app's queue runs
/// up to `concurrent_queries` at once; the MCP server is another process).
static ACTIVE_RUNS: AtomicUsize = AtomicUsize::new(0);

/// Counts one run while it lives.
struct ActiveRun;

impl ActiveRun {
    fn start() -> Self {
        ACTIVE_RUNS.fetch_add(1, Ordering::SeqCst);
        ActiveRun
    }
}

impl Drop for ActiveRun {
    fn drop(&mut self) {
        ACTIVE_RUNS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Runs inside `execute` in this process.
pub fn active_runs() -> usize {
    ACTIVE_RUNS.load(Ordering::SeqCst)
}

/// The heap limit to set, if any: `wanted` when there is none (0), when
/// the current one is the engine's own (`ours`, the last one it set, so a
/// change of profile applies), or when `wanted` is lower. A lower limit
/// someone else set stays.
///
/// Lowering never goes under what SQLite holds now plus the headroom
/// (`used`, review D, L1): a run of the previous profile may still hold
/// hundreds of MB, and a limit under that would refuse every allocation
/// of the process, the app's writes included, until it ends. The next run
/// lowers it the rest of the way.
pub fn next_heap_limit(current: i64, ours: i64, wanted: i64, used: i64) -> Option<i64> {
    let target = if current == 0 || current <= wanted {
        wanted
    } else {
        // Lowering (its own or a higher one set by someone else).
        wanted
            .max(used.saturating_add(HEAP_HEADROOM_BYTES))
            .min(current)
    };
    if target == current {
        None
    } else if current == 0 || current == ours || current > target {
        Some(target)
    } else {
        None
    }
}

/// Sets the process-wide SQLite heap limit of the run's profile
/// (`HEAP_HARD_LIMIT_BYTES` on Économe), unless a lower one is in place.
pub fn install_heap_limit(wanted: i64) {
    static OURS: Mutex<i64> = Mutex::new(0);
    let Ok(mut ours) = OURS.lock() else {
        return;
    };
    let current = current_heap_limit();
    if let Some(limit) = next_heap_limit(current, *ours, wanted, sqlite_memory_used()) {
        // SAFETY: a plain SQLite configuration call.
        unsafe { rusqlite::ffi::sqlite3_hard_heap_limit64(limit) };
        *ours = limit;
    }
}

/// Whether the progress handler stops a run for memory (review D, M1):
/// SQLite's heap is past the absolute ceiling (`limit - headroom`), or the
/// run grew past its budget since the lowest point it saw (`low`: memory a
/// neighbour freed is never inherited as room).
pub fn over_memory(used: i64, low: i64, budget: i64, absolute: i64) -> bool {
    used > absolute || used > low.saturating_add(budget)
}

/// `^[a-z][a-z0-9_]{0,31}$`.
pub fn is_param_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

/// Step 1: the request itself.
pub fn validate_request(req: &RunQueryRequest) -> Result<(), AnalyticsError> {
    if req.sql.len() > MAX_SQL_BYTES {
        return Err(AnalyticsError::new(
            ErrorCode::Syntax,
            format!(
                "The query is too long ({} bytes, at most {MAX_SQL_BYTES})",
                req.sql.len()
            ),
        ));
    }
    if !(1..=MAX_ROWS).contains(&req.max_rows) {
        return Err(AnalyticsError::internal(format!(
            "maxRows must be between 1 and {MAX_ROWS} (got {})",
            req.max_rows
        )));
    }
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&req.timeout_ms) {
        return Err(AnalyticsError::internal(format!(
            "timeoutMs must be between {MIN_TIMEOUT_MS} and {MAX_TIMEOUT_MS} (got {})",
            req.timeout_ms
        )));
    }
    if !is_local_date_time(&req.now) {
        return Err(AnalyticsError::internal(format!(
            "now must be a local date-time YYYY-MM-DDTHH:mm (got {:?})",
            req.now
        )));
    }
    if let Some(name) = req.params.keys().find(|name| !is_param_name(name)) {
        return Err(AnalyticsError::new(
            ErrorCode::InvalidParam,
            format!("Invalid parameter name {name:?}"),
        )
        .with_object(name.as_str()));
    }
    Ok(())
}

/// The deadline, the cancel flag and the memory budget of one run.
pub struct Guard {
    pub cancel: Arc<AtomicBool>,
    pub started: Instant,
    pub deadline: Instant,
    pub timeout_ms: u64,
    /// SQLite heap the statement may add (`MEMORY_BUDGET_BYTES`).
    pub memory_budget: i64,
    /// Process-wide heap limit, for its error message.
    pub heap_limit: i64,
    /// Largest result (`MAX_RESULT_BYTES`).
    pub result_bytes: usize,
    /// Set by the progress handler when the budget was exceeded.
    pub memory_exceeded: Arc<AtomicBool>,
    /// Set with `memory_exceeded` when another run was active then: the
    /// memory SQLite counts is the whole process's.
    pub memory_shared: Arc<AtomicBool>,
}

impl Guard {
    /// A run starting now, with Économe's memory budget and result size.
    pub fn new(cancel: Arc<AtomicBool>, timeout_ms: u64) -> Self {
        let started = Instant::now();
        Guard {
            cancel,
            started,
            // Checked: the request's timeout is validated after this.
            deadline: started
                .checked_add(std::time::Duration::from_millis(timeout_ms))
                .unwrap_or(started + std::time::Duration::from_millis(MAX_TIMEOUT_MS)),
            timeout_ms,
            memory_budget: MEMORY_BUDGET_BYTES,
            heap_limit: HEAP_HARD_LIMIT_BYTES,
            result_bytes: MAX_RESULT_BYTES,
            memory_exceeded: Arc::new(AtomicBool::new(false)),
            memory_shared: Arc::new(AtomicBool::new(false)),
        }
    }

    /// A run starting now with the memory and result limits of a profile.
    pub fn with_limits(
        cancel: Arc<AtomicBool>,
        timeout_ms: u64,
        limits: &PerformanceLimits,
    ) -> Self {
        Guard {
            memory_budget: i64::try_from(limits.memory_budget_bytes).unwrap_or(i64::MAX),
            heap_limit: i64::try_from(limits.heap_limit_bytes).unwrap_or(i64::MAX),
            result_bytes: usize::try_from(limits.result_bytes).unwrap_or(usize::MAX),
            ..Guard::new(cancel, timeout_ms)
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// The error of a statement stopped by the progress handler.
    pub fn error(&self) -> AnalyticsError {
        if self.cancel.load(Ordering::Relaxed) {
            AnalyticsError::new(ErrorCode::Cancelled, "The query was cancelled")
        } else if self.memory_exceeded.load(Ordering::Relaxed) {
            too_much_memory(
                self.memory_budget,
                self.memory_shared.load(Ordering::Relaxed),
            )
        } else {
            AnalyticsError::new(
                ErrorCode::Timeout,
                format!("The query was stopped after {} ms", self.timeout_ms),
            )
        }
    }
}

fn too_much_memory(budget: i64, shared: bool) -> AnalyticsError {
    let mut message = format!(
        "The query needs more than {} MB of memory: filter or group the rows earlier, \
         or sort fewer of them",
        budget / (1024 * 1024)
    );
    if shared {
        message.push_str(
            ". Another query was running at the same time and SQLite counts the memory \
             of both: try again once it has finished",
        );
    }
    AnalyticsError::new(ErrorCode::TooLarge, message)
}

/// Maps a SQLite error of user SQL to the engine codes.
pub fn map_error(
    error: rusqlite::Error,
    sql: &str,
    log: Option<&AuthLog>,
    guard: &Guard,
) -> AnalyticsError {
    let (code, message, offset) = match &error {
        rusqlite::Error::SqliteFailure(e, message) => (
            Some(e.code),
            message.clone().unwrap_or_else(|| e.to_string()),
            None,
        ),
        rusqlite::Error::SqlInputError {
            error, msg, offset, ..
        } => (Some(error.code), msg.clone(), usize::try_from(*offset).ok()),
        other => (None, other.to_string(), None),
    };
    let with_offset = |e: AnalyticsError| match offset {
        Some(byte) => e.with_offset(utf16_offset(sql, byte)),
        None => e,
    };
    match code {
        Some(SqliteCode::AuthorizationForStatementDenied) => {
            let error = AnalyticsError::new(ErrorCode::Denied, message);
            match log.and_then(|log| log.denied.clone()) {
                Some(object) => error.with_object(object),
                None => error,
            }
        }
        Some(SqliteCode::OperationInterrupted) => guard.error(),
        Some(SqliteCode::DatabaseBusy | SqliteCode::DatabaseLocked) => {
            AnalyticsError::new(ErrorCode::Busy, message)
        }
        Some(SqliteCode::TooBig) => AnalyticsError::new(ErrorCode::TooLarge, message),
        // The process-wide heap limit (`install_heap_limit`) refused an
        // allocation.
        Some(SqliteCode::OutOfMemory) => too_much_memory(guard.heap_limit, active_runs() > 1),
        Some(SqliteCode::ReadOnly) => AnalyticsError::new(ErrorCode::NotReadOnly, message),
        // SQLite's own refusals (`load_extension` while extension loading
        // is off, unsafe functions…).
        Some(SqliteCode::Unknown) if message.starts_with("not authorized") => {
            let error = AnalyticsError::new(ErrorCode::Denied, message.clone());
            match message.rsplit_once(": ") {
                Some((_, object)) => error.with_object(object.trim()),
                None => error,
            }
        }
        // SQLITE_ERROR: a mistake in the query (syntax, unknown name, bad
        // argument…), at prepare or while stepping.
        Some(SqliteCode::Unknown) => with_offset(AnalyticsError::new(ErrorCode::Syntax, message)),
        Some(SqliteCode::ParameterOutOfRange) => {
            AnalyticsError::new(ErrorCode::InvalidParam, message)
        }
        _ => AnalyticsError::internal(message),
    }
}

fn bind(stmt: &mut Statement<'_>, req: &RunQueryRequest) -> Result<(), AnalyticsError> {
    for index in 1..=stmt.parameter_count() {
        let Some(raw) = stmt.parameter_name(index).map(String::from) else {
            return Err(AnalyticsError::new(
                ErrorCode::InvalidParam,
                "Positional parameters are not supported: use :name",
            ));
        };
        let name = raw
            .strip_prefix([':', '@', '$'])
            .unwrap_or(&raw)
            .to_string();
        // Missing → NULL: optional parameters use `(:x IS NULL OR …)`.
        let value = param_to_sql(&name, req.params.get(&name))?;
        stmt.raw_bind_parameter(index, value).map_err(|e| {
            AnalyticsError::new(ErrorCode::InvalidParam, format!("{name}: {e}")).with_object(name)
        })?;
    }
    Ok(())
}

/// Steps 7 to 12 on a connection that went through `prepare_connection`.
/// `sql` is the lexer's output.
pub fn execute(
    conn: &Connection,
    views: &[String],
    req: &RunQueryRequest,
    sql: &str,
    privacy: Privacy,
    guard: &Guard,
) -> Result<(QueryResult, usize), AnalyticsError> {
    let objects = authorizer::schema_objects(conn)
        .map_err(|e| super::open::setup_error("listing the objects", e))?;
    let scope = authorizer::Scope::new(views, objects);
    let log: Arc<Mutex<AuthLog>> = authorizer::install(conn, privacy, scope);
    let deadline = guard.deadline;
    let cancel = Arc::clone(&guard.cancel);
    let exceeded = Arc::clone(&guard.memory_exceeded);
    let shared = Arc::clone(&guard.memory_shared);
    let budget = guard.memory_budget;
    // The limit in place: the profile's, or a lower one (someone else's,
    // or a higher one still waiting to be lowered: the run's own counts).
    let limit = match current_heap_limit() {
        installed if installed > 0 => installed.min(guard.heap_limit),
        _ => guard.heap_limit,
    };
    let absolute = limit.saturating_sub(HEAP_HEADROOM_BYTES);
    let _active = ActiveRun::start();
    // Measured from here: the connection and its views are already built.
    let mut low = sqlite_memory_used();
    conn.progress_handler(
        PROGRESS_STEPS,
        Some(move || {
            if cancel.load(Ordering::Relaxed) || Instant::now() > deadline {
                return true;
            }
            // SQLite only counts the whole process (no figure per
            // connection), so another run's memory counts too: it can
            // stop this run sooner, never later. The app's queue keeps
            // free SQL (Explorer, assistant, proposals) alone and only
            // pairs prebuilt queries, which stay far under the budget
            // (43 MB at most, review A, H1); the absolute ceiling holds
            // whatever runs.
            let used = sqlite_memory_used();
            low = low.min(used);
            if over_memory(used, low, budget, absolute) {
                shared.store(active_runs() > 1, Ordering::Relaxed);
                exceeded.store(true, Ordering::Relaxed);
                return true;
            }
            false
        }),
    );

    let snapshot = |log: &Arc<Mutex<AuthLog>>| log.lock().map(|l| l.clone()).unwrap_or_default();

    // Never `prepare_cached`: the authorizer only runs at prepare time.
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| map_error(e, &req.sql, Some(&snapshot(&log)), guard))?;
    if !stmt.readonly() {
        return Err(AnalyticsError::new(
            ErrorCode::NotReadOnly,
            "Only read queries are allowed",
        ));
    }
    bind(&mut stmt, req)?;

    let columns: Vec<ResultColumn> = stmt
        .columns()
        .iter()
        .map(|column| ResultColumn {
            name: column.name().to_string(),
            decl_type: column.decl_type().map(String::from),
        })
        .collect();
    let column_count = columns.len();
    let mut bytes: usize = columns.iter().map(|c| c.name.len() + 32).sum::<usize>() + 128;
    let max_rows = req.max_rows as usize;
    let mut out: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;
    {
        let mut rows = stmt.raw_query();
        loop {
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(e) => return Err(map_error(e, &req.sql, Some(&snapshot(&log)), guard)),
            };
            if out.len() == max_rows {
                truncated = true;
                break;
            }
            let mut values = Vec::with_capacity(column_count);
            bytes += 2;
            for index in 0..column_count {
                let value = row
                    .get_ref(index)
                    .map(to_json)
                    .map_err(|e| AnalyticsError::internal(e.to_string()))?;
                bytes += json_size(&value);
                values.push(value);
            }
            if bytes > guard.result_bytes {
                return Err(AnalyticsError::new(
                    ErrorCode::TooLarge,
                    format!(
                        "The result exceeds {} MB after {} rows",
                        guard.result_bytes / (1024 * 1024),
                        out.len()
                    ),
                ));
            }
            out.push(values);
        }
    }
    // An interrupt can also end a statement as "done" in rare cases: the
    // flags decide.
    if guard.is_cancelled() {
        return Err(guard.error());
    }
    drop(stmt);
    conn.progress_handler(0, None::<fn() -> bool>);

    let log = snapshot(&log);
    let result = QueryResult {
        columns,
        rows: out,
        truncated,
        elapsed_ms: u64::try_from(guard.started.elapsed().as_millis()).unwrap_or(u64::MAX),
        ignored_columns: log.ignored.into_iter().collect(),
        cached: false,
    };
    Ok((result, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};

    fn request() -> RunQueryRequest {
        RunQueryRequest {
            request_id: "r".into(),
            sql: "SELECT 1".into(),
            params: Map::new(),
            max_rows: 10,
            timeout_ms: 1000,
            privacy: Privacy::Nominative,
            now: "2026-06-20T09:47".into(),
            use_cache: true,
        }
    }

    #[test]
    fn validates_param_names() {
        for good in ["season", "a", "boat_class", "x1", &"a".repeat(32)] {
            assert!(is_param_name(good), "{good}");
        }
        for bad in ["", "Season", "1a", "_a", "a-b", "é", &"a".repeat(33)] {
            assert!(!is_param_name(bad), "{bad}");
        }
    }

    #[test]
    fn validates_requests() {
        assert!(validate_request(&request()).is_ok());
        let check = |edit: &dyn Fn(&mut RunQueryRequest), code: ErrorCode| {
            let mut req = request();
            edit(&mut req);
            assert_eq!(validate_request(&req).unwrap_err().code, code);
        };
        check(
            &|r| r.sql = "x".repeat(MAX_SQL_BYTES + 1),
            ErrorCode::Syntax,
        );
        check(&|r| r.max_rows = 0, ErrorCode::Internal);
        check(&|r| r.max_rows = MAX_ROWS + 1, ErrorCode::Internal);
        check(&|r| r.timeout_ms = 99, ErrorCode::Internal);
        check(&|r| r.timeout_ms = MAX_TIMEOUT_MS + 1, ErrorCode::Internal);
        check(&|r| r.now = "2026-06-20 09:47".into(), ErrorCode::Internal);
        check(
            &|r| r.now = "2026-06-20T09:47'; --".into(),
            ErrorCode::Internal,
        );
        check(
            &|r| {
                r.params.insert("Bad".into(), json!(1));
            },
            ErrorCode::InvalidParam,
        );
        let mut req = request();
        req.max_rows = MAX_ROWS;
        req.timeout_ms = MIN_TIMEOUT_MS;
        req.sql = "x".repeat(MAX_SQL_BYTES);
        assert!(validate_request(&req).is_ok());
    }

    #[test]
    fn keeps_a_lower_heap_limit_and_follows_its_own() {
        let mb = 1024 * 1024;
        let idle = 20 * mb;
        // None yet.
        assert_eq!(next_heap_limit(0, 0, 512 * mb, idle), Some(512 * mb));
        // Already there.
        assert_eq!(next_heap_limit(512 * mb, 512 * mb, 512 * mb, idle), None);
        // Its own limit follows a change of profile, both ways.
        assert_eq!(
            next_heap_limit(512 * mb, 512 * mb, 2048 * mb, idle),
            Some(2048 * mb)
        );
        assert_eq!(
            next_heap_limit(2048 * mb, 2048 * mb, 512 * mb, idle),
            Some(512 * mb)
        );
        // Someone else's: a lower one stays, a higher one is lowered.
        assert_eq!(next_heap_limit(256 * mb, 512 * mb, 1024 * mb, idle), None);
        assert_eq!(
            next_heap_limit(4096 * mb, 512 * mb, 1024 * mb, idle),
            Some(1024 * mb)
        );
    }

    /// Review D, L1: a 700 MB run of Puissant is still going when the club
    /// switches to Économe.
    #[test]
    fn never_lowers_the_heap_limit_under_what_is_in_use() {
        let mb = 1024 * 1024;
        let busy = 700 * mb;
        assert_eq!(
            next_heap_limit(2048 * mb, 2048 * mb, 512 * mb, busy),
            Some(busy + HEAP_HEADROOM_BYTES)
        );
        // Once it has ended, the next run lowers it the rest of the way.
        let after = busy + HEAP_HEADROOM_BYTES;
        assert_eq!(
            next_heap_limit(after, after, 512 * mb, 30 * mb),
            Some(512 * mb)
        );
        // Never raised by this rule: in use near the limit, it stays.
        assert_eq!(
            next_heap_limit(1024 * mb, 1024 * mb, 512 * mb, 900 * mb),
            None
        );
        // Raising is never held back.
        assert_eq!(
            next_heap_limit(512 * mb, 512 * mb, 1024 * mb, busy),
            Some(1024 * mb)
        );
    }

    /// Review D, M1: the absolute ceiling holds whatever the budget, and
    /// memory a neighbour frees is not room for this run.
    #[test]
    fn memory_stops_at_the_budget_or_the_absolute_ceiling() {
        let mb = 1024 * 1024;
        let (budget, absolute) = (384 * mb, 768 * mb);
        // Alone: its own growth.
        assert!(!over_memory(400 * mb, 20 * mb, budget, absolute));
        assert!(over_memory(405 * mb, 20 * mb, budget, absolute));
        // A neighbour held 300 MB when it started, then freed it: the
        // lowest point (50 MB) counts, not the start (350 MB).
        assert!(over_memory(500 * mb, 50 * mb, budget, absolute));
        // Two runs together never pass the absolute ceiling.
        assert!(over_memory(770 * mb, 600 * mb, budget, absolute));
        assert!(!over_memory(760 * mb, 600 * mb, budget, absolute));
    }

    #[test]
    fn a_guard_takes_the_limits_of_its_profile() {
        let flag = Arc::new(AtomicBool::new(false));
        let economy = Guard::with_limits(flag.clone(), 1000, &crate::perf::ECONOMY);
        assert_eq!(economy.memory_budget, MEMORY_BUDGET_BYTES);
        assert_eq!(economy.heap_limit, HEAP_HARD_LIMIT_BYTES);
        assert_eq!(economy.result_bytes, MAX_RESULT_BYTES);
        let powerful = Guard::with_limits(flag, 1000, &crate::perf::POWERFUL);
        assert_eq!(powerful.memory_budget, 768 * 1024 * 1024);
        assert_eq!(powerful.heap_limit, 2048 * 1024 * 1024);
        assert_eq!(powerful.result_bytes, 64 * 1024 * 1024);
        assert!(powerful.error().message.contains("1000 ms"));
    }
}
