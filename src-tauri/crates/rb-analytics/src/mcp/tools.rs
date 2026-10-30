//! The five MCP tools (plan 2.12): `get_schema`, `list_reports`,
//! `run_report`, `run_query`, `propose_chart`.
//!
//! Every call reads the club settings afresh from `main.db` (read-only):
//! `analytics.mcp.enabled` (off → the tool answers the "turned off" error,
//! no restart needed), `analytics.mcp.privacy` (default pseudonymised),
//! `analytics.seasonStartMonth`, `modules.enabled`,
//! `analytics.performance.profile` (the timeouts and rows of the club's
//! performance profile, `perf`), and the local time from
//! SQLite (`strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')`). Queries go
//! through a `QueryRunner`: the real engine in the app binary, a test
//! double in the tests.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use rusqlite::Connection;
use serde_json::{json, Map, Value};

use super::chart_shape::{check_chart, check_params};
use super::inbox::{self, NewProposal};
use crate::assets::{self, CatalogEntry, ColumnClass, Dictionary, ObjectKind};
use crate::engine::{self, EngineContext, EngineState};
use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{EngineObjects, Privacy, QueryResult, RunQueryRequest};
use crate::perf::{self, PerformanceLimits, Profile, ProfileChoice};

/// The French and English answer when AI assistants' access is off (plan
/// 2.12). Any MCP client may read it, so it names none.
pub const DISABLED_MESSAGE: &str = "Rowing Beacon : l'accès des assistants IA aux statistiques est désactivé (Gestion › Statistiques et IA). / Rowing Beacon: AI assistants' access to statistics is turned off (Management › Statistics and AI).";

/// `propose_chart` success text (plan 2.12), French then English.
pub const PROPOSAL_SAVED_MESSAGE: &str = "Proposition enregistrée. Ouvrez Rowing Beacon › Statistiques › Explorer › Propositions pour l'accepter. / Proposal saved. Open Rowing Beacon › Statistics › Explorer › Proposals to accept it.";

/// Économe's rows and timeouts (`perf::ECONOMY`); each call uses those of
/// the club's profile (`perf::PerformanceLimits::mcp_*`).
pub const RUN_QUERY_MAX_ROWS: u32 = crate::perf::ECONOMY.mcp_max_rows;
pub const RUN_QUERY_TIMEOUT_MS: u64 = crate::perf::ECONOMY.mcp_query_timeout_ms;
/// Prebuilt reports are vetted; heavy ones can take 5-15 s on a
/// Raspberry Pi (plan 2.14), so they get the in-app report timeout.
pub const RUN_REPORT_TIMEOUT_MS: u64 = crate::perf::ECONOMY.mcp_report_timeout_ms;
pub const MAX_SQL_CHARS: usize = 100_000;
pub const MAX_TITLE_CHARS: usize = 120;
pub const MAX_DESCRIPTION_CHARS: usize = 1_000;

/// `MODULE_IDS` of `src/_common/business/modules.rules.ts`.
pub const MODULE_IDS: [&str; 5] = [
    "distances",
    "outingTypes",
    "memberProfile",
    "guests",
    "captain",
];

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const REPORTS_FR: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/i18n/fr-FR/reports.json"
));
const REPORTS_EN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/i18n/en-US/reports.json"
));

// ------------------------------------------------------------------ runner

/// How the tools run SQL. The real implementation is the read-only engine;
/// tests use a double so this module does not wait for the engine.
pub trait QueryRunner: Send + Sync {
    fn run(
        &self,
        ctx: &EngineContext,
        req: &RunQueryRequest,
    ) -> Result<QueryResult, AnalyticsError>;
    fn objects(&self, ctx: &EngineContext) -> Result<EngineObjects, AnalyticsError>;
    /// Stops a running query (`notifications/cancelled`).
    fn cancel(&self, request_id: &str);
    /// Stops every running query (stdin closed: the client is gone).
    fn cancel_all(&self) {}
}

/// `rb_analytics::engine`, with its own state (cache, cancel flags).
#[derive(Debug, Default)]
pub struct EngineRunner {
    state: EngineState,
}

impl EngineRunner {
    pub fn new() -> Self {
        Self::default()
    }
}

impl QueryRunner for EngineRunner {
    fn run(
        &self,
        ctx: &EngineContext,
        req: &RunQueryRequest,
    ) -> Result<QueryResult, AnalyticsError> {
        engine::run_query(&self.state, ctx, req)
    }

    fn objects(&self, ctx: &EngineContext) -> Result<EngineObjects, AnalyticsError> {
        engine::list_objects(ctx)
    }

    fn cancel(&self, request_id: &str) {
        engine::cancel(&self.state, request_id);
    }

    fn cancel_all(&self) {
        engine::cancel_all(&self.state);
    }
}

// ---------------------------------------------------------------- settings

/// Where the tools read and write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolEnv {
    pub db_path: PathBuf,
    pub inbox_dir: PathBuf,
    /// Tests: a fixed local time instead of SQLite's clock.
    pub now_override: Option<String>,
}

/// The settings a call depends on, read at each call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClubSettings {
    pub mcp_enabled: bool,
    pub privacy: Privacy,
    pub season_start_month: u32,
    pub enabled_modules: Vec<String>,
    /// Local wall-clock time "YYYY-MM-DDTHH:mm".
    pub now: String,
    /// `analytics.performance.profile`.
    pub performance: ProfileChoice,
}

impl ClubSettings {
    /// The club's profile on this machine, and the server's limits: the
    /// profile's times and rows, Économe's memory (`perf::mcp_limits`).
    pub fn performance(&self) -> (Profile, PerformanceLimits) {
        let (profile, limits) = perf::resolve(self.performance, perf::machine());
        (profile, perf::mcp_limits(limits))
    }

    pub fn today(&self) -> &str {
        &self.now[..10]
    }

    /// Season containing today, as its start year.
    pub fn current_season(&self) -> i64 {
        let year: i64 = self.now[..4].parse().unwrap_or(1970);
        let month: u32 = self.now[5..7].parse().unwrap_or(1);
        if month < self.season_start_month {
            year - 1
        } else {
            year
        }
    }
}

fn is_local_date_time(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 16
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 => *c == b':',
            _ => c.is_ascii_digit(),
        })
}

