//! The read-only SQL engine (plan 2.2, ADR 0008).
//!
//! Each query gets a fresh connection: opened `SQLITE_OPEN_READ_ONLY`
//! (`open.rs`), limits and defensive settings applied, TEMP views of
//! `views.sql` created, then `PRAGMA query_only = ON` and
//! `trusted_schema = OFF`; the authorizer (`authorizer.rs`) allows reads of
//! the views and the dictionary tables only and turns private columns into
//! NULL; the statement must pass the single-statement lexer (`lexer.rs`)
//! and `readonly()`; a progress handler enforces the deadline, the
//! cancel flag and the memory budget; at most `maxRows + 1` rows are
//! stepped (`run.rs`), and values are converted for JavaScript
//! (`values.rs`). Results are cached by
//! `PRAGMA data_version` (`cache.rs`).
//!
//! Nothing here ever writes `main.db`: tests compare the file bytes.

pub mod authorizer;
pub mod cache;
pub mod lexer;
pub mod open;
pub mod run;
pub mod values;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::error::AnalyticsError;
use crate::ipc::{EngineObjects, Privacy, QueryResult, RunQueryRequest};
use crate::perf::PerformanceLimits;

use cache::{ResultCache, Stamp};

/// Where and how a query runs. The app passes `nominative` and the path of
/// `paths::db_path()`; the MCP server its own settings. Both pass the
/// limits of the club's performance profile, read from `main.db` and
/// resolved on this machine (`perf::resolve`): the request's `maxRows` and
/// `timeoutMs` are clamped to them, and they set the memory budget, the
/// result size and the process-wide heap limit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineContext {
    pub db_path: PathBuf,
    pub privacy: Privacy,
    pub limits: PerformanceLimits,
}

impl EngineContext {
    /// A context with Économe's limits (tests, tools).
    pub fn economy(db_path: PathBuf, privacy: Privacy) -> Self {
        EngineContext {
            db_path,
            privacy,
            limits: crate::perf::ECONOMY,
        }
    }
}

/// Cancels received before their query started (the command can overtake
/// the query on its way to the blocking thread). Bounded.
const EARLY_CANCELS: usize = 32;

/// Long-lived state shared by the commands (managed by Tauri as
/// `Arc<EngineState>`): cancel flags by request id, the result cache and
/// the `data_version` connection.
#[derive(Debug, Default)]
pub struct EngineState {
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    early_cancels: Mutex<VecDeque<String>>,
    /// Set by `cancel_all`, never cleared: a run that registers after it
    /// (the next call of the same batch line) is cancelled too (review C, 2).
    closing: AtomicBool,
    cache: Mutex<ResultCache>,
    stamp: Mutex<Option<Stamp>>,
}

impl EngineState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of cached results (tests and diagnostics).
    pub fn cached_results(&self) -> usize {
        self.cache.lock().map(|c| c.len()).unwrap_or(0)
    }

    /// Drops every cached result.
    pub fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.clear();
        }
    }
}

/// Removes the cancel flag of a run when it ends, however it ends.
struct CancelRegistration<'a> {
    state: &'a EngineState,
    request_id: &'a str,
    flag: Arc<AtomicBool>,
}

impl<'a> CancelRegistration<'a> {
    fn new(state: &'a EngineState, request_id: &'a str) -> Self {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut early) = state.early_cancels.lock() {
            if let Some(index) = early.iter().position(|id| id == request_id) {
                early.remove(index);
                flag.store(true, Ordering::Relaxed);
            }
        }
        if let Ok(mut cancels) = state.cancels.lock() {
            cancels.insert(request_id.to_string(), Arc::clone(&flag));
        }
        // Read after the insert: `cancel_all` sets `closing` before it
        // takes the lock, so a run it does not see under the lock sees
        // `closing` here.
        if state.closing.load(Ordering::SeqCst) {
            flag.store(true, Ordering::Relaxed);
        }
        CancelRegistration {
            state,
            request_id,
            flag,
        }
    }
}

