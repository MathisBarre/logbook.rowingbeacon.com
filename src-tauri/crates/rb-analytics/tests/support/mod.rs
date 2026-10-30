//! Test database builder for the engine tests: the schema of the app's
//! migrations (the SQL between `/*sql*/ \`` and the last backtick of each
//! file, so the tests follow the real schema), PR #9's `boat_damage` DDL,
//! and a small deterministic club whose private values carry markers that
//! the leak tests search for in every result.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use rusqlite::{params, Connection};
use serde_json::{Map, Value};

use rb_analytics::ipc::{Privacy, RunQueryRequest};

macro_rules! migration {
    ($file:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../src/_common/database/migrations/",
            $file
        ))
    };
}

/// The migrations of `src/_common/database/migrations.ts`, in order.
const MIGRATIONS: [(&str, &str); 10] = [
    ("00_migration-table.ts", migration!("00_migration-table.ts")),
    (
        "01_create-session-table.ts",
        migration!("01_create-session-table.ts"),
    ),
    (
        "02_update-session-table.ts",
        migration!("02_update-session-table.ts"),
    ),
    (
        "03_session_rowers-table.ts",
        migration!("03_session_rowers-table.ts"),
    ),
    ("04_add-index.ts", migration!("04_add-index.ts")),
    (
        "05_add-has-been-coached-column.ts",
        migration!("05_add-has-been-coached-column.ts"),
    ),
    (
        "06_fix-has-been-coached.ts",
        migration!("06_fix-has-been-coached.ts"),
    ),
    ("07_v2-club-data.ts", migration!("07_v2-club-data.ts")),
    ("08_efa-records.ts", migration!("08_efa-records.ts")),
    ("11_analytics.ts", migration!("11_analytics.ts")),
];

/// PR #9 (damages module) DDL, as in `testing/analyticsTestDb.ts`.
pub const BOAT_DAMAGE_DDL: &str = "
CREATE TABLE IF NOT EXISTS boat_damage (
  id TEXT PRIMARY KEY,
  boat_id TEXT NOT NULL REFERENCES boat (id),
  kind TEXT NOT NULL DEFAULT 'damage' CHECK (kind IN ('damage', 'unavailable')),
  severity TEXT NOT NULL CHECK (severity IN ('usable', 'limited', 'unusable')),
  description TEXT NOT NULL DEFAULT '',
  reported_at TEXT NOT NULL,
  reported_by_rower_id TEXT REFERENCES rower (id),
  outing_id TEXT REFERENCES outing (id) ON DELETE SET NULL,
  incident_id TEXT REFERENCES incident (id) ON DELETE SET NULL,
  fixed_at TEXT,
  fixed_by_rower_id TEXT REFERENCES rower (id),
  repair_note TEXT,
  repair_cost REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boat_damage_boat_id ON boat_damage (boat_id);
CREATE INDEX IF NOT EXISTS idx_boat_damage_open ON boat_damage (boat_id) WHERE fixed_at IS NULL;
";

/// The SQL of a migration file: between "/*sql*/ `" and the last backtick.
pub fn migration_sql(file: &str, text: &str) -> String {
    let start = text
        .find("/*sql*/ `")
        .unwrap_or_else(|| panic!("{file}: no /*sql*/ template"))
        + "/*sql*/ `".len();
    let end = text
        .rfind('`')
        .unwrap_or_else(|| panic!("{file}: no closing backtick"));
    assert!(end > start, "{file}: empty template");
    text[start..end].to_string()
}

/// "now" of every test request: season 2025 (August 2025 - July 2026).
pub const NOW: &str = "2026-06-20T09:47";
pub const CURRENT_SEASON: i64 = 2025;
const STAMP: &str = "2025-01-01T00:00:00.000Z";

/// Values that must never appear in a result, per mode.
pub const CONTACT_MARKERS: [&str; 5] = [
    "@example.org",
    "+33 6",
    "rue-secrete",
    "LIC-SECRET",
    "ROWERNOTE-SECRET",
];
pub const FREE_TEXT_MARKERS: [&str; 6] = [
    "COMMENT-SECRET",
    "INCIDENT-SECRET",
    "DAMAGE-SECRET",
    "REPAIR-SECRET",
    "BOATNOTE-SECRET",
    "ROUTENOTE-SECRET",
];
/// Rows of denied tables.
pub const DENIED_MARKERS: [&str; 5] = [
    "HASH-SECRET",
    "EFA-SECRET",
    "LOG-SECRET",
    "AQ-SECRET",
    "SESSION-SECRET",
];

pub const FIRST_NAMES: [&str; 12] = [
    "Anouk", "Bastien", "Chloé", "Damien", "Elodie", "Fabrice", "Gaëlle", "Hugo", "Inès", "Jules",
    "Katell", "Loïc",
];
pub const LAST_NAMES: [&str; 12] = [
    "Abgrall",
    "Bernicot",
    "Cadiou",
    "Daniélou",
    "Euzen",
    "Floc'h",
    "Guivarc'h",
    "Hamon",
    "Inizan",
    "Jaouen",
    "Kerjean",
    "Le Bihan",
];

#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub damages: bool,
    pub seed: bool,
    pub wal: bool,
    pub season_start_month: Option<&'static str>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            damages: true,
            seed: true,
            wal: true,
            season_start_month: Some("8"),
        }
    }
}