/// The engine's read-only open (`engine::open::open_read_only`): the
/// read-write fallback only on `SQLITE_CANTOPEN`, also when it shows at
/// the first read (WAL files opened lazily), never with CREATE, and with
/// `SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE`, so closing never writes main.db.
/// `query_only` on top, for the fallback path.
fn open_read_only(db_path: &Path) -> Result<Connection, String> {
    if !db_path.is_file() {
        return Err(format!(
            "No Rowing Beacon database at {}. Open the Rowing Beacon app once on this computer, \
             or start the server with --db <path to main.db>.",
            db_path.display()
        ));
    }
    let (connection, _fallback) = crate::engine::open::open_read_only(db_path)
        .map_err(|e| format!("Cannot open {}: {}", db_path.display(), e.message))?;
    connection
        .execute_batch("PRAGMA query_only = ON;")
        .map_err(|e| format!("Cannot open {}: {e}", db_path.display()))?;
    Ok(connection)
}

/// Reads the settings of the club (never writes; a missing `setting`
/// table means defaults, so access stays off).
pub fn read_settings(db_path: &Path, now_override: Option<&str>) -> Result<ClubSettings, String> {
    let connection = open_read_only(db_path)?;
    let mut settings = ClubSettings {
        mcp_enabled: false,
        privacy: Privacy::Pseudonymised,
        season_start_month: 8,
        enabled_modules: Vec::new(),
        now: String::new(),
        performance: ProfileChoice::Auto,
    };
    let has_settings: bool = connection
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'setting')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Cannot read the database: {e}"))?;
    if has_settings {
        let mut statement = connection
            .prepare(
                "SELECT key, value FROM setting WHERE key IN ('analytics.mcp.enabled', \
                 'analytics.mcp.privacy', 'analytics.seasonStartMonth', 'modules.enabled', \
                 'analytics.performance.profile')",
            )
            .map_err(|e| format!("Cannot read the settings: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| format!("Cannot read the settings: {e}"))?;
        // A row that exists but cannot be read never widens the limits:
        // Économe then, not Auto (review D, M2).
        let mut unreadable = false;
        for row in rows {
            let Ok(row) = row else {
                unreadable = true;
                continue;
            };
            let value: Value = row
                .1
                .as_deref()
                .and_then(|text| serde_json::from_str(text).ok())
                .unwrap_or(Value::Null);
            match row.0.as_str() {
                "analytics.mcp.enabled" => settings.mcp_enabled = value == Value::Bool(true),
                "analytics.mcp.privacy" => {
                    if value.as_str() == Some("nominative") {
                        settings.privacy = Privacy::Nominative;
                    }
                }
                "analytics.seasonStartMonth" => {
                    if let Some(month) = value.as_f64().filter(|m| m.fract() == 0.0) {
                        settings.season_start_month = month.clamp(1.0, 12.0) as u32;
                    }
                }
                perf::PROFILE_KEY => settings.performance = ProfileChoice::from_setting(&value),
                "modules.enabled" => {
                    if let Some(list) = value.as_array() {
                        settings.enabled_modules = MODULE_IDS
                            .iter()
                            .filter(|id| list.iter().any(|v| v.as_str() == Some(id)))
                            .map(|id| id.to_string())
                            .collect();
                    }
                }
                _ => {}
            }
        }
        if unreadable {
            settings.performance = ProfileChoice::Economy;
        }
    }
    settings.now = match now_override {
        Some(now) => now.to_string(),
        None => connection
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Cannot read the clock: {e}"))?,
    };
    if !is_local_date_time(&settings.now) {
        return Err(format!("Invalid local time {:?}", settings.now));
    }
    Ok(settings)
}

// ------------------------------------------------------------- definitions

const PARAM_DEF_SCHEMA_TEXT: &str = "Parameter definitions, one per :name used in the SQL: { name (^[a-z][a-z0-9_]{0,31}$), type (season | date | boat | rower | route | outing_type | boat_class | integer | choice | boolean | text), label? (≤ 60 characters, in the user's language), required? (boolean), default? (text, number, boolean or null; a season parameter takes \"current\"), options? ([{ value, label? }] for choice), min?, max? (integer) }.";

const CHART_SPEC_TEXT: &str = "Chart specification (same format as the app). One of: { type: \"table\", columns?: [col] } | { type: \"kpi\", items: [{ value: col, compare?: col, format?, higherIsBetter?: bool, label? }] (1-6) } | { type: \"bar\", x: col, y: [col] (1-8), series?: col (then exactly one y), orientation?: \"vertical\" | \"horizontal\", stacked?: bool, sort?: \"none\" | \"asc\" | \"desc\", limit?: 1-100 } | { type: \"line\" | \"area\", x: col (month, week_start, date), y: [col] (1-8), series?: col, cumulative?: bool } | { type: \"pie\", label: col, value: col } (6 parts or fewer) | { type: \"heatmap\", x: col, y: col, value: col } | { type: \"calendar\", date: col ('YYYY-MM-DD'), value: col }. Every chart also accepts title? (≤ 120), note? (≤ 300), labels? ({ col: human label ≤ 60 }), formats? ({ col: auto | integer | decimal | percent | km | hours | minutes | date | datetime | month | week | weekday | hour | season | code | text }). col = a column name returned by the SQL. Never mix two units on one chart.";

/// The `tools/list` definitions (deterministic order).
pub fn tool_definitions() -> Value {
    let read_only = json!({
        "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false
    });
    let param_values = json!({
        "type": "object",
        "description": "Values of the :name parameters of the SQL (name without the colon). Text, number, boolean or null; a season is its start year, or \"current\".",
        "additionalProperties": { "type": ["string", "number", "boolean", "null"] }
    });
    json!([
        {
            "name": "get_schema",
            "title": "Schema of the club statistics",
            "description": "Describes the club's data in Rowing Beacon: the views and tables you may query, their columns (type, meaning, code values), the privacy mode, the season start month, today's date, the enabled modules and the SQL rules. Call it first, before writing any SQL.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": read_only,
        },
        {
            "name": "list_reports",
            "title": "Prebuilt reports",
            "description": "Lists the prebuilt statistics reports available for this club (id, category, French and English title, description with the result columns, parameters). Prefer a report over custom SQL when one answers the question.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": read_only,
        },
        {
            "name": "run_report",
            "title": "Run a prebuilt report",
            "description": "Runs one prebuilt report by id and returns its columns and rows (at most 500). Parameters not given take their default; a season parameter defaults to the current season.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Report id from list_reports, e.g. \"season-overview\"." },
                    "params": param_values,
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "annotations": read_only,
        },
        {
            "name": "run_query",
            "title": "Run a read-only SQL query",
            "description": "Runs one SQLite SELECT (WITH allowed) on a read-only copy of the club's data and returns columns and rows (at most 500 rows; 10 seconds on a small computer, up to 30 on a powerful one). Only the objects of get_schema exist; writes, PRAGMA and ATTACH are rejected. Use :name parameters and pass their values in params.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sql": { "type": "string", "description": "One SQLite SELECT statement." },
                    "params": param_values,
                },
                "required": ["sql"],
                "additionalProperties": false
            },
            "annotations": read_only,
        },
        {
            "name": "propose_chart",
            "title": "Propose a chart to the club",
            "description": "Sends a statistic (SQL, parameters and chart) to the Rowing Beacon app, where a club manager can preview it and accept it into the saved queries (Statistiques › Explorer › Propositions). The SQL is checked first. Nothing changes in the club's data.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short title in the user's language (≤ 120 characters)." },
                    "description": { "type": "string", "description": "What is counted and how to read the chart, for a non-technical club volunteer (≤ 1000 characters)." },
                    "sql": { "type": "string", "description": "One SQLite SELECT statement, tested with run_query first." },
                    "params": { "type": "array", "description": PARAM_DEF_SCHEMA_TEXT, "items": { "type": "object" } },
                    "chart": { "type": "object", "description": CHART_SPEC_TEXT }
                },
                "required": ["title", "description", "sql", "chart"],
                "additionalProperties": false
            },
            "annotations": {
                "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false
            },
        }
    ])
}

