//! The proposals inbox (plan 2.12): `propose_chart` writes one JSON file
//! per proposal into `paths::inbox_dir()`; the app lists them
//! (`analytics_inbox_list`), imports each valid one through its write
//! queue, then deletes the file (`analytics_inbox_remove`). The MCP
//! process never opens `main.db` for writing.
//!
//! File: `<uuid>.json` = `{ id, createdAt, title, description, sql,
//! params, chart, client }`, written to `<uuid>.json.tmp` then renamed,
//! so the app never reads half a file.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::InboxProposal;

/// A proposal file larger than this is listed as unreadable.
pub const MAX_PROPOSAL_BYTES: u64 = 1024 * 1024;
/// `propose_chart` refuses new proposals beyond this many waiting ones.
pub const MAX_PENDING_PROPOSALS: usize = 200;

/// What `propose_chart` stores.
#[derive(Debug, Clone, PartialEq)]
pub struct NewProposal {
    pub title: String,
    pub description: Option<String>,
    pub sql: String,
    pub params: Value,
    pub chart: Value,
    pub client: Option<String>,
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` (the shape of JS `toISOString()`, used by
/// the repository's `nowIso()`).
pub fn iso_utc_now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    iso_utc(elapsed.as_secs() as i64, elapsed.subsec_millis())
}

/// Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

pub(crate) fn iso_utc(secs: i64, millis: u32) -> String {
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// A canonical lower-case hyphenated UUID (the only file names we read or
/// delete: no path tricks).
pub fn is_proposal_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id)
        .map(|uuid| uuid.hyphenated().to_string() == id)
        .unwrap_or(false)
}

fn proposal_files(dir: &Path) -> io::Result<Vec<(String, PathBuf)>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if is_proposal_id(id) {
            files.push((id.to_string(), path));
        }
    }
    Ok(files)
}

fn io_failure(what: &str, path: &Path, error: io::Error) -> AnalyticsError {
    AnalyticsError::internal(format!("{what} {}: {error}", path.display()))
}

/// Writes a new proposal atomically and returns its id. Creates `dir`.
pub fn write_proposal(dir: &Path, proposal: &NewProposal) -> Result<String, AnalyticsError> {
    fs::create_dir_all(dir).map_err(|e| io_failure("Cannot create", dir, e))?;
    let pending = proposal_files(dir)
        .map_err(|e| io_failure("Cannot read", dir, e))?
        .len();
    if pending >= MAX_PENDING_PROPOSALS {
        return Err(AnalyticsError::new(
            ErrorCode::TooLarge,
            format!(
                "{pending} proposals are already waiting in Rowing Beacon. Ask the user to review \
                 them (Statistiques › Explorer › Propositions) before proposing more."
            ),
        ));
    }
    let id = uuid::Uuid::new_v4().hyphenated().to_string();
    let content = json!({
        "id": id,
        "createdAt": iso_utc_now(),
        "title": proposal.title,
        "description": proposal.description,
        "sql": proposal.sql,
        "params": proposal.params,
        "chart": proposal.chart,
        "client": proposal.client,
    });
    let text = serde_json::to_string_pretty(&content)
        .map_err(|e| AnalyticsError::internal(format!("proposal JSON: {e}")))?;
    let final_path = dir.join(format!("{id}.json"));
    let tmp_path = dir.join(format!("{id}.json.tmp"));
    let written = (|| {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(text.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp_path, &final_path)
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&tmp_path);
        return Err(io_failure("Cannot write", &final_path, error));
    }
    Ok(id)
}

fn optional_text(value: &Value, field: &str) -> Result<Option<String>, String> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(format!("{field} is not a text")),
    }
}

fn read_proposal(id: &str, path: &Path) -> InboxProposal {
    let mut proposal = InboxProposal {
        id: id.to_string(),
        created_at: None,
        client: None,
        title: None,
        description: None,
        sql: None,
        params: Value::Array(Vec::new()),
        chart: Value::Null,
        error: None,
    };
    let fail = |mut proposal: InboxProposal, error: String| {
        proposal.error = Some(error);
        proposal
    };
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_file() => return fail(proposal, "not a regular file".into()),
        Ok(meta) if meta.len() > MAX_PROPOSAL_BYTES => {
            return fail(proposal, format!("file too large ({} bytes)", meta.len()))
        }
        Ok(_) => {}
        Err(error) => return fail(proposal, format!("unreadable file: {error}")),
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => return fail(proposal, format!("unreadable file: {error}")),
    };
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value @ Value::Object(_)) => value,
        Ok(_) => return fail(proposal, "not a JSON object".into()),
        Err(error) => return fail(proposal, format!("invalid JSON: {error}")),
    };
    let fields = (|| {
        Ok::<_, String>((
            optional_text(&value, "createdAt")?,
            optional_text(&value, "client")?,
            optional_text(&value, "title")?,
            optional_text(&value, "description")?,
            optional_text(&value, "sql")?,
        ))
    })();
    let (created_at, client, title, description, sql) = match fields {
        Ok(fields) => fields,
        Err(error) => return fail(proposal, error),
    };
    proposal.created_at = created_at;
    proposal.client = client;
    proposal.title = title;
    proposal.description = description;
    proposal.sql = sql;
    proposal.params = value
        .get("params")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    proposal.chart = value.get("chart").cloned().unwrap_or(Value::Null);
    if proposal
        .title
        .as_deref()
        .is_none_or(|t| t.trim().is_empty())
    {
        return fail(proposal, "missing title".into());
    }
    if proposal.sql.as_deref().is_none_or(|s| s.trim().is_empty()) {
        return fail(proposal, "missing sql".into());
    }
    proposal
}

/// The proposals waiting in `dir` (`<uuid>.json`), oldest first,
/// unreadable files included with their `error`. A missing folder is an
/// empty inbox; temporary `.tmp` files are skipped.
pub fn list(dir: &Path) -> Result<Vec<InboxProposal>, AnalyticsError> {
    let files = proposal_files(dir).map_err(|e| io_failure("Cannot read", dir, e))?;
    let mut proposals: Vec<InboxProposal> = files
        .iter()
        .map(|(id, path)| read_proposal(id, path))
        .collect();
    proposals.sort_by(|a, b| {
        let key = |p: &InboxProposal| (p.created_at.is_none(), p.created_at.clone());
        key(a).cmp(&key(b)).then_with(|| a.id.cmp(&b.id))
    });
    Ok(proposals)
}

/// Deletes `<dir>/<id>.json`; `id` must be a UUID. An already deleted
/// proposal is not an error (two windows may import the same one).
pub fn remove(dir: &Path, id: &str) -> Result<(), AnalyticsError> {
    if !is_proposal_id(id) {
        return Err(AnalyticsError::new(
            ErrorCode::InvalidParam,
            "A proposal id is a lower-case UUID",
        )
        .with_object("id"));
    }
    let path = dir.join(format!("{id}.json"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_failure("Cannot delete", &path, error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proposal() -> NewProposal {
        NewProposal {
            title: "Sorties par mois".into(),
            description: Some("Nombre de sorties.".into()),
            sql: "SELECT start_month_key AS month, COUNT(*) AS outings FROM v_outings GROUP BY 1"
                .into(),
            params: json!([]),
            chart: json!({ "type": "line", "x": "month", "y": ["outings"] }),
            client: Some("claude-ai".into()),
        }
    }

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(iso_utc(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(951_782_400, 5), "2000-02-29T00:00:00.005Z");
        assert_eq!(iso_utc(1_793_300_000, 123), "2026-10-29T18:53:20.123Z");
        assert_eq!(iso_utc_now().len(), 24);
    }

    #[test]
    fn writes_lists_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let inbox = dir.path().join("deep").join("analytics-inbox");
        assert!(
            list(&inbox).unwrap().is_empty(),
            "missing folder = empty inbox"
        );
        let id = write_proposal(&inbox, &proposal()).unwrap();
        assert!(is_proposal_id(&id));
        let names: Vec<String> = fs::read_dir(&inbox)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec![format!("{id}.json")], "no .tmp left behind");
        let listed = list(&inbox).unwrap();
        assert_eq!(listed.len(), 1);
        let item = &listed[0];
        assert_eq!(item.id, id);
        assert_eq!(item.error, None);
        assert_eq!(item.title.as_deref(), Some("Sorties par mois"));
        assert_eq!(item.client.as_deref(), Some("claude-ai"));
        assert_eq!(item.chart["type"], "line");
        assert!(item.created_at.as_deref().unwrap().ends_with('Z'));
        // The file is the documented shape.
        let raw: Value =
            serde_json::from_str(&fs::read_to_string(inbox.join(format!("{id}.json"))).unwrap())
                .unwrap();
        let mut keys: Vec<&str> = raw
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "chart",
                "client",
                "createdAt",
                "description",
                "id",
                "params",
                "sql",
                "title"
            ]
        );
        remove(&inbox, &id).unwrap();
        remove(&inbox, &id).unwrap();
        assert!(list(&inbox).unwrap().is_empty());
    }

    #[test]
    fn lists_broken_files_with_their_error() {
        let dir = tempfile::tempdir().unwrap();
        let ids: Vec<String> = (0..5).map(|_| uuid::Uuid::new_v4().to_string()).collect();
        fs::write(dir.path().join(format!("{}.json", ids[0])), "{ not json").unwrap();
        fs::write(dir.path().join(format!("{}.json", ids[1])), "[1, 2]").unwrap();
        fs::write(
            dir.path().join(format!("{}.json", ids[2])),
            r#"{"title": 3, "sql": "SELECT 1"}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join(format!("{}.json", ids[3])),
            r#"{"title": "T"}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join(format!("{}.json", ids[4])),
            vec![b' '; (MAX_PROPOSAL_BYTES + 1) as usize],
        )
        .unwrap();
        // Ignored: temporary files, other names, folders.
        fs::write(dir.path().join(format!("{}.json.tmp", ids[0])), "{}").unwrap();
        fs::write(dir.path().join("notes.json"), "{}").unwrap();
        fs::write(dir.path().join(format!("{}.JSON", ids[0])), "{}").unwrap();
        fs::create_dir(dir.path().join(format!("{}", uuid::Uuid::new_v4()))).unwrap();
        let listed = list(dir.path()).unwrap();
        assert_eq!(listed.len(), 5);
        let error_of = |id: &str| {
            listed
                .iter()
                .find(|p| p.id == id)
                .unwrap()
                .error
                .clone()
                .unwrap()
        };
        assert!(error_of(&ids[0]).starts_with("invalid JSON"));
        assert_eq!(error_of(&ids[1]), "not a JSON object");
        assert_eq!(error_of(&ids[2]), "title is not a text");
        assert_eq!(error_of(&ids[3]), "missing sql");
        assert!(error_of(&ids[4]).starts_with("file too large"));
    }

    #[test]
    fn remove_refuses_anything_but_a_uuid() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("main.db");
        fs::write(&victim, "data").unwrap();
        for bad in [
            "../main",
            "main",
            "",
            "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
            "a/b",
        ] {
            assert_eq!(
                remove(dir.path(), bad).unwrap_err().code,
                ErrorCode::InvalidParam,
                "{bad}"
            );
        }
        assert!(victim.exists());
    }

    #[test]
    fn refuses_when_too_many_are_pending() {
        let dir = tempfile::tempdir().unwrap();
        for _ in 0..MAX_PENDING_PROPOSALS {
            fs::write(
                dir.path().join(format!("{}.json", uuid::Uuid::new_v4())),
                "{}",
            )
            .unwrap();
        }
        assert_eq!(
            write_proposal(dir.path(), &proposal()).unwrap_err().code,
            ErrorCode::TooLarge
        );
    }

    #[test]
    fn lists_oldest_first() {
        let dir = tempfile::tempdir().unwrap();
        let a = "00000000-0000-4000-8000-000000000002";
        let b = "00000000-0000-4000-8000-000000000001";
        fs::write(
            dir.path().join(format!("{a}.json")),
            r#"{"title":"A","sql":"SELECT 1","createdAt":"2026-01-01T00:00:00.000Z"}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join(format!("{b}.json")),
            r#"{"title":"B","sql":"SELECT 1","createdAt":"2026-02-01T00:00:00.000Z"}"#,
        )
        .unwrap();
        let ids: Vec<String> = list(dir.path())
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![a, b]);
    }
}
