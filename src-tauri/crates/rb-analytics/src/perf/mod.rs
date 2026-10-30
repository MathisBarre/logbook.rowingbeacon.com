//! Performance profiles (ADR 0008, "Performance profiles"): the limits of
//! the engine, the app and the MCP server, sized by machine.
//!
//! Économe keeps the values sized for a Raspberry Pi (plan 2.14); Standard
//! and Puissant give a laptop or a desktop more time, more rows and more
//! memory. The club chooses in Gestion › Statistiques et IA
//! (`analytics.performance.profile`: auto, economy, standard, powerful;
//! auto by default, which takes `MachineInfo::recommended`).
//!
//! Rust never trusts the webview with these: the app and the MCP server
//! read the setting from `main.db`, and the engine clamps every request
//! to the resolved profile (`EngineContext::limits`). The app's memory
//! limits never exceed about a quarter of the machine's memory, whatever
//! the profile. The MCP server is a process of its own with its own SQLite
//! heap: it takes the profile's times but always Économe's memory
//! (`mcp_limits`, review D, L2), so both together stay near a quarter.
//! These figures are SQLite's heap only: a large result also costs its
//! JSON in Rust and in the webview (a few times `result_bytes`).
//!
//! The TypeScript mirror is `src/analytics/engine/performance.ts`; both
//! sides test against `src/analytics/engine/performance-fixtures.json`.

pub mod detect;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::engine::run;

/// The setting the club chooses its profile with.
pub const PROFILE_KEY: &str = "analytics.performance.profile";

const MIB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Profile {
    /// Raspberry Pi and small machines: the limits the app was built with.
    Economy,
    Standard,
    Powerful,
}

impl Profile {
    pub const ALL: [Profile; 3] = [Profile::Economy, Profile::Standard, Profile::Powerful];

    pub fn as_str(self) -> &'static str {
        match self {
            Profile::Economy => "economy",
            Profile::Standard => "standard",
            Profile::Powerful => "powerful",
        }
    }

    /// One level down (Économe stays Économe).
    pub fn lower(self) -> Profile {
        match self {
            Profile::Powerful => Profile::Standard,
            _ => Profile::Economy,
        }
    }
}

/// What the club chose; `Auto` follows the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileChoice {
    #[default]
    Auto,
    Economy,
    Standard,
    Powerful,
}

impl ProfileChoice {
    /// The JSON value of the setting; anything else is `Auto`.
    pub fn from_setting(value: &serde_json::Value) -> ProfileChoice {
        serde_json::from_value(value.clone()).unwrap_or_default()
    }

    pub fn resolve(self, machine: &MachineInfo) -> Profile {
        match self {
            ProfileChoice::Auto => machine.recommended,
            ProfileChoice::Economy => Profile::Economy,
            ProfileChoice::Standard => Profile::Standard,
            ProfileChoice::Powerful => Profile::Powerful,
        }
    }
}

/// The limits of one profile. Times in milliseconds, sizes in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerformanceLimits {
    /// Explorer, AI assistant and proposal previews.
    pub query_timeout_ms: u64,
    /// A report and the annual report.
    pub report_timeout_ms: u64,
    /// One dashboard card.
    pub card_timeout_ms: u64,
    /// The engine clamps every request's `timeoutMs` to this (also the
    /// ceiling of the Explorer's "longest query" setting).
    pub max_timeout_ms: u64,
    /// MCP `run_query` and `propose_chart`'s dry run.
    pub mcp_query_timeout_ms: u64,
    /// MCP `run_report`.
    pub mcp_report_timeout_ms: u64,
    /// Rows the Explorer and the AI assistant fetch when the club has not
    /// set `analytics.editor.maxRows`.
    pub editor_rows: u32,
    /// The engine clamps every request's `maxRows` to this.
    pub max_rows: u32,
    /// Rows of an MCP answer.
    pub mcp_max_rows: u32,
    /// Largest result sent to the webview (JSON estimate).
    pub result_bytes: u64,
    /// SQLite heap one run may add (progress handler).
    pub memory_budget_bytes: u64,
    /// Process-wide `sqlite3_hard_heap_limit64` (shared with the app's sqlx
    /// connections): `concurrent_queries` runs at their budget leave 256 MB
    /// (`run::HEAP_HEADROOM_BYTES`) under it, and every run stops there.
    pub heap_limit_bytes: u64,
    /// Queries the app's queue runs at once (each on its own read-only
    /// WAL connection).
    pub concurrent_queries: u32,
}