impl Drop for CancelRegistration<'_> {
    fn drop(&mut self) {
        if let Ok(mut cancels) = self.state.cancels.lock() {
            // Only our own flag: a run reusing the id keeps its flag.
            if cancels
                .get(self.request_id)
                .is_some_and(|flag| Arc::ptr_eq(flag, &self.flag))
            {
                cancels.remove(self.request_id);
            }
        }
    }
}

/// The privacy of a run: the stricter of the context (set by the app or
/// the MCP server) and the request (sent by the webview or a client), so a
/// request can never read more than its context allows.
pub fn effective_privacy(ctx: Privacy, req: Privacy) -> Privacy {
    if ctx == Privacy::Pseudonymised || req == Privacy::Pseudonymised {
        Privacy::Pseudonymised
    } else {
        Privacy::Nominative
    }
}

/// Runs one read-only query. Blocking: call it from `spawn_blocking`.
pub fn run_query(
    state: &EngineState,
    ctx: &EngineContext,
    req: &RunQueryRequest,
) -> Result<QueryResult, AnalyticsError> {
    let limits = &ctx.limits;
    run::install_heap_limit(i64::try_from(limits.heap_limit_bytes).unwrap_or(i64::MAX));
    let registration = CancelRegistration::new(state, &req.request_id);
    // Clamped to the profile, never widened: the webview and MCP clients
    // only ever get less than the profile allows.
    let timeout_ms = req.timeout_ms.min(limits.max_timeout_ms);
    let guard = run::Guard::with_limits(Arc::clone(&registration.flag), timeout_ms, limits);

    run::validate_request(req)?;
    let clamped;
    let req = if req.max_rows > limits.max_rows || req.timeout_ms != timeout_ms {
        clamped = RunQueryRequest {
            max_rows: req.max_rows.min(limits.max_rows),
            timeout_ms,
            ..req.clone()
        };
        &clamped
    } else {
        req
    };
    let lexed = lexer::check_sql(&req.sql)?;
    let privacy = effective_privacy(ctx.privacy, req.privacy);

    let cache_key = state
        .stamp
        .lock()
        .ok()
        .and_then(|mut slot| cache::database_version(&mut slot, &ctx.db_path))
        .map(|version| {
            cache::cache_key(
                &ctx.db_path,
                &version,
                &lexed.sql,
                &req.params,
                privacy,
                req.max_rows,
                &req.now,
            )
        });
    if req.use_cache {
        if let Some(key) = &cache_key {
            if let Some(mut hit) = state.cache.lock().ok().and_then(|mut c| c.get(key)) {
                hit.cached = true;
                return Ok(hit);
            }
        }
    }

    if guard.is_cancelled() {
        return Err(guard.error());
    }
    let prepared = open::prepare_connection(&ctx.db_path, &req.now)?;
    let (result, bytes) = run::execute(
        &prepared.conn,
        &prepared.views,
        req,
        &lexed.sql,
        privacy,
        &guard,
    )?;
    drop(prepared);

    // A fresh result is valid whatever `useCache` said.
    if let Some(key) = cache_key {
        if let Ok(mut cache) = state.cache.lock() {
            cache.put(key, result.clone(), bytes);
        }
    }
    drop(registration);
    Ok(result)
}

/// Stops a running query (its progress handler sees the flag). An unknown
/// id is remembered for a short while, in case the cancel overtook its
/// query; ids are uuids, so a finished query is never hit by it.
pub fn cancel(state: &EngineState, request_id: &str) {
    if let Ok(cancels) = state.cancels.lock() {
        if let Some(flag) = cancels.get(request_id) {
            flag.store(true, Ordering::Relaxed);
            return;
        }
    }
    if let Ok(mut early) = state.early_cancels.lock() {
        if !early.iter().any(|id| id == request_id) {
            if early.len() == EARLY_CANCELS {
                early.pop_front();
            }
            early.push_back(request_id.to_string());
        }
    }
}