/// SQL rules shared with the in-app assistant (appendix E.1), for MCP.
fn sql_rules(settings: &ClubSettings) -> Vec<String> {
    let month = settings.season_start_month;
    let month_name = MONTHS[(month as usize).clamp(1, 12) - 1];
    let mut rules = vec![
        "Read-only: exactly one SELECT statement (WITH allowed). PRAGMA, ATTACH, writes, sqlite_master and any object not listed in the schema are rejected.".to_string(),
        "Use only the objects and columns of the schema. Prefer the v_ views: they already apply the club's conventions.".to_string(),
        "Dates are local text without time zone: 'YYYY-MM-DDTHH:MM' for start_at, end_at and other *_at columns, 'YYYY-MM-DD' for dates. Compare them as text, group with substr(), date() or strftime(). Never use 'now', CURRENT_DATE or CURRENT_TIMESTAMP: read today and now from v_settings.".to_string(),
        format!("Seasons: a season is named by its start year (column season). Season N runs from the first day of month {month} ({month_name}) of year N to the day before that date in year N+1. v_settings.current_season is the season containing today. \"This season\" means current_season; \"this year\" means the calendar year; \"last season\" means current_season - 1."),
        "Statistics exclude what the club excluded: add counts_in_stats = 1. Rowing activity excludes motorboat outings: add is_rowing = 1, unless the question is about motorboats or all outings.".to_string(),
        "An outing is one row of v_outings. A participation is one row of v_outing_rowers (one seat in a crew, cox included; filter role = 'rower' to leave coxes out). An active rower has at least one participation in the period.".to_string(),
        "Hours on the water: SUM(duration_min) / 60.0 over outings with is_multi_day = 0 and duration_min > 0 (multi-day outings would count nights).".to_string(),
        "Distance: distance_km is NULL when unknown (the club may not record distances). SUM ignores NULL; never turn NULL into 0 inside an average.".to_string(),
        "Hours of the day: outings imported without a time have has_start_time = 0; leave them out of any breakdown by hour.".to_string(),
        "Weekdays are ISO numbers: 1 = Monday ... 7 = Sunday. The weekend is start_weekday IN (6, 7).".to_string(),
        "Boats, routes, outing types: filter with parameters :boat_id, :route_id, :outing_type (compared with outing_type_code), or with names returned by an earlier query.".to_string(),
        "When the question is about one season, use a parameter :season and filter season = :season; pass \"current\" for the current season.".to_string(),
        "Optional filters: (:name IS NULL OR column = :name).".to_string(),
        "Keep results small: aggregate, ORDER BY, and LIMIT rankings (20 unless the user says otherwise). At most 500 rows are returned.".to_string(),
        "Result column names: snake_case English. Reuse these names when they fit, so the app formats and translates them: outings, participations, active_rowers, rowers, km, hours, month, season, week_start, weekday, hour, date, boat_name, boat_class, route_name, rower_label, outing_type_code, gender, age_category, rower_status, value. A column ending _pct holds a percentage from 0 to 100; _km kilometres; _min minutes; _date a date.".to_string(),
        "Timelines over a season: GROUP BY start_month_key (values 'YYYY-MM') and name it month. Month-of-year comparisons across seasons: start_month (1-12).".to_string(),
    ];
    rules.push(match settings.privacy {
        Privacy::Pseudonymised => "People: names, birth dates and free-text comments read as NULL (pseudonymised mode). Label people with COALESCE(NULLIF(display_name, ''), rower_code) AS rower_label; never guess a name.".to_string(),
        Privacy::Nominative => "People: label them with COALESCE(NULLIF(display_name, ''), rower_code) AS rower_label. Contact details (e-mail, phone, address, licence number, notes) always read as NULL.".to_string(),
    });
    rules
}

fn privacy_note(privacy: Privacy) -> &'static str {
    match privacy {
        Privacy::Pseudonymised => "pseudonymised: first and last names, birth dates and free-text comments read as NULL; people appear as rower_code (R-XXXXXXXX). Contact details are never readable.",
        Privacy::Nominative => "nominative: rowers' names are readable (the club chose it). Contact details (e-mail, phone, address, licence number, notes) are never readable.",
    }
}

fn privacy_str(privacy: Privacy) -> &'static str {
    match privacy {
        Privacy::Pseudonymised => "pseudonymised",
        Privacy::Nominative => "nominative",
    }
}