/// Plan 2.14, unchanged: a Raspberry Pi 4 runs the heaviest report in
/// 5-15 s on a ten-year history.
pub const ECONOMY: PerformanceLimits = PerformanceLimits {
    query_timeout_ms: 10_000,
    report_timeout_ms: 20_000,
    card_timeout_ms: 20_000,
    max_timeout_ms: 30_000,
    mcp_query_timeout_ms: 10_000,
    mcp_report_timeout_ms: 20_000,
    editor_rows: 1_000,
    max_rows: 5_000,
    mcp_max_rows: 500,
    result_bytes: run::MAX_RESULT_BYTES as u64,
    memory_budget_bytes: run::MEMORY_BUDGET_BYTES as u64,
    heap_limit_bytes: run::HEAP_HARD_LIMIT_BYTES as u64,
    concurrent_queries: 1,
};

/// A recent laptop (8 GB, 4 cores or more).
pub const STANDARD: PerformanceLimits = PerformanceLimits {
    query_timeout_ms: 30_000,
    report_timeout_ms: 60_000,
    card_timeout_ms: 30_000,
    max_timeout_ms: 120_000,
    // MCP clients give up on a tool call after about 60 s.
    mcp_query_timeout_ms: 20_000,
    mcp_report_timeout_ms: 40_000,
    editor_rows: 5_000,
    max_rows: 20_000,
    // The client's context, not the machine, bounds an MCP answer.
    mcp_max_rows: 500,
    result_bytes: 32 * MIB,
    memory_budget_bytes: 384 * MIB,
    heap_limit_bytes: 1024 * MIB,
    concurrent_queries: 2,
};

/// A desktop or a workstation (16 GB, 8 cores or more).
pub const POWERFUL: PerformanceLimits = PerformanceLimits {
    query_timeout_ms: 60_000,
    report_timeout_ms: 120_000,
    card_timeout_ms: 60_000,
    max_timeout_ms: 300_000,
    mcp_query_timeout_ms: 30_000,
    mcp_report_timeout_ms: 50_000,
    editor_rows: 10_000,
    max_rows: 50_000,
    mcp_max_rows: 500,
    result_bytes: 64 * MIB,
    memory_budget_bytes: 768 * MIB,
    heap_limit_bytes: 2048 * MIB,
    concurrent_queries: 2,
};

/// The table of a profile, before the machine's memory is considered.
pub fn base_limits(profile: Profile) -> PerformanceLimits {
    match profile {
        Profile::Economy => ECONOMY,
        Profile::Standard => STANDARD,
        Profile::Powerful => POWERFUL,
    }
}

/// Whether a profile's heap limit fits the machine: at most a quarter of
/// its memory, with 10 % of tolerance for what firmware and GPU keep
/// (an "8 GB" machine reports 7.6 GiB). Économe always fits: it is the
/// floor the app has always used.
pub fn memory_fits(profile: Profile, total_memory: Option<u64>) -> bool {
    profile == Profile::Economy
        || total_memory.is_some_and(|memory| {
            memory >= base_limits(profile).heap_limit_bytes.saturating_mul(4) / 10 * 9
        })
}