/// Stops every query running on `state`, and every query started on it
/// afterwards (the MCP server when its client is gone).
pub fn cancel_all(state: &EngineState) {
    state.closing.store(true, Ordering::SeqCst);
    if let Ok(cancels) = state.cancels.lock() {
        for flag in cancels.values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// The local wall-clock time as SQLite sees it ("YYYY-MM-DDTHH:mm").
fn sqlite_local_now() -> Result<String, AnalyticsError> {
    let conn = rusqlite::Connection::open_in_memory()
        .map_err(|e| AnalyticsError::internal(e.to_string()))?;
    conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')",
        [],
        |row| row.get(0),
    )
    .map_err(|e| AnalyticsError::internal(e.to_string()))
}

/// Views created on this database (in `views.sql` order), the dictionary
/// tables that exist, and the views skipped because a table they need is
/// missing (or because SQLite refused them).
pub fn list_objects(ctx: &EngineContext) -> Result<EngineObjects, AnalyticsError> {
    let now = sqlite_local_now()?;
    let prepared = open::prepare_connection(&ctx.db_path, &now)?;
    Ok(EngineObjects {
        views: prepared.views,
        tables: prepared.tables,
        missing_views: prepared.missing_views,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_is_shareable_between_threads() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<EngineState>();
    }

    #[test]
    fn cancel_sets_the_flag_of_a_known_request() {
        let state = EngineState::new();
        let flag = Arc::new(AtomicBool::new(false));
        state
            .cancels
            .lock()
            .unwrap()
            .insert("a".into(), flag.clone());
        cancel(&state, "unknown");
        assert!(!flag.load(Ordering::Relaxed));
        cancel(&state, "a");
        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn cancel_all_sets_every_flag() {
        let state = EngineState::new();
        let flags: Vec<_> = ["a", "b"]
            .iter()
            .map(|id| {
                let flag = Arc::new(AtomicBool::new(false));
                state
                    .cancels
                    .lock()
                    .unwrap()
                    .insert(id.to_string(), flag.clone());
                flag
            })
            .collect();
        cancel_all(&state);
        assert!(flags.iter().all(|flag| flag.load(Ordering::Relaxed)));
        // Sticky: a run registering afterwards starts cancelled.
        let later = CancelRegistration::new(&state, "c");
        assert!(later.flag.load(Ordering::Relaxed));
    }

    #[test]
    fn a_run_after_cancel_all_is_cancelled_before_it_opens() {
        let db = std::env::temp_dir().join("rb-analytics-never-opened.db");
        let state = EngineState::new();
        cancel_all(&state);
        let ctx = EngineContext::economy(db, Privacy::Nominative);
        let req = RunQueryRequest {
            request_id: "after".into(),
            sql: "SELECT 1".into(),
            params: Default::default(),
            privacy: Privacy::Nominative,
            max_rows: 10,
            timeout_ms: 1000,
            use_cache: false,
            now: "2026-01-01T10:00".into(),
        };
        let error = run_query(&state, &ctx, &req).unwrap_err();
        assert_eq!(error.code, crate::error::ErrorCode::Cancelled, "{error}");
    }

    #[test]
    fn remembers_a_cancel_that_overtook_its_query() {
        let state = EngineState::new();
        cancel(&state, "early");
        let registration = CancelRegistration::new(&state, "early");
        assert!(registration.flag.load(Ordering::Relaxed));
        drop(registration);
        assert!(state.cancels.lock().unwrap().is_empty());
        // Consumed: the next run with that id is not cancelled.
        let again = CancelRegistration::new(&state, "early");
        assert!(!again.flag.load(Ordering::Relaxed));
    }

    #[test]
    fn bounds_early_cancels() {
        let state = EngineState::new();
        for i in 0..(EARLY_CANCELS + 10) {
            cancel(&state, &format!("id{i}"));
        }
        let early = state.early_cancels.lock().unwrap();
        assert_eq!(early.len(), EARLY_CANCELS);
        assert_eq!(early.front().unwrap(), "id10");
    }

    #[test]
    fn privacy_never_widens() {
        use Privacy::*;
        assert_eq!(effective_privacy(Nominative, Nominative), Nominative);
        assert_eq!(effective_privacy(Nominative, Pseudonymised), Pseudonymised);
        assert_eq!(effective_privacy(Pseudonymised, Nominative), Pseudonymised);
        assert_eq!(
            effective_privacy(Pseudonymised, Pseudonymised),
            Pseudonymised
        );
    }

    #[test]
    fn local_now_has_the_view_format() {
        assert!(open::is_local_date_time(&sqlite_local_now().unwrap()));
    }
}