/// The server instructions (initialize / server/discover).
pub fn instructions(privacy: Option<Privacy>) -> String {
    let privacy = match privacy {
        Some(privacy) => format!("Personal data mode: {}", privacy_note(privacy)),
        None => "Personal data is pseudonymised by default: names read as NULL and people appear as rower_code.".to_string(),
    };
    format!(
        "Rowing Beacon is the logbook of a rowing club. This server reads the club's database on \
         this computer, read-only: outings, crews, boats, routes, incidents and damages. {privacy} \
         Call get_schema first. Use list_reports and run_report for the prebuilt statistics, \
         run_query for custom SQLite SELECT queries, and propose_chart to send a chart to the app, \
         where a club manager accepts it. The club manager can turn this access off in Rowing \
         Beacon (Gestion › Statistiques et IA). Answer in the user's language, in plain words for \
         club volunteers."
    )
}

// ------------------------------------------------------------------- calls

/// The result of one tool call.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutcome {
    pub text: String,
    pub structured: Option<Value>,
    pub is_error: bool,
}

impl ToolOutcome {
    fn ok(text: String, structured: Value) -> Self {
        ToolOutcome {
            text,
            structured: Some(structured),
            is_error: false,
        }
    }

    fn json(structured: Value) -> Self {
        let text = serde_json::to_string(&structured).unwrap_or_default();
        Self::ok(text, structured)
    }

    pub fn error(text: impl Into<String>) -> Self {
        ToolOutcome {
            text: text.into(),
            structured: None,
            is_error: true,
        }
    }

    /// The MCP `CallToolResult` (without the modern `resultType`).
    pub fn to_result(&self) -> Value {
        let mut result = json!({
            "content": [{ "type": "text", "text": self.text }],
            "isError": self.is_error,
        });
        if let Some(structured) = &self.structured {
            result["structuredContent"] = structured.clone();
        }
        result
    }
}

/// Who is calling, and the engine request id (for cancellation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallContext {
    pub client: Option<String>,
    pub request_id: String,
}

fn engine_error_text(error: &AnalyticsError) -> String {
    let mut text = format!("The query failed: {}: {}", error.code, error.message);
    if let Some(object) = &error.object {
        text.push_str(&format!(" (object: {object})"));
    }
    if let Some(offset) = error.offset {
        text.push_str(&format!(" (at character {offset})"));
    }
    if error.code == ErrorCode::Timeout {
        text.push_str(" Aggregate more, filter one season, or simplify the query.");
    }
    text
}

/// `engine_error_text`, plus where the club can raise the limit when the
/// machine allows a heavier profile than the one in use. Timeouts only:
/// the server's memory and result size are Économe's on every profile.
fn engine_error_text_for(error: &AnalyticsError, settings: &ClubSettings) -> String {
    let mut text = engine_error_text(error);
    let (profile, _) = settings.performance();
    if error.code == ErrorCode::Timeout && perf::could_go_higher(profile, perf::machine()) {
        text.push_str(&raise_limit_hint(perf::machine().recommended));
    }
    text
}

/// The sentence of `engine_error_text_for`, French then English.
fn raise_limit_hint(recommended: Profile) -> String {
    let (fr, en) = match recommended {
        Profile::Powerful => ("Puissant", "Powerful"),
        Profile::Standard => ("Standard", "Standard"),
        Profile::Economy => ("Économe", "Economy"),
    };
    format!(
        " This computer can allow longer and bigger queries: the club can choose the \
         {en} profile in Rowing Beacon › Management › Statistics and AI › Performance. / \
         Cet ordinateur permet des requêtes plus longues : le club peut choisir le profil \
         {fr} dans Gestion › Statistiques et IA › Performances."
    )
}

fn reports_json(source: &str) -> &'static Value {
    static FR: OnceLock<Value> = OnceLock::new();
    static EN: OnceLock<Value> = OnceLock::new();
    let cell = if std::ptr::eq(source, REPORTS_FR) {
        &FR
    } else {
        &EN
    };
    cell.get_or_init(|| serde_json::from_str(source).unwrap_or(Value::Null))
}

fn report_title(id: &str, source: &str) -> Option<String> {
    reports_json(source)
        .get("items")?
        .get(id)?
        .get("title")?
        .as_str()
        .map(str::to_string)
}

fn dictionary() -> &'static Dictionary {
    static DICTIONARY: OnceLock<Dictionary> = OnceLock::new();
    DICTIONARY.get_or_init(Dictionary::load)
}

/// Why a report cannot run here, or None.
fn unavailable_reason(
    entry: &CatalogEntry,
    settings: &ClubSettings,
    objects: &EngineObjects,
) -> Option<String> {
    for module in entry.requires.modules.iter().flatten() {
        if !settings.enabled_modules.contains(module) {
            return Some(format!("module {module} is not enabled in Rowing Beacon"));
        }
    }
    for table in &entry.requires.tables {
        if !objects.tables.contains(table) {
            return Some(format!("table {table} does not exist in this database"));
        }
    }
    None
}