/// The limits of `profile` on a machine with `total_memory`: times and
/// rows of the profile; memory, result size and concurrency of the
/// highest profile up to it that fits the machine's memory (unknown
/// memory: Économe's).
pub fn limits_on(profile: Profile, total_memory: Option<u64>) -> PerformanceLimits {
    let memory = Profile::ALL
        .into_iter()
        .rev()
        .filter(|p| *p <= profile)
        .find(|p| memory_fits(*p, total_memory))
        .unwrap_or(Profile::Economy);
    let of_memory = base_limits(memory);
    PerformanceLimits {
        result_bytes: of_memory.result_bytes,
        memory_budget_bytes: of_memory.memory_budget_bytes,
        heap_limit_bytes: of_memory.heap_limit_bytes,
        concurrent_queries: of_memory.concurrent_queries,
        ..base_limits(profile)
    }
}

/// What `detect::detect` found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MachineInfo {
    /// Physical memory; null when it could not be read.
    pub total_memory_bytes: Option<u64>,
    pub logical_cpus: u32,
    /// `std::env::consts::ARCH`: "x86_64", "aarch64", "arm"…
    pub arch: String,
    /// `std::env::consts::OS`: "linux", "macos", "windows"…
    pub os: String,
    pub raspberry_pi: bool,
    /// The profile `auto` resolves to.
    pub recommended: Profile,
}

/// This machine, detected once per process.
pub fn machine() -> &'static MachineInfo {
    static MACHINE: OnceLock<MachineInfo> = OnceLock::new();
    MACHINE.get_or_init(detect::detect)
}

/// The profile and limits a choice gives on `machine`.
pub fn resolve(choice: ProfileChoice, machine: &MachineInfo) -> (Profile, PerformanceLimits) {
    let profile = choice.resolve(machine);
    (profile, limits_on(profile, machine.total_memory_bytes))
}

/// The limits of the MCP server for a profile's limits: its times and
/// rows, Économe's memory, result size and concurrency (review D, L2).
/// The server is another process with its own SQLite heap, and an MCP
/// answer holds 500 rows at most, so a bigger budget would only add to
/// the app's.
pub fn mcp_limits(limits: PerformanceLimits) -> PerformanceLimits {
    PerformanceLimits {
        result_bytes: ECONOMY.result_bytes,
        memory_budget_bytes: ECONOMY.memory_budget_bytes,
        heap_limit_bytes: ECONOMY.heap_limit_bytes,
        concurrent_queries: ECONOMY.concurrent_queries,
        ..limits
    }
}

/// The setting's raw JSON text (the `setting.value` column); anything
/// unreadable is `Auto`.
pub fn parse_choice(raw: Option<&str>) -> ProfileChoice {
    raw.and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .map(|value| ProfileChoice::from_setting(&value))
        .unwrap_or_default()
}

/// How long reading the setting may run (a crafted `setting` view could
/// otherwise loop).
const READ_DEADLINE: Duration = Duration::from_secs(1);

/// The setting on an open connection: `Auto` when the table or the row is
/// missing, `Err` when they exist but cannot be read.
fn read_choice_on(conn: &rusqlite::Connection) -> Result<ProfileChoice, rusqlite::Error> {
    let deadline = Instant::now() + READ_DEADLINE;
    conn.progress_handler(1_000, Some(move || Instant::now() > deadline));
    let read = (|| {
        let kind: Option<String> = match conn.query_row(
            "SELECT type FROM main.sqlite_master WHERE name = 'setting'",
            [],
            |row| row.get(0),
        ) {
            Ok(kind) => Some(kind),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(error) => return Err(error),
        };
        match kind.as_deref() {
            None => return Ok(ProfileChoice::Auto),
            Some("table") => {}
            // Not the app's table: nothing to trust in it.
            Some(_) => return Err(rusqlite::Error::InvalidQuery),
        }
        match conn.query_row(
            "SELECT value FROM main.setting WHERE key = ?1",
            [PROFILE_KEY],
            |row| row.get::<_, Option<String>>(0),
        ) {
            Ok(raw) => Ok(parse_choice(raw.as_deref())),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(ProfileChoice::Auto),
            Err(error) => Err(error),
        }
    })();
    conn.progress_handler(0, None::<fn() -> bool>);
    read
}