/// Timing tests run alone: each test database holds the gate shared, a
/// timing test holds it exclusively (other tests of the binary wait).
static GATE: RwLock<()> = RwLock::new(());

enum Gate {
    Shared(#[allow(dead_code)] RwLockReadGuard<'static, ()>),
    Exclusive(#[allow(dead_code)] RwLockWriteGuard<'static, ()>),
}

pub struct TestDb {
    pub path: PathBuf,
    pub dir: tempfile::TempDir,
    _gate: Gate,
}

impl TestDb {
    pub fn new() -> TestDb {
        TestDb::with(Options::default())
    }

    /// A database for a test that measures time: no other test of the
    /// binary runs meanwhile.
    pub fn exclusive() -> TestDb {
        let gate = Gate::Exclusive(GATE.write().unwrap_or_else(|e| e.into_inner()));
        TestDb::build(Options::default(), gate)
    }

    pub fn with(options: Options) -> TestDb {
        let gate = Gate::Shared(GATE.read().unwrap_or_else(|e| e.into_inner()));
        TestDb::build(options, gate)
    }

    fn build(options: Options, gate: Gate) -> TestDb {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("main.db");
        let conn = Connection::open(&path).unwrap();
        if options.wal {
            let mode: String = conn
                .query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))
                .unwrap();
            assert_eq!(mode, "wal");
        }
        for (file, text) in MIGRATIONS {
            conn.execute_batch(&migration_sql(file, text))
                .unwrap_or_else(|e| panic!("{file}: {e}"));
        }
        if options.damages {
            conn.execute_batch(BOAT_DAMAGE_DDL).unwrap();
        }
        if options.seed {
            seed(&conn, options);
        }
        drop(conn);
        TestDb {
            path,
            dir,
            _gate: gate,
        }
    }

    pub fn writer(&self) -> Connection {
        let conn = Connection::open(&self.path).unwrap();
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        conn
    }

    /// Bytes of the database and of its WAL (empty when absent).
    pub fn files(&self) -> (Vec<u8>, Vec<u8>) {
        let wal = self.path.with_extension("db-wal");
        (
            std::fs::read(&self.path).unwrap(),
            std::fs::read(&wal).unwrap_or_default(),
        )
    }
}

pub fn request(sql: &str) -> RunQueryRequest {
    RunQueryRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        sql: sql.to_string(),
        params: Map::new(),
        max_rows: 5000,
        timeout_ms: 10_000,
        privacy: Privacy::Nominative,
        now: NOW.to_string(),
        use_cache: false,
    }
}

pub fn with_params(mut req: RunQueryRequest, params: &[(&str, Value)]) -> RunQueryRequest {
    for (name, value) in params {
        req.params.insert(name.to_string(), value.clone());
    }
    req
}

fn rower_id(i: usize) -> String {
    // Hex-looking ids, like the app's uuids, so rower_code is meaningful.
    format!("{:08x}-0000-4000-8000-{:012x}", 0xa1b2_c300 + i, i)
}

fn boat_id(i: usize) -> String {
    format!("boat-{i}")
}

/// (name, seats, rigging, coxed, exclude_from_stats, archived).
type BoatSeed = (
    &'static str,
    Option<i64>,
    Option<&'static str>,
    i64,
    i64,
    bool,
);