/// Resolves one parameter value (plan 2.7 binding rules; Rust port of
/// `resolveParams.ts`, but errors are returned to Claude instead of
/// falling back silently).
fn coerce(
    def: &Map<String, Value>,
    value: &Value,
    settings: &ClubSettings,
) -> Result<Value, String> {
    let kind = def.get("type").and_then(Value::as_str).unwrap_or("text");
    let number_of = |value: &Value| -> Option<f64> {
        match value {
            Value::Number(n) => n.as_f64(),
            Value::String(s) if !s.trim().is_empty() => s.trim().parse().ok(),
            _ => None,
        }
    };
    match kind {
        "season" => {
            if value.as_str() == Some("current") {
                return Ok(json!(settings.current_season()));
            }
            match number_of(value) {
                Some(n) if n.fract() == 0.0 && (1900.0..=2200.0).contains(&n) => {
                    Ok(json!(n as i64))
                }
                _ => Err("a season is its start year (e.g. 2025) or \"current\"".into()),
            }
        }
        "integer" => {
            let n = number_of(value)
                .filter(|n| n.fract() == 0.0)
                .ok_or("an integer is expected")?;
            let min = def.get("min").and_then(Value::as_f64);
            let max = def.get("max").and_then(Value::as_f64);
            if min.is_some_and(|min| n < min) || max.is_some_and(|max| n > max) {
                return Err(format!(
                    "must be between {} and {}",
                    min.map_or("-∞".into(), |m| m.to_string()),
                    max.map_or("+∞".into(), |m| m.to_string())
                ));
            }
            Ok(json!(n as i64))
        }
        "boolean" => match value {
            Value::Bool(true) => Ok(json!(1)),
            Value::Bool(false) => Ok(json!(0)),
            Value::Number(n) if n.as_f64() == Some(1.0) => Ok(json!(1)),
            Value::Number(n) if n.as_f64() == Some(0.0) => Ok(json!(0)),
            Value::String(s) if s == "1" || s == "true" => Ok(json!(1)),
            Value::String(s) if s == "0" || s == "false" => Ok(json!(0)),
            _ => Err("true or false is expected".into()),
        },
        "date" => match value.as_str() {
            Some(s)
                if s.len() == 10
                    && s.bytes().enumerate().all(|(i, c)| {
                        if i == 4 || i == 7 {
                            c == b'-'
                        } else {
                            c.is_ascii_digit()
                        }
                    }) =>
            {
                Ok(json!(s))
            }
            _ => Err("a date 'YYYY-MM-DD' is expected".into()),
        },
        "choice" => {
            let text = match value {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => return Err("a text is expected".into()),
            };
            match def.get("options").and_then(Value::as_array) {
                Some(options)
                    if !options
                        .iter()
                        .any(|o| o.get("value").and_then(Value::as_str) == Some(&text)) =>
                {
                    let allowed: Vec<&str> = options
                        .iter()
                        .filter_map(|o| o.get("value").and_then(Value::as_str))
                        .collect();
                    Err(format!("one of {} is expected", allowed.join(", ")))
                }
                _ => Ok(json!(text)),
            }
        }
        _ => match value {
            Value::String(s) => Ok(json!(s)),
            Value::Number(n) => Ok(json!(n.to_string())),
            _ => Err("a text is expected".into()),
        },
    }
}

fn is_empty(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null)) || value.and_then(Value::as_str) == Some("")
}

/// Values for a report or a proposal from its definitions. `strict`:
/// unknown names, invalid values and missing required values are errors.
fn resolve_params(
    defs: &Value,
    given: &Map<String, Value>,
    settings: &ClubSettings,
    strict: bool,
) -> Result<Map<String, Value>, String> {
    let defs: Vec<&Map<String, Value>> = defs
        .as_array()
        .map(|list| list.iter().filter_map(Value::as_object).collect())
        .unwrap_or_default();
    if strict {
        for name in given.keys() {
            if !defs
                .iter()
                .any(|d| d.get("name").and_then(Value::as_str) == Some(name))
            {
                let known: Vec<&str> = defs
                    .iter()
                    .filter_map(|d| d.get("name").and_then(Value::as_str))
                    .collect();
                return Err(format!(
                    "Unknown parameter {name}. This report takes: {}",
                    if known.is_empty() {
                        "no parameter".to_string()
                    } else {
                        known.join(", ")
                    }
                ));
            }
        }
    }
    let mut values = Map::new();
    for def in defs {
        let Some(name) = def.get("name").and_then(Value::as_str) else {
            continue;
        };
        let resolved = match given.get(name) {
            Some(value) if !is_empty(Some(value)) => match coerce(def, value, settings) {
                Ok(value) => value,
                Err(error) if strict => return Err(format!("Parameter {name}: {error}")),
                Err(_) => Value::Null,
            },
            Some(_) => Value::Null,
            None if is_empty(def.get("default")) => Value::Null,
            None => coerce(def, &def["default"], settings).unwrap_or(Value::Null),
        };
        if strict && resolved.is_null() && def.get("required") == Some(&Value::Bool(true)) {
            return Err(format!("Parameter {name} is required"));
        }
        values.insert(name.to_string(), resolved);
    }
    Ok(values)
}

fn result_payload(result: &QueryResult) -> Map<String, Value> {
    let mut payload = Map::new();
    payload.insert(
        "columns".into(),
        json!(result
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()),
    );
    payload.insert("rows".into(), json!(result.rows));
    payload.insert("row_count".into(), json!(result.rows.len()));
    payload.insert("truncated".into(), json!(result.truncated));
    if !result.ignored_columns.is_empty() {
        payload.insert("null_columns".into(), json!(result.ignored_columns));
    }
    let mut notes = Vec::new();
    if result.truncated {
        notes.push(format!(
            "Only the first {} rows are returned: aggregate or add LIMIT.",
            result.rows.len()
        ));
    }
    if !result.ignored_columns.is_empty() {
        notes.push(format!(
            "These columns read as NULL because of the privacy settings: {}.",
            result.ignored_columns.join(", ")
        ));
    }
    if !notes.is_empty() {
        payload.insert("note".into(), json!(notes.join(" ")));
    }
    payload
}

fn text_arg<'a>(args: &'a Map<String, Value>, name: &str) -> Result<Option<&'a str>, String> {
    match args.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => Err(format!("{name} must be a text")),
    }
}

fn check_known_args(args: &Map<String, Value>, allowed: &[&str]) -> Result<(), String> {
    match args.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(format!(
            "Unknown argument {key}. Allowed: {}",
            if allowed.is_empty() {
                "none".to_string()
            } else {
                allowed.join(", ")
            }
        )),
        None => Ok(()),
    }
}

/// `params` of run_query / run_report: an object of primitive values.
fn param_values_arg(args: &Map<String, Value>) -> Result<Map<String, Value>, String> {
    match args.get("params") {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(map)) => {
            for (name, value) in map {
                if matches!(value, Value::Array(_) | Value::Object(_)) {
                    return Err(format!(
                        "params.{name} must be a text, a number, true/false or null"
                    ));
                }
            }
            Ok(map.clone())
        }
        Some(_) => Err("params must be an object of parameter values".into()),
    }
}

/// The tools with their environment and query runner.
pub struct Tools {
    pub env: ToolEnv,
    pub runner: Arc<dyn QueryRunner>,
}

impl Tools {
    pub fn new(env: ToolEnv, runner: Arc<dyn QueryRunner>) -> Self {
        Tools { env, runner }
    }

    /// The privacy mode for the instructions (None if unreadable).
    pub fn privacy_hint(&self) -> Option<Privacy> {
        read_settings(&self.env.db_path, self.env.now_override.as_deref())
            .ok()
            .map(|s| s.privacy)
    }