/// The connection `read_choice` keeps, and the choice it read at a
/// `PRAGMA data_version`.
struct SettingsReader {
    path: PathBuf,
    identity: Option<(u64, u64)>,
    conn: rusqlite::Connection,
    read: Option<(i64, ProfileChoice)>,
}

fn cached_choice(slot: &mut Option<SettingsReader>, db_path: &Path) -> Result<ProfileChoice, ()> {
    let identity = crate::engine::cache::file_identity(db_path);
    let stale = match slot {
        Some(reader) => reader.path != db_path || reader.identity != identity,
        None => true,
    };
    if stale {
        *slot = None;
        let conn = crate::engine::open::open_settings_reader(db_path).map_err(drop)?;
        *slot = Some(SettingsReader {
            path: db_path.to_path_buf(),
            identity,
            conn,
            read: None,
        });
    }
    let reader = slot.as_mut().ok_or(())?;
    let version: i64 = reader
        .conn
        .query_row("PRAGMA data_version", [], |row| row.get(0))
        .map_err(drop)?;
    if let Some((read_at, choice)) = reader.read {
        if read_at == version {
            return Ok(choice);
        }
    }
    let choice = read_choice_on(&reader.conn).map_err(drop)?;
    reader.read = Some((version, choice));
    Ok(choice)
}

/// `analytics.performance.profile` of `main.db`, read-only (review D, M2):
///
/// - `Auto` when the database, the table or the row is missing (a new
///   club);
/// - Économe, never a wider profile, when they exist but cannot be read
///   (busy, locked, unreadable value, slow read…): the club may have
///   chosen Économe to protect the logbook;
/// - otherwise the club's choice.
///
/// One hardened read-only connection is kept for the process, and the
/// value is read again only when `PRAGMA data_version` says another
/// connection committed (or the file was replaced).
pub fn read_choice(db_path: &Path) -> ProfileChoice {
    static READER: Mutex<Option<SettingsReader>> = Mutex::new(None);
    if !db_path.is_file() {
        return ProfileChoice::Auto;
    }
    let Ok(mut slot) = READER.lock() else {
        return ProfileChoice::Economy;
    };
    cached_choice(&mut slot, db_path).unwrap_or_else(|()| {
        // Opened again next time.
        *slot = None;
        ProfileChoice::Economy
    })
}

/// The limits of the app's engine: the club's choice on this machine.
pub fn app_limits(db_path: &Path) -> PerformanceLimits {
    resolve(read_choice(db_path), machine()).1
}

