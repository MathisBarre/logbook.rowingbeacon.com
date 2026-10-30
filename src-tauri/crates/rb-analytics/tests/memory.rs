//! The memory budget of a run and the process-wide heap limit (review A,
//! H1; review C, 1; review D, M1). SQLite only counts the memory of the
//! whole process, so these tests live in a binary of their own, and run
//! one at a time: the other engine tests cannot stop them, nor be stopped
//! by them.

mod support;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rb_analytics::engine::{open, run};
use rb_analytics::error::ErrorCode;
use rb_analytics::ipc::Privacy;

use support::{request, TestDb, NOW};

/// One test at a time.
fn alone() -> MutexGuard<'static, ()> {
    static SERIAL: Mutex<()> = Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const ENDLESS_SORT: &str = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) \
                            SELECT i, printf('%.200c', 'x') AS pad FROM n ORDER BY random()";

/// Review A, H1: a sort over an endless CTE grew SQLite's heap by 3 GB
/// before its deadline. The progress handler stops it at the budget (a
/// small one here: fast).
#[test]
fn a_query_that_needs_too_much_memory_stops_at_its_budget() {
    let _alone = alone();
    let db = TestDb::new();
    let budget: i64 = 32 * 1024 * 1024;
    let stopped = |sql: &str| {
        let prepared = open::prepare_connection(&db.path, NOW).unwrap();
        let mut guard = run::Guard::new(Arc::new(AtomicBool::new(false)), 20_000);
        guard.memory_budget = budget;
        run::execute(
            &prepared.conn,
            &prepared.views,
            &request(sql),
            sql,
            Privacy::Nominative,
            &guard,
        )
        .map(|(result, _)| result.rows.len())
        .unwrap_err()
    };

    let started = Instant::now();
    let error = stopped(ENDLESS_SORT);
    assert_eq!(error.code, ErrorCode::TooLarge, "{error}");
    assert!(error.message.contains("32 MB"), "{error}");
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "stopped by the budget, not the deadline"
    );

    // Review C, 1: between two checks a statement can build about one
    // row, here 100 values of the longest length allowed. With 10 MB
    // values that row took the heap to 1 GB; with 1 MB values the run
    // peaks near the budget plus 200 MB (2 x 100 MB: printf grows its
    // buffer by doubling).
    let wide = format!(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT {} FROM n",
        (0..100)
            .map(|i| format!("printf('%.*c', 999000, 'x') AS c{i}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let before = run::sqlite_memory_used();
    // SAFETY: reads and resets SQLite's own high-water mark.
    unsafe { rusqlite::ffi::sqlite3_memory_highwater(1) };
    let error = stopped(&wide);
    // SAFETY: a read of SQLite's memory statistics.
    let peak = unsafe { rusqlite::ffi::sqlite3_memory_highwater(0) } - before;
    assert_eq!(error.code, ErrorCode::TooLarge, "{error}");
    assert!(error.message.contains("32 MB"), "{error}");
    assert!(
        peak < budget + 300 * 1024 * 1024,
        "peak {} MB",
        peak / (1024 * 1024)
    );
    // A value over 1 MB is refused before it is built.
    let error = stopped("SELECT length(replace(hex(zeroblob(600000)), '0', 'ab'))");
    assert_eq!(error.code, ErrorCode::TooLarge, "{error}");
    assert_eq!(open::MAX_VALUE_BYTES, 1_000_000);

    // The engine sets the process-wide backstop (Économe's here: every
    // test of this binary runs on Économe's heap limit).
    run::install_heap_limit(run::HEAP_HARD_LIMIT_BYTES);
    // SAFETY: a negative argument only reads the current limit.
    let limit = unsafe { rusqlite::ffi::sqlite3_hard_heap_limit64(-1) };
    assert_eq!(limit, run::HEAP_HARD_LIMIT_BYTES);
    assert_eq!(limit, 512 * 1024 * 1024);
}

/// Review D, M1: whatever its own budget, a run stops before SQLite's heap
/// reaches the process-wide limit minus the headroom, so the app's writes
/// keep their margin when two runs share the heap.
#[test]
fn a_run_stops_at_the_absolute_ceiling_whatever_its_budget() {
    let _alone = alone();
    run::install_heap_limit(run::HEAP_HARD_LIMIT_BYTES);
    let db = TestDb::new();
    let prepared = open::prepare_connection(&db.path, NOW).unwrap();
    let mb = 1024 * 1024;
    let mut guard = run::Guard::new(Arc::new(AtomicBool::new(false)), 20_000);
    // A budget the run never reaches, and a profile limit 32 MB above the
    // headroom: the ceiling is 32 MB over what SQLite holds now.
    guard.memory_budget = 4096 * mb;
    let ceiling = run::sqlite_memory_used() + 32 * mb;
    guard.heap_limit = ceiling + run::HEAP_HEADROOM_BYTES;
    // SAFETY: reads and resets SQLite's own high-water mark.
    unsafe { rusqlite::ffi::sqlite3_memory_highwater(1) };
    let started = Instant::now();
    let error = run::execute(
        &prepared.conn,
        &prepared.views,
        &request(ENDLESS_SORT),
        ENDLESS_SORT,
        Privacy::Nominative,
        &guard,
    )
    .map(|(result, _)| result.rows.len())
    .unwrap_err();
    // SAFETY: a read of SQLite's memory statistics.
    let peak = unsafe { rusqlite::ffi::sqlite3_memory_highwater(0) };
    assert_eq!(error.code, ErrorCode::TooLarge, "{error}");
    assert!(guard.memory_exceeded.load(Ordering::Relaxed));
    assert!(!guard.memory_shared.load(Ordering::Relaxed), "no other run");
    assert!(!error.message.contains("Another query"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(15));
    assert!(
        peak < ceiling + 16 * mb,
        "peak {} MB over",
        (peak - ceiling) / mb
    );
}

/// Review A, H1, on each profile: the endless sort stops at the profile's
/// budget, far below its heap limit and the machine's memory. Sets the
/// process-wide heap limit of each profile, and runs only with
/// `ANALYTICS_PERF=1`; it prints the measurements:
///
///   ANALYTICS_PERF=1 cargo test --release -p rb-analytics --test memory h1_probe -- --nocapture
#[test]
fn the_h1_probe_stops_at_the_budget_of_every_profile() {
    use rb_analytics::perf::{self, Profile};
    if std::env::var("ANALYTICS_PERF").as_deref() != Ok("1") {
        return;
    }
    let _alone = alone();
    let db = TestDb::new();
    let sql = ENDLESS_SORT;
    for profile in Profile::ALL {
        let limits = perf::base_limits(profile);
        run::install_heap_limit(i64::try_from(limits.heap_limit_bytes).unwrap());
        let prepared = open::prepare_connection(&db.path, NOW).unwrap();
        let guard = run::Guard::with_limits(
            Arc::new(AtomicBool::new(false)),
            limits.query_timeout_ms,
            &limits,
        );
        let before = run::sqlite_memory_used();
        // SAFETY: reads and resets SQLite's own high-water mark.
        unsafe { rusqlite::ffi::sqlite3_memory_highwater(1) };
        let started = Instant::now();
        let error = run::execute(
            &prepared.conn,
            &prepared.views,
            &request(sql),
            sql,
            Privacy::Nominative,
            &guard,
        )
        .map(|(result, _)| result.rows.len())
        .unwrap_err();
        let elapsed = started.elapsed();
        // SAFETY: a read of SQLite's memory statistics.
        let peak = unsafe { rusqlite::ffi::sqlite3_memory_highwater(0) } - before;
        drop(prepared);
        let mb = 1024 * 1024;
        println!(
            "H1 probe on {profile:?}: {} after {} ms, SQLite heap peak {} MB (budget {} MB, heap limit {} MB)",
            error.code,
            elapsed.as_millis(),
            peak / mb,
            limits.memory_budget_bytes / 1024 / 1024,
            limits.heap_limit_bytes / 1024 / 1024,
        );
        assert_eq!(error.code, ErrorCode::TooLarge, "{profile:?}: {error}");
        assert!(elapsed < Duration::from_millis(limits.query_timeout_ms));
        let budget = i64::try_from(limits.memory_budget_bytes).unwrap();
        let heap = i64::try_from(limits.heap_limit_bytes).unwrap();
        assert!(
            peak < budget + 64 * mb,
            "{profile:?}: peak {} MB",
            peak / mb
        );
        // Room left under the hard limit for one more row between two
        // checks (200 x 1 MB, review C).
        assert!(peak + 200 * mb < heap, "{profile:?}: peak {} MB", peak / mb);
    }
    run::install_heap_limit(run::HEAP_HARD_LIMIT_BYTES);
}