    /// Records a `tools/call` from `client` in `mcp-last-call.json` (local
    /// time of SQLite's clock, or the tests' fixed time). Never fails.
    pub fn record_call(&self, client: Option<&str>) {
        let at = match &self.env.now_override {
            Some(now) => Some(now.clone()),
            None => rusqlite::Connection::open_in_memory().ok().and_then(|c| {
                c.query_row(
                    "SELECT strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
            }),
        };
        if let Some(at) = at {
            super::last_call::record(&self.env.inbox_dir, client, &at);
        }
    }

    pub fn is_tool(name: &str) -> bool {
        matches!(
            name,
            "get_schema" | "list_reports" | "run_report" | "run_query" | "propose_chart"
        )
    }

    fn context(&self, settings: &ClubSettings) -> EngineContext {
        EngineContext {
            db_path: self.env.db_path.clone(),
            privacy: settings.privacy,
            limits: settings.performance().1,
        }
    }

    fn request(
        &self,
        call: &CallContext,
        settings: &ClubSettings,
        sql: &str,
        params: Map<String, Value>,
        max_rows: u32,
        timeout_ms: u64,
    ) -> RunQueryRequest {
        RunQueryRequest {
            request_id: call.request_id.clone(),
            sql: sql.to_string(),
            params,
            max_rows,
            timeout_ms,
            privacy: settings.privacy,
            now: settings.now.clone(),
            use_cache: true,
        }
    }

    /// Runs a tool. `None`: no tool of that name (a protocol error).
    pub fn call(
        &self,
        name: &str,
        args: &Map<String, Value>,
        call: &CallContext,
    ) -> Option<ToolOutcome> {
        if !Self::is_tool(name) {
            return None;
        }
        let settings = match read_settings(&self.env.db_path, self.env.now_override.as_deref()) {
            Ok(settings) => settings,
            Err(error) => return Some(ToolOutcome::error(error)),
        };
        if !settings.mcp_enabled {
            return Some(ToolOutcome::error(DISABLED_MESSAGE));
        }
        let outcome = match name {
            "get_schema" => self.get_schema(args, &settings),
            "list_reports" => self.list_reports(args, &settings),
            "run_report" => self.run_report(args, &settings, call),
            "run_query" => self.run_query(args, &settings, call),
            _ => self.propose_chart(args, &settings, call),
        };
        Some(outcome.unwrap_or_else(ToolOutcome::error))
    }

    fn objects(&self, settings: &ClubSettings) -> Result<EngineObjects, String> {
        self.runner.objects(&self.context(settings)).map_err(|e| {
            format!(
                "Cannot list the database objects: {}: {}",
                e.code, e.message
            )
        })
    }

    fn get_schema(
        &self,
        args: &Map<String, Value>,
        settings: &ClubSettings,
    ) -> Result<ToolOutcome, String> {
        check_known_args(args, &[])?;
        let objects = self.objects(settings)?;
        let pseudonymised = settings.privacy == Privacy::Pseudonymised;
        let dictionary = dictionary();
        let present = |name: &str, kind: ObjectKind| match kind {
            ObjectKind::View => objects.views.iter().any(|v| v == name),
            ObjectKind::Table => objects.tables.iter().any(|t| t == name),
        };
        let mut text = String::new();
        let mut listed = Vec::new();
        for kind in [ObjectKind::View, ObjectKind::Table] {
            for object in dictionary.objects.iter().filter(|o| o.kind == kind) {
                if !present(&object.name, kind) {
                    continue;
                }
                let kind_name = if kind == ObjectKind::View {
                    "view"
                } else {
                    "table"
                };
                text.push_str(&format!(
                    "\n## {} ({kind_name})\n{}\n",
                    object.name, object.description
                ));
                let mut columns = Vec::new();
                for column in &object.columns {
                    if column.class == ColumnClass::Contact {
                        continue;
                    }
                    let hidden = pseudonymised
                        && matches!(column.class, ColumnClass::Personal | ColumnClass::FreeText);
                    text.push_str(&format!(
                        "- {} {} [{}]: {}",
                        column.name, column.column_type, column.semantic, column.description
                    ));
                    if let Some(codes) = &column.codes {
                        text.push_str(&format!(" Values: {}.", codes.join(", ")));
                    }
                    if hidden {
                        text.push_str(" Always NULL in this privacy mode.");
                    }
                    text.push('\n');
                    let mut entry = json!({
                        "name": column.name,
                        "type": column.column_type,
                        "semantic": column.semantic,
                        "description": column.description,
                    });
                    if let Some(codes) = &column.codes {
                        entry["codes"] = json!(codes);
                    }
                    if hidden {
                        entry["always_null"] = json!(true);
                    }
                    columns.push(entry);
                }
                listed.push(json!({
                    "name": object.name,
                    "kind": kind_name,
                    "description": object.description,
                    "columns": columns,
                }));
            }
        }
        let rules = sql_rules(settings);
        let modules = if settings.enabled_modules.is_empty() {
            "none".to_string()
        } else {
            settings.enabled_modules.join(", ")
        };
        let header = format!(
            "Rowing Beacon club statistics (read-only).\nPrivacy mode: {}\nToday: {} (local time {}). Current season: {}. Season start month: {}.\nEnabled modules: {modules}. When a module is off, its data is empty: distances (km), outingTypes (outing types other than normal), guests (guest rowers). v_damages is filled even when the damages module is off: boats put out of service are rows of damage_kind 'unavailable'.\n\n# SQL rules\n{}\n\n# Schema{}",
            privacy_note(settings.privacy),
            settings.today(),
            settings.now,
            settings.current_season(),
            settings.season_start_month,
            rules.iter().map(|r| format!("- {r}")).collect::<Vec<_>>().join("\n"),
            if objects.missing_views.is_empty() {
                String::new()
            } else {
                format!(
                    "\nNot available in this database: {}.",
                    objects.missing_views.join(", ")
                )
            }
        );
        let structured = json!({
            "privacy": privacy_str(settings.privacy),
            "today": settings.today(),
            "now": settings.now,
            "current_season": settings.current_season(),
            "season_start_month": settings.season_start_month,
            "enabled_modules": settings.enabled_modules,
            "sql_rules": rules,
            "objects": listed,
            "missing_views": objects.missing_views,
        });
        Ok(ToolOutcome::ok(format!("{header}\n{text}"), structured))
    }

    fn list_reports(
        &self,
        args: &Map<String, Value>,
        settings: &ClubSettings,
    ) -> Result<ToolOutcome, String> {
        check_known_args(args, &[])?;
        let objects = self.objects(settings)?;
        let mut reports = Vec::new();
        let mut unavailable = Vec::new();
        for entry in assets::catalog() {
            if let Some(reason) = unavailable_reason(&entry, settings, &objects) {
                unavailable.push(json!({ "id": entry.id, "reason": reason }));
                continue;
            }
            reports.push(json!({
                "id": entry.id,
                "category": entry.category,
                "title_fr": report_title(&entry.id, REPORTS_FR).unwrap_or_else(|| entry.id.clone()),
                "title_en": report_title(&entry.id, REPORTS_EN).unwrap_or_else(|| entry.id.clone()),
                "description": entry.mcp_description,
                "params": entry.params,
            }));
        }
        Ok(ToolOutcome::json(
            json!({ "reports": reports, "unavailable": unavailable }),
        ))
    }

    fn run_report(
        &self,
        args: &Map<String, Value>,
        settings: &ClubSettings,
        call: &CallContext,
    ) -> Result<ToolOutcome, String> {
        check_known_args(args, &["id", "params"])?;
        let id = text_arg(args, "id")?.ok_or("id is required (see list_reports)")?;
        let entry = assets::catalog()
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| format!("Unknown report {id:?}: call list_reports for the ids"))?;
        let objects = self.objects(settings)?;
        if let Some(reason) = unavailable_reason(&entry, settings, &objects) {
            return Err(format!("Report {id} is not available: {reason}"));
        }
        let sql = assets::report_sql(id).ok_or_else(|| format!("Report {id} has no SQL"))?;
        let given = param_values_arg(args)?;
        let values = resolve_params(&entry.params, &given, settings, true)?;
        let limits = settings.performance().1;
        let request = self.request(
            call,
            settings,
            &sql,
            values.clone(),
            limits.mcp_max_rows,
            limits.mcp_report_timeout_ms,
        );
        let result = self
            .runner
            .run(&self.context(settings), &request)
            .map_err(|e| engine_error_text_for(&e, settings))?;
        let mut payload = result_payload(&result);
        payload.insert("report_id".into(), json!(id));
        payload.insert(
            "report_title".into(),
            json!(report_title(id, REPORTS_FR).unwrap_or_else(|| id.to_string())),
        );
        payload.insert("applied_params".into(), Value::Object(values));
        Ok(ToolOutcome::json(Value::Object(payload)))
    }

