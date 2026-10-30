//! Result cache of the engine (plan 2.2 "Result cache").
//!
//! A result is reused only while the database is unchanged: the key holds
//! `PRAGMA data_version` read on a long-lived read-only connection (the
//! value changes whenever another connection commits) and the identity of
//! the database file (a file swapped under the same path starts a new
//! stamp connection). It also holds everything that changes a result: the
//! SQL, the parameters, the privacy mode, `maxRows` and `now` truncated to
//! the hour, or to the minute for SQL that can show it
//! (`depends_on_minute`). The season start month is a setting, so `data_version`
//! already covers it.
//!
//! LRU with at most 64 entries and 16 MB of results.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::{Map, Value};

use crate::ipc::{Privacy, QueryResult};

use super::open::open_read_only;

pub const MAX_ENTRIES: usize = 64;
pub const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug)]
struct Entry {
    key: String,
    result: QueryResult,
    bytes: usize,
    last_used: u64,
}

/// The LRU store. Keys are compared in full (no hash collisions).
#[derive(Debug, Default)]
pub struct ResultCache {
    entries: Vec<Entry>,
    bytes: usize,
    clock: u64,
}

impl ResultCache {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn get(&mut self, key: &str) -> Option<QueryResult> {
        self.clock += 1;
        let clock = self.clock;
        self.entries.iter_mut().find(|e| e.key == key).map(|entry| {
            entry.last_used = clock;
            entry.result.clone()
        })
    }

    /// Stores a result; `result_bytes` is its JSON size estimate. Results
    /// larger than the whole budget are not stored.
    pub fn put(&mut self, key: String, result: QueryResult, result_bytes: usize) {
        let bytes = result_bytes + key.len();
        if bytes > MAX_BYTES {
            return;
        }
        self.clock += 1;
        if let Some(index) = self.entries.iter().position(|e| e.key == key) {
            let old = self.entries.swap_remove(index);
            self.bytes -= old.bytes;
        }
        while !self.entries.is_empty()
            && (self.entries.len() >= MAX_ENTRIES || self.bytes + bytes > MAX_BYTES)
        {
            let oldest = self
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, e)| e.last_used)
                .map(|(i, _)| i)
                .unwrap_or(0);
            let old = self.entries.swap_remove(oldest);
            self.bytes -= old.bytes;
        }
        self.bytes += bytes;
        self.entries.push(Entry {
            key,
            result,
            bytes,
            last_used: self.clock,
        });
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }
}

/// Identifies the file behind a path (device and inode on Unix), so a
/// database replaced by another file is noticed.
pub(crate) fn file_identity(path: &Path) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(path).ok().map(|m| (m.dev(), m.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// The long-lived connection used only for `PRAGMA data_version`.
#[derive(Debug)]
pub struct Stamp {
    path: PathBuf,
    identity: Option<(u64, u64)>,
    conn: Connection,
}

/// What identifies the database state: `None` when it cannot be read (the
/// cache is then bypassed).
pub fn database_version(slot: &mut Option<Stamp>, path: &Path) -> Option<String> {
    let identity = file_identity(path);
    let stale = match slot {
        Some(stamp) => stamp.path != path || stamp.identity != identity,
        None => true,
    };
    if stale {
        *slot = None;
        let (conn, _) = open_read_only(path).ok()?;
        *slot = Some(Stamp {
            path: path.to_path_buf(),
            identity,
            conn,
        });
    }
    let stamp = slot.as_ref()?;
    match stamp
        .conn
        .query_row("PRAGMA data_version", [], |row| row.get::<_, i64>(0))
    {
        Ok(version) => Some(format!("{version}:{identity:?}")),
        Err(_) => {
            *slot = None;
            None
        }
    }
}

/// Whether a result can depend on `now` to the minute: the SQL names
/// `now` (`v_settings.now`, `'now'`), `v_damages` (`days_open`),
/// `current_date` / `current_time` / `current_timestamp`, calls a date and
/// time function without a time value (`datetime()`, `strftime('%H:%M')`:
/// SQLite reads the clock, review C, 6), or reads `v_settings` with a
/// `*`. Everything else uses `today` and `current_season` at most, which
/// an hour-long key serves well (review A, L9). Matching too much only
/// costs cache hits.
pub fn depends_on_minute(sql: &str) -> bool {
    let lower = sql.to_ascii_lowercase();
    let mut reads_settings = false;
    for word in lower.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')) {
        match word {
            "now" | "v_damages" | "current_date" | "current_time" | "current_timestamp" => {
                return true
            }
            "v_settings" => reads_settings = true,
            _ => {}
        }
    }
    (reads_settings && lower.contains('*')) || reads_the_clock(lower.as_bytes())
}

/// The arguments of a call: top-level commas, and whether there is none.
struct CallArguments {
    commas: usize,
    empty: bool,
}

/// `rest` starts right after a function name: its arguments when it is a
/// call. An unterminated call counts as empty (matching too much is safe).
fn call_arguments(rest: &[u8]) -> Option<CallArguments> {
    let mut i = rest.iter().take_while(|c| c.is_ascii_whitespace()).count();
    if rest.get(i) != Some(&b'(') {
        return None;
    }
    i += 1;
    let (mut depth, mut commas, mut empty) = (0usize, 0usize, true);
    let mut quote: Option<u8> = None;
    while let Some(&c) = rest.get(i) {
        i += 1;
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            b'\'' | b'"' | b'`' => quote = Some(c),
            b'(' => depth += 1,
            b')' if depth == 0 => return Some(CallArguments { commas, empty }),
            b')' => depth -= 1,
            b',' if depth == 0 => commas += 1,
            _ => {}
        }
        if !c.is_ascii_whitespace() {
            empty = false;
        }
    }
    Some(CallArguments {
        commas: 0,
        empty: true,
    })
}