/// Whether a heavier profile than `profile` would suit this machine (the
/// "choose a faster profile" hint of a timeout or a too-large result).
pub fn could_go_higher(profile: Profile, machine: &MachineInfo) -> bool {
    profile < machine.recommended
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const FIXTURES: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../src/analytics/engine/performance-fixtures.json"
    ));

    fn fixtures() -> Value {
        serde_json::from_str(FIXTURES).unwrap()
    }

    #[test]
    fn economy_keeps_the_limits_sized_for_a_pi() {
        assert_eq!(ECONOMY.query_timeout_ms, 10_000);
        assert_eq!(ECONOMY.report_timeout_ms, 20_000);
        assert_eq!(ECONOMY.max_timeout_ms, 30_000);
        assert_eq!(ECONOMY.mcp_query_timeout_ms, 10_000);
        assert_eq!(ECONOMY.mcp_report_timeout_ms, 20_000);
        assert_eq!(ECONOMY.max_rows, 5_000);
        assert_eq!(ECONOMY.mcp_max_rows, 500);
        assert_eq!(ECONOMY.result_bytes, 8 * MIB);
        assert_eq!(ECONOMY.memory_budget_bytes, 256 * MIB);
        assert_eq!(ECONOMY.heap_limit_bytes, 512 * MIB);
        assert_eq!(ECONOMY.concurrent_queries, 1);
    }

    #[test]
    fn profiles_only_widen() {
        for (low, high) in [(ECONOMY, STANDARD), (STANDARD, POWERFUL)] {
            assert!(low.query_timeout_ms <= high.query_timeout_ms);
            assert!(low.report_timeout_ms <= high.report_timeout_ms);
            assert!(low.card_timeout_ms <= high.card_timeout_ms);
            assert!(low.max_timeout_ms <= high.max_timeout_ms);
            assert!(low.mcp_query_timeout_ms <= high.mcp_query_timeout_ms);
            assert!(low.mcp_report_timeout_ms <= high.mcp_report_timeout_ms);
            assert!(low.max_rows <= high.max_rows);
            assert!(low.result_bytes <= high.result_bytes);
            assert!(low.memory_budget_bytes <= high.memory_budget_bytes);
            assert!(low.heap_limit_bytes <= high.heap_limit_bytes);
        }
        for limits in [ECONOMY, STANDARD, POWERFUL] {
            // Every timeout the app sends stays under the engine's clamp,
            // and under the engine's absolute bounds.
            for timeout in [
                limits.query_timeout_ms,
                limits.report_timeout_ms,
                limits.card_timeout_ms,
                limits.mcp_query_timeout_ms,
                limits.mcp_report_timeout_ms,
            ] {
                assert!(timeout <= limits.max_timeout_ms);
            }
            assert!(limits.max_timeout_ms <= run::MAX_TIMEOUT_MS);
            assert!(limits.max_rows <= run::MAX_ROWS);
            assert!(limits.editor_rows <= limits.max_rows);
            // MCP clients stop waiting after about 60 s.
            assert!(limits.mcp_report_timeout_ms < 60_000);
            // Every run at its budget at once still leaves 256 MB under
            // the hard limit: one more row between two checks (200 x 1 MB,
            // review C) and the app's own connections.
            assert!(
                u64::from(limits.concurrent_queries) * limits.memory_budget_bytes
                    + run::HEAP_HEADROOM_BYTES as u64
                    <= limits.heap_limit_bytes
            );
            assert!(limits.heap_limit_bytes <= 2048 * MIB);
        }
    }

    #[test]
    fn memory_never_exceeds_a_quarter_of_the_machine() {
        let gib = |n: u64| Some(n * 1024 * MIB);
        // A 2 GB Pi forced on Puissant: longer times, Économe's memory.
        let pi = limits_on(Profile::Powerful, gib(2));
        assert_eq!(pi.query_timeout_ms, POWERFUL.query_timeout_ms);
        assert_eq!(pi.heap_limit_bytes, ECONOMY.heap_limit_bytes);
        assert_eq!(pi.memory_budget_bytes, ECONOMY.memory_budget_bytes);
        assert_eq!(pi.concurrent_queries, 1);
        // A 4 GB Pi (3.7 GiB): Standard's memory.
        let four = limits_on(Profile::Powerful, Some(3_884_076 * 1024));
        assert_eq!(four.heap_limit_bytes, STANDARD.heap_limit_bytes);
        // "8 GB" reporting 7.6 GiB: Puissant's memory.
        let eight = limits_on(Profile::Powerful, Some(7_970_000 * 1024));
        assert_eq!(eight, POWERFUL);
        // Unknown memory: Économe's.
        assert_eq!(
            limits_on(Profile::Standard, None).heap_limit_bytes,
            ECONOMY.heap_limit_bytes
        );
        assert_eq!(limits_on(Profile::Economy, gib(64)), ECONOMY);
        for profile in Profile::ALL {
            for memory in [1, 2, 3, 4, 6, 8, 12, 16, 32, 64] {
                let limits = limits_on(profile, gib(memory));
                assert!(
                    limits.heap_limit_bytes <= ECONOMY.heap_limit_bytes
                        || limits.heap_limit_bytes * 4 / 10 * 9 <= memory * 1024 * MIB,
                    "{profile:?} on {memory} GiB"
                );
            }
        }
    }

    #[test]
    fn reads_the_choice() {
        assert_eq!(parse_choice(None), ProfileChoice::Auto);
        assert_eq!(parse_choice(Some("\"economy\"")), ProfileChoice::Economy);
        assert_eq!(parse_choice(Some("\"standard\"")), ProfileChoice::Standard);
        assert_eq!(parse_choice(Some("\"powerful\"")), ProfileChoice::Powerful);
        assert_eq!(parse_choice(Some("\"auto\"")), ProfileChoice::Auto);
        for bad in ["", "economy", "\"turbo\"", "3", "null", "{\"a\":1}"] {
            assert_eq!(parse_choice(Some(bad)), ProfileChoice::Auto, "{bad}");
        }
        assert_eq!(
            ProfileChoice::from_setting(&json!("powerful")),
            ProfileChoice::Powerful
        );
    }

    #[test]
    fn reads_the_setting_from_the_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("main.db");
        assert_eq!(read_choice(&path), ProfileChoice::Auto);
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE other (x);").unwrap();
        assert_eq!(read_choice(&path), ProfileChoice::Auto);
        conn.execute_batch("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        assert_eq!(read_choice(&path), ProfileChoice::Auto);
        conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, '\"standard\"')",
            [PROFILE_KEY],
        )
        .unwrap();
        assert_eq!(read_choice(&path), ProfileChoice::Standard);
        // Read again after a commit (data_version).
        conn.execute(
            "UPDATE setting SET value = '\"powerful\"' WHERE key = ?1",
            [PROFILE_KEY],
        )
        .unwrap();
        assert_eq!(read_choice(&path), ProfileChoice::Powerful);
        conn.execute(
            "UPDATE setting SET value = '\"standard\"' WHERE key = ?1",
            [PROFILE_KEY],
        )
        .unwrap();
        assert_eq!(read_choice(&path), ProfileChoice::Standard);
        let auto_economy = MachineInfo {
            total_memory_bytes: Some(2 * 1024 * MIB),
            logical_cpus: 4,
            arch: "aarch64".into(),
            os: "linux".into(),
            raspberry_pi: true,
            recommended: Profile::Economy,
        };
        assert_eq!(
            resolve(read_choice(&path), &auto_economy),
            (
                Profile::Standard,
                limits_on(Profile::Standard, Some(2 * 1024 * MIB))
            )
        );
    }

    /// Review D, M2: a setting that exists but cannot be read gives
    /// Économe, never Auto (which could be Puissant).
    #[test]
    fn an_unreadable_setting_falls_back_to_economy() {
        let dir = tempfile::tempdir().unwrap();
        // A value of another type.
        let blob = dir.path().join("blob.db");
        let conn = rusqlite::Connection::open(&blob).unwrap();
        conn.execute_batch("CREATE TABLE setting (key TEXT PRIMARY KEY, value);")
            .unwrap();
        conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, X'00ff')",
            [PROFILE_KEY],
        )
        .unwrap();
        assert_eq!(read_choice(&blob), ProfileChoice::Economy);
        // NULL or a value that is not a profile: as if unset.
        conn.execute("UPDATE setting SET value = NULL", []).unwrap();
        assert_eq!(read_choice(&blob), ProfileChoice::Auto);
        conn.execute("UPDATE setting SET value = '\"turbo\"'", [])
            .unwrap();
        assert_eq!(read_choice(&blob), ProfileChoice::Auto);

        // A view named `setting` (a crafted database).
        let view = dir.path().join("view.db");
        rusqlite::Connection::open(&view)
            .unwrap()
            .execute_batch(
                "CREATE VIEW setting (key, value) AS \
                 SELECT 'analytics.performance.profile', '\"powerful\"';",
            )
            .unwrap();
        assert_eq!(read_choice(&view), ProfileChoice::Economy);

        // Locked by a writer (rollback journal): busy, then Économe.
        let locked = dir.path().join("locked.db");
        let writer = rusqlite::Connection::open(&locked).unwrap();
        writer
            .execute_batch(
                "CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL); \
                 INSERT INTO setting VALUES ('analytics.performance.profile', '\"powerful\"');",
            )
            .unwrap();
        writer.execute_batch("BEGIN EXCLUSIVE;").unwrap();
        assert_eq!(read_choice(&locked), ProfileChoice::Economy);
        writer.execute_batch("COMMIT;").unwrap();
        assert_eq!(read_choice(&locked), ProfileChoice::Powerful);
    }

    #[test]
    fn the_mcp_server_keeps_economy_memory() {
        let mcp = mcp_limits(POWERFUL);
        assert_eq!(mcp.mcp_query_timeout_ms, POWERFUL.mcp_query_timeout_ms);
        assert_eq!(mcp.mcp_report_timeout_ms, POWERFUL.mcp_report_timeout_ms);
        assert_eq!(mcp.max_timeout_ms, POWERFUL.max_timeout_ms);
        assert_eq!(mcp.heap_limit_bytes, ECONOMY.heap_limit_bytes);
        assert_eq!(mcp.memory_budget_bytes, ECONOMY.memory_budget_bytes);
        assert_eq!(mcp.result_bytes, ECONOMY.result_bytes);
        assert_eq!(mcp.concurrent_queries, 1);
        assert_eq!(mcp_limits(ECONOMY), ECONOMY);
    }

    #[test]
    fn mirrors_the_fixtures() {
        let fixtures = fixtures();
        // The table.
        for profile in Profile::ALL {
            let expected = &fixtures["limits"][profile.as_str()];
            assert_eq!(
                &serde_json::to_value(base_limits(profile)).unwrap(),
                expected
            );
            let parsed: PerformanceLimits = serde_json::from_value(expected.clone()).unwrap();
            assert_eq!(parsed, base_limits(profile));
        }
        // Machines round-trip.
        for example in fixtures["MachineInfo"].as_array().unwrap() {
            let parsed: MachineInfo = serde_json::from_value(example.clone()).unwrap();
            assert_eq!(&serde_json::to_value(&parsed).unwrap(), example);
            assert_eq!(
                parsed.recommended,
                detect::recommend(
                    parsed.total_memory_bytes,
                    parsed.logical_cpus,
                    &parsed.arch,
                    &parsed.os,
                    parsed.raspberry_pi
                ),
                "{example}"
            );
        }
        // Resolution and memory caps, as TypeScript computes them.
        let cases = fixtures["cases"].as_array().unwrap();
        assert!(cases.len() >= 6);
        for case in cases {
            let machine: MachineInfo = serde_json::from_value(case["machine"].clone()).unwrap();
            let choice: ProfileChoice = serde_json::from_value(case["choice"].clone()).unwrap();
            let (profile, limits) = resolve(choice, &machine);
            assert_eq!(json!(profile), case["profile"], "{case}");
            assert_eq!(
                serde_json::to_value(limits).unwrap(),
                case["limits"],
                "{case}"
            );
            assert_eq!(
                json!(could_go_higher(profile, &machine)),
                case["couldGoHigher"],
                "{case}"
            );
        }
    }

    #[test]
    fn refuses_unknown_fields() {
        let mut limits = serde_json::to_value(ECONOMY).unwrap();
        limits["extra"] = json!(1);
        assert!(serde_json::from_value::<PerformanceLimits>(limits).is_err());
    }
}