    fn run_query(
        &self,
        args: &Map<String, Value>,
        settings: &ClubSettings,
        call: &CallContext,
    ) -> Result<ToolOutcome, String> {
        check_known_args(args, &["sql", "params"])?;
        let sql = text_arg(args, "sql")?
            .filter(|sql| !sql.trim().is_empty())
            .ok_or("sql is required")?;
        if sql.chars().count() > MAX_SQL_CHARS {
            return Err(format!("sql is longer than {MAX_SQL_CHARS} characters"));
        }
        let mut params = param_values_arg(args)?;
        for (name, value) in params.iter_mut() {
            let valid = !name.is_empty()
                && name.len() <= 64
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !valid {
                return Err(format!("Invalid parameter name {name:?}"));
            }
            if name == "season" && value.as_str() == Some("current") {
                *value = json!(settings.current_season());
            }
        }
        let limits = settings.performance().1;
        let request = self.request(
            call,
            settings,
            sql,
            params,
            limits.mcp_max_rows,
            limits.mcp_query_timeout_ms,
        );
        let result = self
            .runner
            .run(&self.context(settings), &request)
            .map_err(|e| engine_error_text_for(&e, settings))?;
        Ok(ToolOutcome::json(Value::Object(result_payload(&result))))
    }

    fn propose_chart(
        &self,
        args: &Map<String, Value>,
        settings: &ClubSettings,
        call: &CallContext,
    ) -> Result<ToolOutcome, String> {
        check_known_args(args, &["title", "description", "sql", "params", "chart"])?;
        let title = text_arg(args, "title")?
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or("title is required")?;
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(format!("title is longer than {MAX_TITLE_CHARS} characters"));
        }
        let description = text_arg(args, "description")?
            .map(str::trim)
            .filter(|d| !d.is_empty());
        if description.is_some_and(|d| d.chars().count() > MAX_DESCRIPTION_CHARS) {
            return Err(format!(
                "description is longer than {MAX_DESCRIPTION_CHARS} characters"
            ));
        }
        let sql = text_arg(args, "sql")?
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("sql is required")?;
        if sql.chars().count() > MAX_SQL_CHARS {
            return Err(format!("sql is longer than {MAX_SQL_CHARS} characters"));
        }
        let params = args
            .get("params")
            .cloned()
            .unwrap_or(Value::Array(Vec::new()));
        let params = if params.is_null() {
            Value::Array(Vec::new())
        } else {
            params
        };
        check_params(&params)?;
        let chart = args.get("chart").cloned().ok_or("chart is required")?;
        let referenced = check_chart(&chart)?;