/// A date and time function called without a time value, so on the
/// clock: `date()`, `time()`, `datetime()`, `julianday()`, `unixepoch()`,
/// `strftime(format)`.
fn reads_the_clock(lower: &[u8]) -> bool {
    const WITHOUT_ARGUMENTS: [&[u8]; 5] =
        [b"date", b"time", b"datetime", b"julianday", b"unixepoch"];
    let is_word = |c: &u8| c.is_ascii_alphanumeric() || *c == b'_';
    let mut start = 0;
    while start < lower.len() {
        if !is_word(&lower[start]) {
            start += 1;
            continue;
        }
        let end = start + lower[start..].iter().take_while(|c| is_word(c)).count();
        let word = &lower[start..end];
        let strftime = word == b"strftime";
        if strftime || WITHOUT_ARGUMENTS.contains(&word) {
            if let Some(args) = call_arguments(&lower[end..]) {
                if args.empty || (strftime && args.commas == 0) {
                    return true;
                }
            }
        }
        start = end;
    }
    false
}

/// The cache key of a request (`params` with sorted names). `now` counts
/// to the hour, or to the minute when the SQL can show it
/// (`depends_on_minute`).
pub fn cache_key(
    db_path: &Path,
    version: &str,
    sql: &str,
    params: &Map<String, Value>,
    privacy: Privacy,
    max_rows: u32,
    now: &str,
) -> String {
    let params: BTreeMap<&String, &Value> = params.iter().collect();
    let precision = if depends_on_minute(sql) { 16 } else { 13 };
    let time = now.get(..precision).unwrap_or(now);
    serde_json::json!([
        db_path.to_string_lossy(),
        version,
        privacy,
        max_rows,
        time,
        params,
        sql,
    ])
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn result(rows: usize) -> QueryResult {
        QueryResult {
            columns: vec![],
            rows: vec![vec![json!(1)]; rows],
            truncated: false,
            elapsed_ms: 1,
            ignored_columns: vec![],
            cached: false,
        }
    }

    #[test]
    fn evicts_the_least_recently_used_entry() {
        let mut cache = ResultCache::default();
        for i in 0..MAX_ENTRIES {
            cache.put(format!("k{i}"), result(1), 10);
        }
        assert_eq!(cache.len(), MAX_ENTRIES);
        assert!(cache.get("k0").is_some());
        cache.put("new".into(), result(1), 10);
        assert_eq!(cache.len(), MAX_ENTRIES);
        assert!(cache.get("k0").is_some(), "recently used entry kept");
        assert!(cache.get("k1").is_none(), "oldest entry evicted");
        assert!(cache.get("new").is_some());
    }

    #[test]
    fn keeps_within_the_byte_budget() {
        let mut cache = ResultCache::default();
        let big = MAX_BYTES / 3;
        cache.put("a".into(), result(1), big);
        cache.put("b".into(), result(1), big);
        cache.put("c".into(), result(1), big);
        assert_eq!(cache.len(), 2);
        assert!(cache.get("a").is_none());
        assert!(cache.bytes() <= MAX_BYTES);
        cache.put("huge".into(), result(1), MAX_BYTES + 1);
        assert!(cache.get("huge").is_none());
        cache.put("b".into(), result(2), 5);
        assert_eq!(cache.get("b").unwrap().rows.len(), 2);
        cache.clear();
        assert!(cache.is_empty());
        assert_eq!(cache.bytes(), 0);
    }

    #[test]
    fn minute_level_now_keys_to_the_minute() {
        let key = |sql: &str, now: &str| {
            cache_key(
                Path::new("/db/main.db"),
                "1",
                sql,
                &Map::new(),
                Privacy::Nominative,
                10,
                now,
            )
        };
        for sql in [
            "SELECT now FROM v_settings",
            "SELECT st.NOW FROM v_settings st",
            "SELECT * FROM v_settings",
            "SELECT boat_name, days_open FROM v_damages",
            "SELECT datetime('now')",
            "SELECT CURRENT_TIMESTAMP",
            "SELECT current_date",
            "SELECT datetime()",
            "SELECT TIME ( )",
            "SELECT unixepoch() - 60",
            "SELECT julianday()",
            "SELECT date()",
            "SELECT strftime('%H:%M')",
            "SELECT strftime('%H,%M')",
            "SELECT strftime(:format)",
            "SELECT datetime(",
        ] {
            assert!(depends_on_minute(sql), "{sql}");
            assert_ne!(
                key(sql, "2026-01-01T10:15"),
                key(sql, "2026-01-01T10:16"),
                "{sql}"
            );
        }
        for sql in [
            "SELECT count(*) FROM v_outings",
            "SELECT current_season FROM v_settings",
            "SELECT nowhere, known FROM v_outings",
            "SELECT date(start_date_time) AS date, time(o.start_date_time) FROM v_outings o",
            "SELECT strftime('%Y-%m', start_date_time), unixepoch(today) FROM v_settings",
            "SELECT julianday(date(today, '+1 day')) - julianday(substr(start_date_time, 1, 10)) FROM v_outings, v_settings",
            "SELECT strftime('%H', max(start_date_time)) FROM v_outings",
            "SELECT update_time, date_time() FROM v_outings",
        ] {
            assert!(!depends_on_minute(sql), "{sql}");
            assert_eq!(key(sql, "2026-01-01T10:15"), key(sql, "2026-01-01T10:59"));
        }
    }

    #[test]
    fn keys_differ_on_everything_that_changes_a_result() {
        let path = Path::new("/db/main.db");
        let mut params = Map::new();
        params.insert("b".into(), json!(1));
        params.insert("a".into(), json!("x"));
        let base = cache_key(
            path,
            "1",
            "SELECT 1",
            &params,
            Privacy::Nominative,
            10,
            "2026-01-01T10:15",
        );
        let mut reordered = Map::new();
        reordered.insert("a".into(), json!("x"));
        reordered.insert("b".into(), json!(1));
        assert_eq!(
            base,
            cache_key(
                path,
                "1",
                "SELECT 1",
                &reordered,
                Privacy::Nominative,
                10,
                "2026-01-01T10:59"
            )
        );
        for other in [
            cache_key(
                Path::new("/other.db"),
                "1",
                "SELECT 1",
                &params,
                Privacy::Nominative,
                10,
                "2026-01-01T10:15",
            ),
            cache_key(
                path,
                "2",
                "SELECT 1",
                &params,
                Privacy::Nominative,
                10,
                "2026-01-01T10:15",
            ),
            cache_key(
                path,
                "1",
                "SELECT 2",
                &params,
                Privacy::Nominative,
                10,
                "2026-01-01T10:15",
            ),
            cache_key(
                path,
                "1",
                "SELECT 1",
                &Map::new(),
                Privacy::Nominative,
                10,
                "2026-01-01T10:15",
            ),
            cache_key(
                path,
                "1",
                "SELECT 1",
                &params,
                Privacy::Pseudonymised,
                10,
                "2026-01-01T10:15",
            ),
            cache_key(
                path,
                "1",
                "SELECT 1",
                &params,
                Privacy::Nominative,
                11,
                "2026-01-01T10:15",
            ),
            cache_key(
                path,
                "1",
                "SELECT 1",
                &params,
                Privacy::Nominative,
                10,
                "2026-01-01T11:15",
            ),
        ] {
            assert_ne!(base, other);
        }
    }
}