/// A small deterministic club: 7 boats, 12 rowers (one guest, one
/// anonymised, one merged), 3 routes, about 400 outings over three seasons
/// with crews, incidents, damages, and rows in every denied table.
fn seed(conn: &Connection, options: Options) {
    let tx = conn.unchecked_transaction().unwrap();
    if let Some(month) = options.season_start_month {
        tx.execute(
            "INSERT INTO setting (key, value) VALUES ('analytics.seasonStartMonth', ?1)",
            [month],
        )
        .unwrap();
    }
    tx.execute_batch(
        "INSERT INTO setting (key, value) VALUES ('adminPasswordHash', '\"HASH-SECRET\"');
         INSERT INTO session (id, boat_id, start_date_time, comment) VALUES ('s1', 'boat-0', '2024-01-01T10:00', 'SESSION-SECRET');
         INSERT INTO efa_record (object_type, object_name, record_key, fields) VALUES ('person', 'p', 'k', 'EFA-SECRET');
         INSERT INTO change_log (entity, entity_id, field, old_value, new_value, changed_at) VALUES ('rower', 'x', 'email', 'LOG-SECRET', 'LOG-SECRET', '2025-01-01');
         INSERT INTO analytics_query (id, title, sql, created_at, updated_at) VALUES ('q1', 'AQ-SECRET', 'SELECT 1', '2025-01-01', '2025-01-01');
         INSERT INTO analytics_dashboard_item (id, source_kind, report_id, created_at, updated_at) VALUES ('d1', 'report', 'AQ-SECRET', '2025-01-01', '2025-01-01');",
    )
    .unwrap();

    // Boats: (name, seats, rigging, coxed, exclude_from_stats, archived).
    let boats: [BoatSeed; 7] = [
        ("Skiff Odet", Some(1), Some("scull"), 0, 0, false),
        ("Double Aulne", Some(2), Some("scull"), 0, 0, false),
        ("Quatre Elorn", Some(4), Some("scull"), 1, 0, false),
        ("Huit Penfeld", Some(8), Some("sweep"), 1, 0, false),
        ("Quatre Laïta", Some(4), Some("sweep"), 0, 0, false),
        ("Vedette", None, None, 0, 1, false),
        ("Vieux Yole", Some(4), None, 1, 0, true),
    ];
    for (i, (name, seats, rigging, coxed, excluded, archived)) in boats.iter().enumerate() {
        tx.execute(
            "INSERT INTO boat (id, name, note, exclude_from_stats, archived_at, created_at, updated_at)
             VALUES (?1, ?2, 'BOATNOTE-SECRET', ?3, ?4, ?5, ?5)",
            params![boat_id(i), name, excluded, archived.then_some("2025-03-01T00:00"), STAMP],
        )
        .unwrap();
        if seats.is_some() {
            tx.execute(
                "INSERT INTO boat_configuration (id, boat_id, seats, rigging, coxed, is_default)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![
                    format!("{}-c", boat_id(i)),
                    boat_id(i),
                    seats,
                    rigging,
                    coxed
                ],
            )
            .unwrap();
        }
    }

    for i in 0..12 {
        let status = match i {
            10 => "guest",
            11 => "other",
            _ => "member",
        };
        let gender = ["female", "male"][i % 2];
        tx.execute(
            "INSERT INTO rower (id, first_name, last_name, status, age_category, gender, birth_date,
                                email, phone, license_number, address, note, anonymized_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'ROWERNOTE-SECRET', ?12, ?13, ?13)",
            params![
                rower_id(i),
                FIRST_NAMES[i],
                LAST_NAMES[i],
                status,
                ["senior", "junior", "master"][i % 3],
                gender,
                format!("{}-0{}-1{}", 1960 + i * 4, 1 + i % 9, i % 10),
                format!("{}@example.org", FIRST_NAMES[i].to_lowercase()),
                format!("+33 6 00 00 00 {i:02}"),
                format!("LIC-SECRET-{i}"),
                format!("{i} rue-secrete"),
                (i == 9).then_some("2025-05-01T00:00"),
                STAMP,
            ],
        )
        .unwrap();
    }
    // A duplicate merged into rower 0.
    tx.execute(
        "INSERT INTO rower (id, first_name, last_name, merged_into_id, email, created_at, updated_at)
         VALUES ('ffffffff-0000-4000-8000-000000000099', 'Anouk', 'Abgrall', ?1, 'dup@example.org', ?2, ?2)",
        params![rower_id(0), STAMP],
    )
    .unwrap();
    tx.execute_batch(
        "INSERT INTO rower_group (id, name, created_at, updated_at) VALUES ('g1', 'Loisir', '2025-01-01', '2025-01-01');",
    )
    .unwrap();
    tx.execute(
        "INSERT INTO rower_group_member (group_id, rower_id) VALUES ('g1', ?1)",
        [rower_id(1)],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO boat_level_config (boat_id, minimal_rower_category) VALUES ('boat-0', 'senior')",
        [],
    )
    .unwrap();

    for (i, (name, distance)) in [("Rade", 8000), ("Rivière", 12_000), ("Bassin", 4000)]
        .iter()
        .enumerate()
    {
        tx.execute(
            "INSERT INTO route (id, name, distance_m, note, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'ROUTENOTE-SECRET', ?4, ?4)",
            params![format!("route-{i}"), name, distance, STAMP],
        )
        .unwrap();
    }

    // Outings: every 2.5 days from September 2023 to June 2026.
    let types = [
        "normal",
        "training",
        "regatta",
        "instruction",
        "tour",
        "motorboat",
    ];
    let mut day = 0usize;
    let mut n = 0usize;
    let start = 19_600i64; // 2023-08-31 in days since 1970-01-01.
    while start + (day as i64) < 20_624 {
        let date: String = tx
            .query_row(
                "SELECT date(?1 * 86400, 'unixepoch')",
                [start + day as i64],
                |r| r.get(0),
            )
            .unwrap();
        for slot in 0..2 {
            let boat = (n * 7 + slot) % 6;
            let hour = [8, 10, 14, 18][(n + slot) % 4];
            let start_at = if n.is_multiple_of(37) {
                format!("{date}T00:00") // efa2 outing without a time
            } else {
                format!("{date}T{hour:02}:{:02}", (n * 13) % 60)
            };
            let end_at: Option<String> = if n % 97 == 5 {
                None // ongoing
            } else if n % 89 == 7 {
                Some(format!("{date}T23:59")) // long day
            } else {
                Some(format!("{date}T{:02}:{:02}", hour + 1, (n * 7) % 60))
            };
            let id = format!("outing-{n}");
            let route = (n % 4 < 3).then(|| format!("route-{}", n % 3));
            let distance: Option<i64> = n.is_multiple_of(5).then_some(5000 + (n as i64 % 7) * 1000);
            let kind = if boat == 5 { "motorboat" } else { types[n % 5] };
            tx.execute(
                "INSERT INTO outing (id, boat_id, boat_configuration_id, route_id, outing_type_code,
                                     start_date_time, end_date_time, estimated_end_date_time, distance_m,
                                     comment, has_been_coached, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![
                    id,
                    boat_id(boat),
                    (boat != 5).then(|| format!("{}-c", boat_id(boat))),
                    route,
                    kind,
                    start_at,
                    end_at,
                    distance,
                    format!("COMMENT-SECRET {n}"),
                    n.is_multiple_of(3) as i64,
                    STAMP,
                ],
            )
            .unwrap();
            let seats = [1, 2, 5, 9, 4, 1][boat];
            for k in 0..seats {
                let rower = (n + k * 5) % 12;
                tx.execute(
                    "INSERT OR IGNORE INTO outing_crew (outing_id, rower_id, role, position) VALUES (?1, ?2, ?3, ?4)",
                    params![id, rower_id(rower), if k == seats - 1 && seats > 4 { "cox" } else { "rower" }, k],
                )
                .unwrap();
            }
            if n.is_multiple_of(23) {
                tx.execute(
                    "INSERT INTO incident (id, outing_id, boat_id, message, occurred_at, created_at)
                     VALUES (?1, ?2, ?3, 'INCIDENT-SECRET', ?4, ?5)",
                    params![format!("incident-{n}"), id, boat_id(boat), start_at, STAMP],
                )
                .unwrap();
                if options.damages {
                    tx.execute(
                        "INSERT INTO boat_damage (id, boat_id, severity, description, reported_at,
                                                  reported_by_rower_id, outing_id, fixed_at, repair_note, repair_cost,
                                                  created_at, updated_at)
                         VALUES (?1, ?2, 'limited', 'DAMAGE-SECRET', ?3, ?4, ?5, ?6, 'REPAIR-SECRET', 120.5, ?7, ?7)",
                        params![
                            format!("damage-{n}"),
                            boat_id(boat),
                            start_at,
                            rower_id(n % 12),
                            id,
                            n.is_multiple_of(2).then(|| format!("{date}T20:00")),
                            STAMP
                        ],
                    )
                    .unwrap();
                }
            }
            n += 1;
        }
        day += if day.is_multiple_of(2) { 2 } else { 3 };
    }
    tx.commit().unwrap();
}

/// Every string of a result, for leak searches.
pub fn result_text(result: &rb_analytics::ipc::QueryResult) -> String {
    serde_json::to_string(&result.rows).unwrap()
}

pub fn path_str(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