        // Dry run: the SQL must work with the default parameter values.
        let values = resolve_params(&params, &Map::new(), settings, false)?;
        let timeout = settings.performance().1.mcp_query_timeout_ms;
        let request = self.request(call, settings, sql, values, 1, timeout);
        let result = self
            .runner
            .run(&self.context(settings), &request)
            .map_err(|e| {
                format!(
                    "{} Fix the SQL, test it with run_query, then propose again.",
                    engine_error_text(&e)
                )
            })?;
        let returned: Vec<&str> = result.columns.iter().map(|c| c.name.as_str()).collect();
        let missing: Vec<&String> = referenced
            .iter()
            .filter(|column| !returned.contains(&column.as_str()))
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "The chart uses columns the SQL does not return: {}. The SQL returns: {}.",
                missing
                    .iter()
                    .map(|c| c.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                returned.join(", ")
            ));
        }

        let id = inbox::write_proposal(
            &self.env.inbox_dir,
            &NewProposal {
                title: title.to_string(),
                description: description.map(str::to_string),
                sql: sql.to_string(),
                params,
                chart,
                client: call.client.clone(),
            },
        )
        .map_err(|e| format!("The proposal could not be saved: {}", e.message))?;
        Ok(ToolOutcome::ok(
            PROPOSAL_SAVED_MESSAGE.to_string(),
            json!({ "id": id, "status": "proposed" }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(now: &str, month: u32) -> ClubSettings {
        ClubSettings {
            mcp_enabled: true,
            privacy: Privacy::Pseudonymised,
            season_start_month: month,
            enabled_modules: vec![],
            now: now.into(),
            performance: ProfileChoice::Auto,
        }
    }

    #[test]
    fn a_limit_error_points_to_the_profile_setting() {
        let hint = raise_limit_hint(Profile::Powerful);
        assert!(hint.contains("Powerful profile"), "{hint}");
        assert!(hint.contains("profil Puissant"), "{hint}");
        assert!(hint.contains("Performances"), "{hint}");
        let mut club = settings("2026-06-20T09:47", 8);
        club.performance = ProfileChoice::Powerful;
        assert_eq!(club.performance().0, Profile::Powerful);
        // Already on the heaviest profile: never a hint.
        let timeout = AnalyticsError::new(ErrorCode::Timeout, "stopped");
        assert!(!engine_error_text_for(&timeout, &club).contains("Performances"));
        // The server's memory is Économe's on every profile (review D, L2):
        // a heavier profile would not help a too-large result.
        assert_eq!(
            club.performance().1.heap_limit_bytes,
            perf::ECONOMY.heap_limit_bytes
        );
        club.performance = ProfileChoice::Economy;
        let too_large = AnalyticsError::new(ErrorCode::TooLarge, "memory");
        assert!(!engine_error_text_for(&too_large, &club).contains("Performances"));
    }

    /// Review D, M2: a profile row that cannot be read gives Économe.
    #[test]
    fn an_unreadable_profile_falls_back_to_economy() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("main.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE setting (key TEXT PRIMARY KEY, value); \
             INSERT INTO setting VALUES ('analytics.mcp.enabled', 'true'); \
             INSERT INTO setting VALUES ('analytics.performance.profile', '\"powerful\"');",
        )
        .unwrap();
        let read = || read_settings(&path, Some("2026-06-20T09:47")).unwrap();
        assert_eq!(read().performance, ProfileChoice::Powerful);
        conn.execute_batch(
            "UPDATE setting SET value = X'00ff' WHERE key = 'analytics.performance.profile';",
        )
        .unwrap();
        let settings = read();
        assert_eq!(settings.performance, ProfileChoice::Economy);
        assert!(settings.mcp_enabled);
        // NULL: as if unset.
        conn.execute_batch(
            "UPDATE setting SET value = NULL WHERE key = 'analytics.performance.profile';",
        )
        .unwrap();
        assert_eq!(read().performance, ProfileChoice::Auto);
    }

    #[test]
    fn current_season_follows_the_start_month() {
        assert_eq!(settings("2026-07-31T23:59", 8).current_season(), 2025);
        assert_eq!(settings("2026-08-01T00:00", 8).current_season(), 2026);
        assert_eq!(settings("2026-01-15T10:00", 1).current_season(), 2026);
        assert_eq!(settings("2026-08-31T10:00", 9).current_season(), 2025);
    }

    #[test]
    fn resolves_report_params() {
        let s = settings("2026-10-29T10:00", 8);
        let defs = json!([
            { "name": "season", "type": "season", "required": true, "default": "current" },
            { "name": "min_outings", "type": "integer", "default": 5, "min": 1, "max": 50 },
            { "name": "boat_class", "type": "boat_class", "default": null },
            { "name": "weekend", "type": "boolean", "default": false },
            { "name": "kind", "type": "choice", "options": [{ "value": "a" }, { "value": "b" }] }
        ]);
        let values = resolve_params(&defs, &Map::new(), &s, true).unwrap();
        assert_eq!(
            Value::Object(values),
            json!({ "season": 2026, "min_outings": 5, "boat_class": null, "weekend": 0, "kind": null })
        );
        let given = json!({ "season": "2024", "min_outings": "7", "weekend": true, "kind": "b", "boat_class": "4x" });
        let values = resolve_params(&defs, given.as_object().unwrap(), &s, true).unwrap();
        assert_eq!(
            Value::Object(values),
            json!({ "season": 2024, "min_outings": 7, "boat_class": "4x", "weekend": 1, "kind": "b" })
        );
        for (given, expected) in [
            (json!({ "season": "last" }), "Parameter season"),
            (json!({ "min_outings": 99 }), "between 1 and 50"),
            (json!({ "kind": "c" }), "one of a, b"),
            (json!({ "colour": 1 }), "Unknown parameter colour"),
            (json!({ "season": null }), "season is required"),
        ] {
            let error = resolve_params(&defs, given.as_object().unwrap(), &s, true).unwrap_err();
            assert!(error.contains(expected), "{given}: {error}");
        }
        // Lenient (dry run): bad values become NULL.
        let values = resolve_params(
            &defs,
            json!({ "season": "x" }).as_object().unwrap(),
            &s,
            false,
        )
        .unwrap();
        assert_eq!(values["season"], Value::Null);
    }

    #[test]
    fn tool_definitions_are_strict_objects() {
        let tools = tool_definitions();
        let names: Vec<&str> = tools
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "get_schema",
                "list_reports",
                "run_report",
                "run_query",
                "propose_chart"
            ]
        );
        for tool in tools.as_array().unwrap() {
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert_eq!(
                tool["inputSchema"]["additionalProperties"], false,
                "{}",
                tool["name"]
            );
            assert!(Tools::is_tool(tool["name"].as_str().unwrap()));
            assert!(tool["description"].as_str().unwrap().len() > 40);
        }
    }

    #[test]
    fn rules_name_the_start_month() {
        let rules = sql_rules(&settings("2026-10-29T10:00", 9)).join("\n");
        assert!(rules.contains("month 9 (September)"));
        assert!(rules.contains("pseudonymised"));
    }

    #[test]
    fn local_time_shape() {
        assert!(is_local_date_time("2026-10-29T10:05"));
        assert!(!is_local_date_time("2026-10-29 10:05"));
        assert!(!is_local_date_time("2026-10-29T10:05:00"));
    }
}
